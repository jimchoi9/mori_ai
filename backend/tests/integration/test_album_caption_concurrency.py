"""Shared DB caption guard under competing new-content and legacy workers."""
import asyncio
from datetime import timedelta
from uuid import UUID
import pytest
from sqlalchemy import select, func
from backend.models import Run, Task, Page, AlbumCaptionJob
from backend.album_content.worker import ContentWorker
from backend.album_content.service import now
from backend.tests.integration.test_auth_http import client, config
from backend.tests.integration.test_album_content import start, upload


@pytest.mark.asyncio
async def test_competing_claims_share_four_slots_with_legacy_and_release_one(client, db):
    me, aid, settings = await start(client, db)
    for _ in range(5):
        await upload(client, db, me, aid, settings)
    workers = [ContentWorker(db, settings, client._transport.app.state.media_storage) for _ in range(8)]
    await asyncio.gather(*(w.scan() for w in workers))
    async with db() as s, s.begin():
        run = Run(album_id=UUID(aid)); s.add(run); await s.flush()
        task = Task(run_id=run.id, page_id=await s.scalar(select(Page.id).where(Page.album_id==UUID(aid)).limit(1)), stage='caption', status='running', lease_until=now()+timedelta(seconds=60))
        s.add(task); await s.flush(); task_id = task.id
    claimed = [c for c in await asyncio.gather(*(w.claim() for w in workers)) if c]
    assert len(claimed)==3 and len({c['job'] for c in claimed})==3
    async with db() as s:
        assert await s.scalar(select(func.count()).select_from(AlbumCaptionJob))==5
    async with db() as s, s.begin():
        (await s.get(Task,task_id)).status='succeeded'
    fourth = await workers[0].claim(); assert fourth
    assert await workers[0].claim() is None
    assert await workers[0].dispatch(claimed[0])
    assert await workers[0].apply(claimed[0],{'sha':claimed[0]['sha'],'caption':'사진 속 그때를 잠시 떠올린다.'})
    fifth = await workers[0].claim(); assert fifth
    assert len({c['job'] for c in claimed+[fourth,fifth]})==5


@pytest.mark.asyncio
async def test_two_content_instances_settle_once_and_publish_after_out_of_order_results(client, db, monkeypatch):
    from decimal import Decimal
    from backend.models import AIBudgetEntry, Album
    from backend.generation.openai_provider import ProviderResult
    from backend.album_content.prompts import SHORT_MEMORY_VERSION
    import backend.album_content.worker as module
    me,aid,settings=await start(client,db)
    for _ in range(2):await upload(client,db,me,aid,settings)
    settings.dev_ai_enabled=False;settings.ai_real_calls_enabled=True
    settings.album_content_caption_profile='luna_1024_v1'
    active=peak=calls=0; both=asyncio.Event()
    async def fake(provider,data,config):
        nonlocal active,peak,calls
        assert config['caption_prompt_version']==SHORT_MEMORY_VERSION
        calls+=1;number=calls;active+=1;peak=max(peak,active)
        if active==2:both.set()
        try:
            await asyncio.wait_for(both.wait(),2)
            if number==1:await asyncio.sleep(.02)
            return ProviderResult(caption=f'함께 서 있던 순간이 떠오른다{number}.',
                usage={'input_tokens':1,'output_tokens':1,'total_tokens':2},cost_usd=Decimal('.0001'),request_id=f'test_{number}')
        finally:active-=1
    monkeypatch.setattr(module,'caption',fake)
    workers=[ContentWorker(db,settings,client._transport.app.state.media_storage) for _ in range(2)]
    await workers[0].scan()
    assert await asyncio.gather(*(w.run_once() for w in workers))==[True,True]
    await asyncio.gather(*(w.run_once() for w in workers))
    assert calls==2 and peak==2 and active==0
    async with db() as s:
        jobs=(await s.scalars(select(AlbumCaptionJob))).all()
        entries=(await s.scalars(select(AIBudgetEntry))).all()
        assert len(jobs)==len(entries)==2
        assert all(j.status=='succeeded' and j.attempt_count==1 for j in jobs)
        assert all(e.status=='settled' and e.actual_usd==Decimal('.0001') for e in entries)
        album=await s.get(Album,UUID(aid))
        assert album.status=='published' and len(album.content_manifest)==2
