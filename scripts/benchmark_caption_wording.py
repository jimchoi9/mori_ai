"""Approved-local six-call wording acceptance. Never overwrites product captions."""
import argparse
import asyncio
import hashlib
import json
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4
from time import monotonic
from sqlalchemy import select, func
from backend.settings import Settings
from backend.database import session_factory
from backend.models import Album, Page, MediaAsset, AlbumCaptionJob, Task
from backend.storage.factory import media_storage
from backend.generation.budget import BudgetLedger
from backend.generation.openai_provider import OpenAIProvider, ProviderFailure
from backend.generation.service import require_consent
from backend.access.service import require_access
from backend.albums.access import require_album_access
from backend.album_content.caption import caption, content_snapshot
from scripts.benchmark_album_captions import write_report
from scripts.benchmark_caption_parallel import stored_equivalent, bounded
from scripts.benchmark_luna_grouping import frozen_rows


async def run(args):
    path=Path(args.output)
    assert not path.exists() and not path.with_suffix('.pending').exists(), 'Never replay paid experiment'
    settings=Settings()
    assert settings.app_env=='local' and settings.ai_real_calls_enabled and not settings.goods_mail_enabled
    assert settings.album_content_caption_profile=='luna_1024_v1' and settings.ai_validation_initial_budget_usd<=Decimal('3')
    db=session_factory(); store=media_storage(settings); provider=OpenAIProvider(settings)
    ledger=BudgetLedger(db,settings.ai_validation_initial_budget_usd,settings.ai_validation_budget_usd)
    report={'max_calls':6,'max_cumulative_reserved_usd':'.12','results':[],'completed':False}
    try:
        report['before_rows']=await frozen_rows(db)
        async with db() as s:
            for model in (AlbumCaptionJob,Task):
                assert await s.scalar(select(func.count()).select_from(model).where(model.status=='running'))==0
            album=await s.get(Album,UUID(args.album));assert album and album.deleted_at is None
            await require_access(s,settings,album.owner_id);await require_album_access(s,album)
            await require_consent(s,album.owner_id,settings)
            rows=(await s.execute(select(Page,MediaAsset).join(MediaAsset,Page.normalized_asset_id==MediaAsset.id)
                .where(Page.album_id==album.id,Page.removed_at.is_(None)).order_by(Page.position).limit(5))).all()
            assert len(rows)==5
        photos=[]
        for page,asset in rows:
            data=await asyncio.to_thread(store.read_bytes,asset.storage_key)
            assert hashlib.sha256(data).hexdigest()==asset.sha256;photos.append(data)
        photos.append(await asyncio.to_thread(stored_equivalent,Path(args.photo).read_bytes()))
        snapshot=content_snapshot(settings);report['snapshot']=snapshot
        report['budget_before']=await ledger.summary();write_report(path,report)
        async def call(index,data):
            assert len(report['results'])<6
            attempt=uuid4();entry={'sample':index+1,'attempt':str(attempt),'state':'pending'}
            report['results'].append(entry);write_report(path,report)
            assert await ledger.reserve(attempt,Decimal('.02'))
            started=monotonic()
            try:
                result=await caption(provider,data,snapshot)
                entry.update(state='responded',text=result.caption,usage=result.usage,cost_usd=result.cost_usd,
                             request_id=result.request_id,seconds=monotonic()-started)
                write_report(path,report)
                await ledger.settle(attempt,result.cost_usd,result.usage,result.request_id)
                assert result.cost_usd is not None
            except ProviderFailure as error:
                entry.update(state=error.dispatch_state,error=error.code,cost_usd=error.cost_usd,usage=error.usage)
                write_report(path,report)
                if error.dispatch_state=='not_sent':await ledger.release_unsent(attempt)
                else:await ledger.settle(attempt,error.cost_usd,error.usage,error.request_id)
                raise RuntimeError('Provider failure: no retry') from None
            except BaseException:
                if entry['state']=='pending':
                    entry['state']='unknown';write_report(path,report);await ledger.settle(attempt,None,{},None)
                raise
            return entry
        await bounded(photos,2,call,asyncio.Event());report['completed']=True
    finally:
        try:
            if report.get('budget_before'):
                report['budget_after']=await ledger.summary();report['after_rows']=await frozen_rows(db)
                report['rows_preserved']=report['before_rows']==report['after_rows'];write_report(path,report)
                print(json.dumps({k:report[k] for k in ('completed','budget_after','rows_preserved')},default=str),flush=True)
        finally:
            await provider.aclose();await db.kw['bind'].dispose()


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for key in ('album','photo','output'):parser.add_argument('--'+key,required=True)
    try:asyncio.run(run(parser.parse_args()))
    except Exception as error:
        print('Experiment stopped:',type(error).__name__,flush=True)
        raise SystemExit(1) from None
