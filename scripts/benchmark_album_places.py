"""Approved-local six-call comparison using only previously tested photo hashes.

Run on the existing local runtime/schema (no migrations). Mount the candidate
caption/prompts/place_context/preprocessing modules only. Never writes captions.
Missing GPS stays missing. Reference comparisons are deliberately adversarial,
not a claim that the old photographs were captured together.
"""
import argparse
import asyncio
import hashlib
import json
from decimal import Decimal
from pathlib import Path
from time import monotonic
from uuid import uuid4

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
from backend.album_content.caption import caption, content_snapshot, analysis_image
from backend.album_content.prompts import instructions
from scripts.benchmark_album_captions import write_report
from scripts.benchmark_luna_grouping import frozen_rows


async def run(args):
    path=Path(args.output)
    assert not path.exists() and not path.with_suffix('.pending').exists(), 'Never replay paid experiment'
    settings=Settings()
    assert settings.app_env=='local' and settings.ai_real_calls_enabled and not settings.goods_mail_enabled
    assert settings.ai_validation_initial_budget_usd<=Decimal('3')
    prior=json.loads(Path(args.prior).read_text())
    hashes={row['sha256'] for row in prior['baseline']}
    assert len(hashes)==5
    db=session_factory();store=media_storage(settings);provider=OpenAIProvider(settings)
    ledger=BudgetLedger(db,settings.ai_validation_initial_budget_usd,settings.ai_validation_budget_usd)
    max_calls=4 if args.revised else 6
    report={'max_calls':max_calls,'max_cumulative_reservations_usd':str(Decimal('.02')*max_calls),'results':[],
            'gps':'absent; no synthetic GPS supplied', 'references':'adversarial comparison, no temporal claim', 'completed':False}
    try:
        report['before_rows']=await frozen_rows(db)
        async with db() as s:
            for model in (AlbumCaptionJob,Task):
                assert await s.scalar(select(func.count()).select_from(model).where(model.status.in_(('running','queued'))))==0
            rows=(await s.execute(select(Page,MediaAsset).join(MediaAsset,Page.normalized_asset_id==MediaAsset.id)
                .where(Page.removed_at.is_(None),MediaAsset.status=='ready',MediaAsset.deleted_at.is_(None),MediaAsset.sha256.in_(hashes))
                .order_by(Page.position))).all()
            assert len(rows)>=3 and len({p.album_id for p,a in rows})==1
            album=await s.get(Album,rows[0][0].album_id);assert album and album.deleted_at is None
            await require_access(s,settings,album.owner_id);await require_album_access(s,album)
            await require_consent(s,album.owner_id,settings)
        photos=[]
        for index,(page,asset) in enumerate(rows[:3]):
            data=await asyncio.to_thread(store.read_bytes,asset.storage_key)
            assert hashlib.sha256(data).hexdigest()==asset.sha256
            photos.append(data)
            # Private pixel-only contact sheet inputs for human inspection.
            (path.parent/f'sample-{index+1}.webp').write_bytes(analysis_image(data))
        report['budget_before']=await ledger.summary()
        if args.preflight:
            print(json.dumps({'eligible_photos':len(rows),'budget':report['budget_before'],'paid_calls':0},default=str))
            return
        write_report(path,report)
        async def call(sample,arm,refs=()):
            assert len(report['results'])<max_calls
            settings.album_content_caption_profile='luna_1024_v1' if arm=='short' else 'luna_places_1024_v1'
            snapshot=content_snapshot(settings)
            attempt=uuid4();entry={'sample':sample+1,'arm':arm,'attempt':str(attempt),'state':'pending',
                'prompt_version':snapshot['caption_prompt_version'],
                'prompt_sha256':hashlib.sha256(instructions(snapshot).encode()).hexdigest()}
            report['results'].append(entry);write_report(path,report)
            assert await ledger.reserve(attempt,Decimal('.02'))
            started=monotonic()
            try:
                result=await caption(provider,photos[sample],snapshot,reference_images=refs)
                entry.update(state='responded',text=result.caption,usage=result.usage,cost_usd=result.cost_usd,
                             seconds=monotonic()-started,request_id=result.request_id)
                write_report(path,report)
                await ledger.settle(attempt,result.cost_usd,result.usage,result.request_id)
                assert result.cost_usd is not None
            except ProviderFailure as error:
                entry.update(state=error.dispatch_state,error=error.code,cost_usd=error.cost_usd,usage=error.usage)
                write_report(path,report)
                if error.dispatch_state=='not_sent':await ledger.release_unsent(attempt)
                else:await ledger.settle(attempt,error.cost_usd,error.usage,error.request_id)
                raise RuntimeError('No retry after provider failure') from None
            except BaseException:
                if entry['state']=='pending':
                    entry['state']='unknown';write_report(path,report);await ledger.settle(attempt,None,{},None)
                raise
            print(json.dumps({'sample':sample+1,'arm':arm,'state':entry['state']}),flush=True)
        for index in (0,1):
            if not args.revised: await call(index,'short')
            await call(index,'place_action')
            await call(index,'place_action_adversarial',[(photos[2],None)])
        report['completed']=True
    finally:
        try:
            if report.get('budget_before') and not args.preflight:
                report['budget_after']=await ledger.summary();report['after_rows']=await frozen_rows(db)
                report['rows_preserved']=report['before_rows']==report['after_rows'];write_report(path,report)
                print(json.dumps({key:report[key] for key in ('completed','budget_after','rows_preserved')},default=str),flush=True)
        finally:
            await provider.aclose();await db.kw['bind'].dispose()


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for key in ('prior','output'):parser.add_argument('--'+key,required=True)
    parser.add_argument('--preflight',action='store_true')
    parser.add_argument('--revised',action='store_true')
    try:asyncio.run(run(parser.parse_args()))
    except Exception as error:
        print('Experiment stopped:',type(error).__name__,flush=True)
        raise SystemExit(1) from None
