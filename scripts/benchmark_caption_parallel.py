"""Approved local research: 6 photos x 2 sizes; 10 slots x 1/2/4 lanes x 2 rounds.

At most 72 calls, cumulative reservations USD1.44. No retry, product writes,
or scheduler changes. Private report is durable before and after dispatch.
In-flight requests drain on failure; queued requests stop without dispatch.
"""
import argparse
import asyncio
import base64
import hashlib
import json
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from time import monotonic
from uuid import UUID, uuid4

from PIL import Image, ImageOps
from sqlalchemy import select, func
from backend.settings import Settings
from backend.database import session_factory
from backend.models import Album, Page, MediaAsset, AlbumCaptionJob, Task, AIBudgetEntry
from backend.storage.factory import media_storage
from backend.generation.budget import BudgetLedger
from backend.generation.openai_provider import OpenAIProvider, ProviderFailure, _caption
from backend.generation.prompt_profiles import caption_prompt, DEFAULT_PROMPT_VERSION
from backend.generation.service import require_consent
from backend.access.service import require_access
from backend.albums.access import require_album_access
from backend.album_content.caption import analysis_image, caption, LUNA_PROFILE
from backend.goods_design.suggestions.provider import accounting
from scripts.benchmark_album_captions import write_report
from scripts.benchmark_luna_grouping import frozen_rows


def stored_equivalent(data):
    """Research-only approximation of phone 2048/Q85; not a Safari codec test."""
    with Image.open(BytesIO(data)) as source:
        assert source.width * source.height <= 40_000_000
        image = ImageOps.exif_transpose(source).convert('RGB')
        image.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
        while True:
            out = BytesIO()
            image.save(out, 'WEBP', quality=85, method=4)
            if len(out.getvalue()) <= 1_000_000:
                return out.getvalue()
            assert max(image.size) > 1024
            image.thumbnail(tuple(max(1, int(x * .8)) for x in image.size), Image.Resampling.LANCZOS)


async def bounded(items, lanes, operation, stopped):
    """Do not cancel charged requests or dispatch queued work after failure."""
    semaphore = asyncio.Semaphore(lanes)
    async def one(index, item):
        async with semaphore:
            if stopped.is_set():
                return None
            try:
                return await operation(index, item)
            except Exception:
                stopped.set()
                raise
    outcomes = await asyncio.gather(*(one(i, item) for i, item in enumerate(items)), return_exceptions=True)
    if any(isinstance(item, BaseException) for item in outcomes):
        raise RuntimeError('Request failure: in-flight drained; queued calls stopped')
    return outcomes


