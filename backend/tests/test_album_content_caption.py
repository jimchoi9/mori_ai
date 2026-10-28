"""No paid calls: wire pricing, pixel reduction, frozen profile compatibility."""
import base64
import hashlib
import json
from decimal import Decimal
from io import BytesIO

import httpx
import pytest
from PIL import Image

from backend.album_content.caption import LUNA_PROFILE,analysis_image,caption,content_snapshot,supported_snapshot
from backend.generation.openai_provider import OpenAIProvider,ProviderFailure
from backend.generation.prompt_profiles import DEFAULT_PROMPT_VERSION
from backend.album_content.prompts import SHORT_MEMORY_VERSION, instructions
from backend.generation.prompt_profiles import caption_prompt
from backend.settings import Settings
from backend.tests.test_openai_provider import webp,caption_response,make_provider,module,settings

@pytest.mark.parametrize('size,expected',[((2048,1536),(1024,768)),((1536,2048),(768,1024)),((600,400),(600,400))])
def test_analysis_is_pixel_only_nonmutating_fit(size,expected):
    data=webp(size);original=hashlib.sha256(data).digest()
    with Image.open(BytesIO(analysis_image(data))) as result:
        assert result.size==expected and result.format=='WEBP'
        assert not result.getexif() and not result.info.get('icc_profile')
    assert hashlib.sha256(data).digest()==original

@pytest.mark.parametrize('data',[b'bad',webp(fmt='PNG')])
def test_invalid_input_never_dispatches(data):
    with pytest.raises(ProviderFailure) as e:analysis_image(data)
    assert e.value.dispatch_state=='not_sent'

@pytest.mark.asyncio
async def test_luna_wire_and_pricing(module,settings):
    async def handler(request):
        payload=json.loads(request.content)
        assert payload['model']=='gpt-6-luna'
        assert payload['max_output_tokens']==256 and payload['reasoning']=={'effort':'none'}
        assert payload['store'] is False and payload['tools']==[] and payload['service_tier']=='default'
        entry=payload['input'][0]['content'][0];assert entry['detail']=='high'
        with Image.open(BytesIO(base64.b64decode(entry['image_url'].split(',')[1]))) as image:assert image.size==(1024,768)
        return httpx.Response(200,json=caption_response(),headers={'x-request-id':'req_safe'})
    provider=make_provider(module,settings,handler)
    try:
        result=await caption(provider,webp((2048,1536)),{**LUNA_PROFILE,'prompt_version':DEFAULT_PROMPT_VERSION})
        assert result.cost_usd==Decimal('0.000110') and result.request_id=='req_safe'
    finally:await provider.aclose()

@pytest.mark.asyncio
async def test_invalid_luna_caption_retains_known_spend(module,settings):
    provider=make_provider(module,settings,lambda r:httpx.Response(200,json=caption_response(text='')))
    try:
        with pytest.raises(ProviderFailure) as e:await caption(provider,webp(),{**LUNA_PROFILE,'prompt_version':DEFAULT_PROMPT_VERSION})
        assert e.value.dispatch_state=='responded' and e.value.cost_usd==Decimal('0.000110')
    finally:await provider.aclose()

@pytest.mark.asyncio
async def test_missing_usage_remains_unknown(module,settings):
    payload=caption_response();payload.pop('usage')
    provider=make_provider(module,settings,lambda r:httpx.Response(200,json=payload))
    try:assert (await caption(provider,webp(),{**LUNA_PROFILE,'prompt_version':DEFAULT_PROMPT_VERSION})).cost_usd is None
    finally:await provider.aclose()

@pytest.mark.asyncio
async def test_legacy_uses_original_pixels_and_model(module,settings):
    original=webp((2048,1536))
    def handler(request):
        payload=json.loads(request.content)
        assert payload['model']=='gpt-5.4-mini'
        assert base64.b64decode(payload['input'][0]['content'][0]['image_url'].split(',')[1])==original
        return httpx.Response(200,json=caption_response())
    provider=make_provider(module,settings,handler)
    try:assert (await caption(provider,original,{'caption_model':'gpt-5.4-mini','prompt_version':DEFAULT_PROMPT_VERSION})).cost_usd==Decimal('0.000840')
    finally:await provider.aclose()


def test_profile_switch_preserves_old_snapshot_and_rejects_unreviewed():
    s=Settings(database_url='postgresql+asyncpg://x:x@postgres/x',ai_real_calls_enabled=True,openai_api_key='test')
    old=content_snapshot(s)
    s.album_content_caption_profile='luna_1024_v1';new=content_snapshot(s)
    assert old['caption_model']=='gpt-5.4-mini' and new['caption_model']=='gpt-6-luna'
    assert new['caption_prompt_version']==SHORT_MEMORY_VERSION
    original_luna={k:v for k,v in new.items() if k!='caption_prompt_version'}
    assert supported_snapshot(original_luna,s)
    assert instructions(original_luna)==caption_prompt(DEFAULT_PROMPT_VERSION)
    assert supported_snapshot(old,s) and supported_snapshot(new,s)
    assert not supported_snapshot({**new,'caption_analysis_profile':'unknown'},s)
    assert not supported_snapshot({**new,'caption_pricing_profile':None},s)
    assert not supported_snapshot({**old,'caption_model':'gpt-6-luna'},s)
    assert not supported_snapshot({**new,'caption_prompt_version':'future'},s)
    assert not supported_snapshot({**old,'caption_prompt_version':SHORT_MEMORY_VERSION},s)
    s.album_content_caption_profile='mini_full_v1'
    assert supported_snapshot(new,s)


@pytest.mark.asyncio
async def test_new_album_wording_is_explicit_while_old_luna_instructions_stay_frozen(module,settings):
    sent=[]
    def handler(request):
        sent.append(json.loads(request.content)['instructions'])
        return httpx.Response(200,json=caption_response())
    provider=make_provider(module,settings,handler)
    old={**LUNA_PROFILE,'prompt_version':DEFAULT_PROMPT_VERSION}
    try:
        await caption(provider,webp(),old)
        await caption(provider,webp(),{**old,'caption_prompt_version':SHORT_MEMORY_VERSION})
        assert sent[0]==caption_prompt(DEFAULT_PROMPT_VERSION)
        assert sent[1]==instructions({**old,'caption_prompt_version':SHORT_MEMORY_VERSION})
        assert sent[0]!=sent[1]
        with pytest.raises(ProviderFailure) as e:
            await caption(provider,webp(),{**old,'caption_prompt_version':'unknown'})
        assert e.value.dispatch_state=='not_sent' and len(sent)==2
    finally:await provider.aclose()
