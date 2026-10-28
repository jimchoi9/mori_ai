"""Explicit local-only, <=10-call cost comparison; never rewrites album content.

Use only with user approval for this album's photographs and paid OpenAI calls.
Output contains generated text: keep it in a gitignored private local directory.
An existing output file is never rerun, including interrupted/unknown attempts.
"""
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
from time import monotonic
from uuid import UUID,uuid4
from decimal import Decimal

from sqlalchemy import select,func
from backend.settings import Settings
from backend.database import session_factory
from backend.models import Album,Page,MediaAsset,AlbumCaptionJob,AIBudgetEntry,Task
from backend.storage.factory import media_storage
from backend.album_content.caption import LUNA_PROFILE,analysis_image,caption
from backend.generation.openai_provider import OpenAIProvider,ProviderFailure,CAPTION_RESERVATION_USD
from backend.generation.budget import BudgetLedger
from backend.generation.service import require_consent
from backend.albums.access import require_album_access
from backend.access.service import require_access


def write_report(path,report):
    temp=path.with_suffix('.pending')
    with temp.open('w') as f:
        os.chmod(temp,0o600)
        json.dump(report,f,ensure_ascii=False,indent=2,default=str);f.flush();os.fsync(f.fileno())
    temp.replace(path)


async def run(args):
    path=Path(args.output)
    if path.exists() or path.with_suffix('.pending').exists():raise ValueError('Existing experiment: never replay paid calls')
    settings=Settings()
    assert settings.app_env=='local' and settings.ai_real_calls_enabled and settings.album_content_enabled
    assert settings.ai_validation_initial_budget_usd<=Decimal('3') and not settings.goods_mail_enabled
    db=session_factory();store=media_storage(settings);provider=OpenAIProvider(settings)
    ledger=BudgetLedger(db,settings.ai_validation_initial_budget_usd,settings.ai_validation_budget_usd)
    report={'experiment':str(uuid4()),'max_calls':10,'max_reserved_usd':'0.20','baseline':[],'results':[]}
    try:
        async with db() as s:
            album=await s.get(Album,UUID(args.album))
            assert album and album.deleted_at is None and album.content_enabled
            await require_access(s,settings,album.owner_id);await require_album_access(s,album);await require_consent(s,album.owner_id,settings)
            rows=(await s.execute(select(Page,MediaAsset,AlbumCaptionJob,AIBudgetEntry).join(MediaAsset,Page.normalized_asset_id==MediaAsset.id)
                .join(AlbumCaptionJob,AlbumCaptionJob.page_id==Page.id).join(AIBudgetEntry,AIBudgetEntry.attempt_id==AlbumCaptionJob.attempt_id)
                .where(Page.album_id==album.id,Page.removed_at.is_(None),AlbumCaptionJob.status=='succeeded').order_by(Page.position).limit(5))).all()
            assert len(rows)==5
            for index,(page,asset,job,entry) in enumerate(rows):
                assert job.config_snapshot['caption_model']=='gpt-5.4-mini' and not job.config_snapshot.get('caption_analysis_profile')
                assert entry.actual_usd is not None and asset.sha256==job.input_sha256
                report['baseline'].append({'sample':index+1,'sha256':asset.sha256,'size':[asset.width,asset.height],
                    'cost_usd':entry.actual_usd,'usage':entry.usage,'caption':page.ai_caption})
        report['budget_before']=await ledger.summary();write_report(path,report)
        for arm in ('mini_1024','luna_1024'):
            for index,(page,asset,job,entry) in enumerate(rows):
                async with db() as s:
                    assert await s.scalar(select(func.count()).select_from(AlbumCaptionJob).where(AlbumCaptionJob.status=='running'))==0
                    assert await s.scalar(select(func.count()).select_from(Task).where(Task.status=='running'))==0
                    current=await s.get(Page,page.id)
                    assert current and current.removed_at is None and current.normalized_asset_id==asset.id
                source=await asyncio.to_thread(store.read_bytes,asset.storage_key)
                assert hashlib.sha256(source).hexdigest()==asset.sha256
                attempt=uuid4();item={'arm':arm,'sample':index+1,'attempt':str(attempt),'state':'pending'}
                report['results'].append(item);write_report(path,report)
                assert len(report['results'])<=10
                if not await ledger.reserve(attempt,CAPTION_RESERVATION_USD):raise ValueError('Previously reserved attempt')
                started=monotonic()
                try:
                    if arm=='mini_1024':
                        small=await asyncio.to_thread(analysis_image,source)
                        result=await provider.caption(small,prompt_version=job.config_snapshot['prompt_version'])
                    else:
                        result=await caption(provider,source,{**job.config_snapshot,**LUNA_PROFILE})
                    item.update(state='responded',caption=result.caption,usage=result.usage,cost_usd=result.cost_usd,
                        request_id=result.request_id,seconds=round(monotonic()-started,3))
                    # Durable response before settlement; rerunning this file is forbidden.
                    write_report(path,report)
                    await ledger.settle(attempt,result.cost_usd,result.usage,result.request_id)
                    if result.cost_usd is None:raise ValueError('Unknown usage: stop experiment')
                except ProviderFailure as e:
                    item.update(state=e.dispatch_state,error=e.code,cost_usd=e.cost_usd,usage=e.usage,seconds=round(monotonic()-started,3))
                    write_report(path,report)
                    if e.dispatch_state=='not_sent':await ledger.release_unsent(attempt)
                    else:await ledger.settle(attempt,e.cost_usd,e.usage,e.request_id)
                    raise ValueError('Provider failure: stopped without retry') from None
                except BaseException:
                    if item['state']=='pending':
                        item['state']='unknown';write_report(path,report)
                        await ledger.settle(attempt,None,{},None)
                    raise
        report['budget_after']=await ledger.summary();write_report(path,report)
        print(json.dumps({'completed_calls':len(report['results']),'budget':report['budget_after'],
            'arms':{arm:{'calls':sum(r['arm']==arm for r in report['results']),
                'usd':sum((r['cost_usd'] for r in report['results'] if r['arm']==arm),Decimal('0'))}
                for arm in ('mini_1024','luna_1024')}},default=str),flush=True)
    finally:
        await provider.aclose();await db.kw['bind'].dispose()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--album',required=True);parser.add_argument('--output',required=True)
    try:asyncio.run(run(parser.parse_args()))
    except Exception as error:
        # Never expose SDK errors, paths, keys, request bodies or customer data.
        print('Caption experiment stopped:',type(error).__name__,flush=True)
        raise SystemExit(1) from None