async def run(args):
    path = Path(args.output)
    assert not path.exists() and not path.with_suffix('.pending').exists(), 'Never replay experiment'
    settings = Settings()
    assert settings.app_env == 'local' and settings.ai_real_calls_enabled and settings.album_content_enabled
    assert settings.ai_validation_initial_budget_usd <= Decimal('3') and not settings.goods_mail_enabled
    db = session_factory(); store = media_storage(settings); provider = OpenAIProvider(settings)
    ledger = BudgetLedger(db, settings.ai_validation_initial_budget_usd, settings.ai_validation_budget_usd)
    stopped = asyncio.Event()
    report = {'max_calls': 72, 'max_cumulative_reserved_usd': '1.44', 'results': [], 'groups': [],
              'sample_policy': 'five_existing_plus_user_attached; performance repeats first four of six',
              'prompt_version': DEFAULT_PROMPT_VERSION, 'completed': False}

    async def call(arm, round_no, sample, operation):
        assert not stopped.is_set() and len(report['results']) < 72
        attempt = uuid4()
        entry = {'arm': arm, 'round': round_no, 'sample': sample, 'attempt': str(attempt), 'state': 'pending'}
        report['results'].append(entry); write_report(path, report)
        assert await ledger.reserve(attempt, Decimal('.02'))
        started = monotonic()
        try:
            result = await operation()
            entry.update(result, state='responded', seconds=monotonic() - started)
            write_report(path, report)
            await ledger.settle(attempt, result['cost_usd'], result['usage'], result['request_id'])
            assert result['cost_usd'] is not None, 'Unknown cost'
        except ProviderFailure as error:
            stopped.set()
            entry.update(state=error.dispatch_state, error=error.code, seconds=monotonic()-started,
                         cost_usd=error.cost_usd, usage=error.usage)
            write_report(path, report)
            if error.dispatch_state == 'not_sent': await ledger.release_unsent(attempt)
            else: await ledger.settle(attempt, error.cost_usd, error.usage, error.request_id)
            raise RuntimeError('Paid call failed; never retry') from None
        except BaseException:
            stopped.set()
            if entry['state'] == 'pending':
                entry['state'] = 'unknown'; write_report(path, report)
                await ledger.settle(attempt, None, {}, None)
            raise
        return entry

    async def single(data):
        result = await caption(provider, data, {**LUNA_PROFILE, 'prompt_version': DEFAULT_PROMPT_VERSION})
        return {'text': result.caption, 'usage': result.usage, 'cost_usd': result.cost_usd, 'request_id': result.request_id}

    async def full(data):
        response = await provider._call(provider.client.responses.create, model='gpt-6-luna',
            instructions=caption_prompt(DEFAULT_PROMPT_VERSION),
            input=[{'role': 'user', 'content': [{'type': 'input_image', 'detail': 'high',
                'image_url': 'data:image/webp;base64,' + base64.b64encode(data).decode()}]}],
            tools=[], max_output_tokens=256, reasoning={'effort': 'none'}, store=False,
            background=False, service_tier='default', timeout=60.0)
        usage, cost, request_id = accounting(response)
        text = _caption(response.output_text)
        if response.status != 'completed' or text is None:
            raise ProviderFailure('CAPTION_INVALID', dispatch_state='responded', usage=usage, cost_usd=cost, request_id=request_id)
        return {'text': text, 'usage': usage, 'cost_usd': cost, 'request_id': request_id}

    try:
        report['before_rows'] = await frozen_rows(db)
        async with db() as s:
            assert await s.scalar(select(func.count()).select_from(AlbumCaptionJob).where(AlbumCaptionJob.status=='running')) == 0
            assert await s.scalar(select(func.count()).select_from(Task).where(Task.status=='running')) == 0
            album = await s.get(Album, UUID(args.album)); assert album and album.deleted_at is None
            await require_access(s, settings, album.owner_id); await require_album_access(s, album)
            await require_consent(s, album.owner_id, settings)
            rows = (await s.execute(select(Page, MediaAsset).join(MediaAsset, Page.normalized_asset_id==MediaAsset.id)
                .where(Page.album_id==album.id, Page.removed_at.is_(None)).order_by(Page.position).limit(5))).all()
            assert len(rows) == 5
            report['unknown_before'] = await s.scalar(select(func.count()).select_from(AIBudgetEntry).where(AIBudgetEntry.status=='unknown'))
        photos = []
        for page, asset in rows:
            data = await asyncio.to_thread(store.read_bytes, asset.storage_key)
            assert hashlib.sha256(data).hexdigest() == asset.sha256
            photos.append(data)
        original = Path(args.photo).read_bytes()
        with Image.open(BytesIO(original)) as image:
            report['attached_original'] = {'size': list(image.size), 'bytes': len(original)}
        photos.append(await asyncio.to_thread(stored_equivalent, original))
        report['photos'] = []
        for data in photos:
            reduced = analysis_image(data)
            with Image.open(BytesIO(data)) as a, Image.open(BytesIO(reduced)) as b:
                report['photos'].append({'stored_size': list(a.size), 'stored_bytes': len(data),
                    'analysis_size': list(b.size), 'analysis_bytes': len(reduced)})
        report['budget_before'] = await ledger.summary(); write_report(path, report)
        for i, data in enumerate(photos):
            for arm in (('quality_full','quality_small') if i % 2 == 0 else ('quality_small','quality_full')):
                await call(arm, 1, i + 1, lambda data=data, arm=arm: full(data) if arm=='quality_full' else single(data))
            print(json.dumps({'done':'size_pair','sample':i+1}), flush=True)
        sources = photos + photos[:4]
        for round_no, order in enumerate(((1,2,4),(4,2,1)), 1):
            for lanes in order:
                started = monotonic(); completions = []
                async def operation(index, data):
                    entry = await call(f'parallel_{lanes}', round_no, index+1, lambda: single(data))
                    completions.append(monotonic()-started)
                    return entry
                entries = await bounded(sources, lanes, operation, stopped)
                report['groups'].append({'lanes':lanes,'round':round_no,'seconds':monotonic()-started,
                    'first_result_seconds':min(completions),'cost_usd':sum((e['cost_usd'] for e in entries),Decimal('0'))})
                write_report(path, report)
                print(json.dumps({'done':'parallel','lanes':lanes,'round':round_no}),flush=True)
        report['completed'] = True
    finally:
        try:
            if report.get('budget_before'):
                report['after_rows'] = await frozen_rows(db)
                report['rows_preserved'] = report['before_rows']==report['after_rows']
                report['budget_after'] = await ledger.summary()
                async with db() as s:
                    report['unknown_after'] = await s.scalar(select(func.count()).select_from(AIBudgetEntry).where(AIBudgetEntry.status=='unknown'))
                write_report(path, report)
                print(json.dumps({k:report[k] for k in ('completed','rows_preserved','budget_after','unknown_after')},default=str),flush=True)
        finally:
            await provider.aclose(); await db.kw['bind'].dispose()


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    for name in ('album','photo','output'): parser.add_argument('--'+name,required=True)
    try: asyncio.run(run(parser.parse_args()))
    except Exception as error:
        print('Experiment stopped:',type(error).__name__,flush=True)
        raise SystemExit(1) from None
