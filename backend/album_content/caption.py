"""Frozen, album-only caption profiles. Never changes stored/viewer image bytes.

Luna Standard prices reviewed 2026-10-28: $0.10 input/$0.50 output per 1M.
https://developers.openai.com/api/docs/models/gpt-6-luna
No cache discount assumed. Legacy generation and goods suggestions stay independent.
"""
import asyncio
import base64
import json
from decimal import Decimal
from io import BytesIO

from PIL import Image

from backend.generation.openai_provider import (
    ProviderFailure, ProviderResult, _accounting, _caption, _valid_webp,
)
from backend.generation.service import config_snapshot
from backend.album_content.prompts import instructions, SHORT_MEMORY_VERSION, PLACE_EXPERIENCE_VERSION, PLACE_CONTEXT_VERSIONS

LUNA_PROFILE = {
    'caption_model': 'gpt-6-luna',
    'caption_analysis_profile': 'webp-fit-1024-q80-v1',
    'caption_pricing_profile': 'luna-standard-2026-10-28-v1',
}


def content_snapshot(settings):
    config = {**config_snapshot(settings), 'image_policy': 'none', 'result_policy': 'album_content_v1'}
    if config['execution_mode'] == 'openai' and settings.album_content_caption_profile in ('luna_1024_v1', 'luna_places_1024_v1'):
        config.update(LUNA_PROFILE)
        config['caption_prompt_version'] = SHORT_MEMORY_VERSION
        if settings.album_content_caption_profile == 'luna_places_1024_v1':
            config['caption_prompt_version'] = PLACE_EXPERIENCE_VERSION
            config.update(caption_ai_target_min_chars=35, caption_ai_target_max_chars=55)
            config['caption_place_context'] = {'version': 1, 'gps': None, 'references': []}
    return config


def supported_snapshot(config, settings):
    expected = config_snapshot(settings)
    if any(config.get(k) != expected[k] for k in ('execution_mode', 'prompt_version')):
        return False
    from backend.album_content.place_context import valid_context
    if config.get('caption_prompt_version') in PLACE_CONTEXT_VERSIONS:
        if not valid_context(config.get('caption_place_context')): return False
    elif 'caption_place_context' in config:
        return False
    if config.get('caption_analysis_profile') is None:
        return (config.get('caption_model') == expected['caption_model'] and config.get('caption_pricing_profile') is None
                and config.get('caption_prompt_version') is None)
    return (config.get('execution_mode') == 'openai' and all(config.get(k) == v for k, v in LUNA_PROFILE.items())
            and config.get('caption_prompt_version') in (None, SHORT_MEMORY_VERSION, *PLACE_CONTEXT_VERSIONS))


def analysis_image(data, *, edge=1024):
    """Fit within 1024 square, preserve aspect/orientation, strip metadata, no upscale."""
    if not _valid_webp(data):
        raise ProviderFailure('MEDIA_SAVE_FAILED', dispatch_state='not_sent')
    with Image.open(BytesIO(data)) as source:
        source.thumbnail((edge, edge), Image.Resampling.LANCZOS)
        # New pixel-only image excludes metadata. Source is already orientation-normalized.
        rgba = source.convert('RGBA')
        image = Image.new('RGB', source.size, 'white')
        image.paste(rgba, mask=rgba.getchannel('A'))
        out = BytesIO()
        image.save(out, 'WEBP', quality=80, method=4)
        return out.getvalue()


async def caption(provider, data, config, *, reference_images=()):
    if config.get('caption_analysis_profile') is None and config.get('caption_model') == 'gpt-5.4-mini':
        if config.get('caption_prompt_version') is not None:
            raise ProviderFailure('AI_TEMPORARY_FAILURE', dispatch_state='not_sent')
        return await provider.caption(data, prompt_version=config['prompt_version'])
    if not all(config.get(k) == v for k, v in LUNA_PROFILE.items()):
        raise ProviderFailure('AI_TEMPORARY_FAILURE', dispatch_state='not_sent')
    try:
        prompt = instructions(config)
    except (KeyError, ValueError):
        raise ProviderFailure('AI_TEMPORARY_FAILURE', dispatch_state='not_sent') from None
    places = config.get('caption_prompt_version') in PLACE_CONTEXT_VERSIONS
    structured = config.get('caption_prompt_version') == PLACE_EXPERIENCE_VERSION
    from backend.album_content.place_context import coarse_gps, valid_context
    if (places and not valid_context(config.get('caption_place_context'))) or (not places and ('caption_place_context' in config or reference_images)):
        raise ProviderFailure('AI_TEMPORARY_FAILURE', dispatch_state='not_sent')
    small = await asyncio.to_thread(analysis_image, data)
    content = []
    if places:
        content.append({'type': 'input_text', 'text': 'current '+json.dumps({'gps': coarse_gps(config['caption_place_context']['gps'])})})
    content.append({'type': 'input_image', 'detail': 'high', 'image_url': 'data:image/webp;base64,'+base64.b64encode(small).decode('ascii')})
    for index, (raw, coordinates) in enumerate(reference_images[:2] if places else ()):
        try:
            image = await asyncio.to_thread(analysis_image, raw, edge=512)
        except (ProviderFailure, OSError, ValueError):
            continue
        content.extend([
            {'type': 'input_text', 'text': f'reference_{index+1} location_only '+json.dumps({'gps': coarse_gps(coordinates)})},
            {'type': 'input_image', 'detail': 'high', 'image_url': 'data:image/webp;base64,'+base64.b64encode(image).decode('ascii')},
        ])
    response_options = {}
    if structured:
        from backend.album_content.place_caption import SCHEMA
        response_options['text'] = {'format': {'type': 'json_schema', 'name': 'place_experience', 'strict': True, 'schema': SCHEMA}}
    response = await provider._call(provider.client.responses.create,
        model='gpt-6-luna', instructions=prompt,
        input=[{'role': 'user', 'content': content}],
        tools=[], max_output_tokens=512 if structured else 256, reasoning={'effort': 'none'}, store=False,
        background=False, service_tier='default', timeout=60.0, **response_options)
    accounting = _accounting(response)
    # Reuse allowlisted, validated usage, but never the mini model's price.
    accounting['cost_usd'] = ((Decimal(accounting['usage']['input_tokens']) * Decimal('0.10')
        + Decimal(accounting['usage']['output_tokens']) * Decimal('0.50')) / 1_000_000
        if accounting['cost_usd'] is not None else None)
    output = getattr(response, 'output_text', None)
    if structured:
        from backend.album_content.place_caption import parse_caption
        try:
            output = parse_caption(output)
        except (ValueError, TypeError):
            output = None
    text = _caption(output)
    if getattr(response, 'status', None) != 'completed' or text is None:
        raise ProviderFailure('CAPTION_INVALID', dispatch_state='responded', **accounting)
    return ProviderResult(caption=text, **accounting)
