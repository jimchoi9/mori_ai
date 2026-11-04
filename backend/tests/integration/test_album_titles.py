from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace as NS
from uuid import UUID,uuid4
import pytest
from sqlalchemy import select,func,text
from backend.models import Album,AlbumTitleJob,AlbumCaptionJob,Page,AIBudgetEntry
from backend.tests.integration.test_album_content import start,upload,detail,save
from backend.tests.integration.test_auth_http import client,config,login
from backend.tests.integration.test_album_http import headers
from backend.album_titles.worker import TitleWorker
from backend.album_content.worker import ContentWorker
from backend.album_content.service import now
from backend.album_titles.service import register_selection

async def make(client,db):
    me,aid,s=await start(client,db)
    async with db() as session,session.begin():
        album=await session.get(Album,UUID(aid));album.title='새 앨범';album.title_source='pending'
    return me,aid,s

async def prepare(client,db,me,aid,s,count=1):
    ids=[]
    for _ in range(count):
        u=await upload(client,db,me,aid,s,captured='2026:10:11 12:00:00');ids.append(u['page_id'])
    # Mirrors the one selected client group sent as sequential reservations.
    async with db() as session,session.begin():
        album=await session.get(Album,UUID(aid))
        album.title_seed={'group_id':str(uuid4()),'count':count,'started_at':now().isoformat(),'page_ids':ids}
    cw=ContentWorker(db,s,client._transport.app.state.media_storage)
    for _ in ids:await cw.run_once()
    return ids

@pytest.mark.asyncio
async def test_rename_owner_csrf_validation_conflict_and_existing_title_stays_manual(client,db):
    me,aid,s=await make(client,db);d=await detail(client,aid);path=f'/api/v1/albums/{aid}/title';version=d['album']['version']
    body={'expected_version':version,'title':'  기장 여행  '}
    assert (await client.patch(path,json=body)).status_code==403
    for bad in [' ','a'*41,'bad\nname',42]:
        assert (await client.patch(path,json={**body,'title':bad},headers=headers(me))).status_code==422
    r=await client.patch(path,json=body,headers=headers(me));assert r.status_code==200,r.text
    assert r.json()['data']['album']['title']=='기장 여행'
    assert (await client.patch(path,json=body,headers=headers(me))).status_code==409
    await prepare(client,db,me,aid,s)
    tw=TitleWorker(db,s,client._transport.app.state.media_storage);await tw.run_once()
    assert (await detail(client,aid))['album']['title']=='기장 여행'
    await login(client,'beta');other=(await client.get('/api/v1/me')).json()['data']
    assert (await client.patch(path,json=body,headers=headers(other))).status_code==404
    async with db() as session:assert await session.scalar(select(func.count()).select_from(AlbumTitleJob))==0

@pytest.mark.asyncio
async def test_initial_selection_waits_then_names_once_and_future_additions_preserve(client,db):
    me,aid,s=await make(client,db);ids=await prepare(client,db,me,aid,s)
    tw=TitleWorker(db,s,client._transport.app.state.media_storage)
    async with db() as session,session.begin():
        album=await session.get(Album,UUID(aid));album.title_seed={**album.title_seed,'count':2}
    await tw.run_once()
    assert (await detail(client,aid))['album']['title']=='새 앨범'
    async with db() as session,session.begin():
        album=await session.get(Album,UUID(aid));album.title_seed={**album.title_seed,'started_at':(now()-timedelta(minutes=16)).isoformat()}
    await tw.run_once()
    assert (await detail(client,aid))['album']['title']=='사진 모음'
    await upload(client,db,me,aid,s)
    await ContentWorker(db,s,client._transport.app.state.media_storage).run_once();await tw.run_once()
    async with db() as session:
        album=await session.get(Album,UUID(aid));assert album.title_source=='auto'
        assert await session.scalar(select(func.count()).select_from(AlbumTitleJob))==1
        assert await session.scalar(select(func.count()).select_from(AIBudgetEntry))==0

@pytest.mark.asyncio
async def test_legacy_and_same_value_manual_choice_never_auto_renamed(client,db):
    me,aid,s=await make(client,db)
    async with db() as session,session.begin():
        album=await session.get(Album,UUID(aid));album.title_source='legacy';album.title='굿즈 테스트 사진첩'
    await prepare(client,db,me,aid,s)
    tw=TitleWorker(db,s,client._transport.app.state.media_storage);await tw.run_once()
    assert (await detail(client,aid))['album']['title']=='굿즈 테스트 사진첩'
    async with db() as session:assert await session.scalar(select(func.count()).select_from(AlbumTitleJob))==0

@pytest.mark.asyncio
async def test_manual_rename_beats_already_dispatched_title_and_deleted_photo_discards_output(client,db):
    me,aid,s=await make(client,db);ids=await prepare(client,db,me,aid,s)
    tw=TitleWorker(db,s,client._transport.app.state.media_storage)
    await tw.repository.scan();c=await tw.repository.claim();assert await tw.repository.dispatch(c)
    d=await detail(client,aid)
    assert (await client.patch(f'/api/v1/albums/{aid}/title',json={'title':'새 앨범','expected_version':d['album']['version']},headers=headers(me))).status_code==200
    await tw.repository.finish(c,'succeeded',payload={'title':'기장 나들이'})
    async with db() as session:
        album=await session.get(Album,UUID(aid));assert album.title=='새 앨범' and album.title_source=='manual'

@pytest.mark.asyncio
async def test_capture_period_uses_only_ready_capture_dates_not_upload_or_file_modified(client,db):
    me,aid,s=await make(client,db)
    await upload(client,db,me,aid,s,captured='2026:12:31 23:59:00')
    await upload(client,db,me,aid,s,captured='2027:01:02 00:01:00')
    await upload(client,db,me,aid,s,modified='2025-01-01T00:00:00Z')
    await upload(client,db,me,aid,s,captured='2020:01:01 00:00:00',validate=False)
    period={'start':'2026-12-31','end':'2027-01-02'}
    assert (await detail(client,aid))['album']['capture_period']==period
    assert (await client.get('/api/v1/albums')).json()['data']['items'][0]['capture_period']==period

@pytest.mark.asyncio
async def test_unknown_title_call_reserves_once_and_never_resends(client,db):
    from backend.generation.openai_provider import ProviderFailure
    class Provider:
        def __init__(self):self.calls=0;self.client=NS(responses=NS(create='request'))
        async def _call(self,*args,**kwargs):self.calls+=1;raise ProviderFailure('AI_RESULT_UNKNOWN',dispatch_state='unknown')
    me,aid,s=await make(client,db);await prepare(client,db,me,aid,s)
    s.ai_real_calls_enabled=True;s.dev_ai_enabled=False
    provider=Provider();tw=TitleWorker(db,s,client._transport.app.state.media_storage,provider)
    await tw.run_once();await tw.run_once();await tw.run_once()
    assert provider.calls==1
    async with db() as session:
        job=await session.scalar(select(AlbumTitleJob));assert job.status=='unknown'
        assert (await session.get(Album,UUID(aid))).title=='새 앨범'
        entry=await session.get(AIBudgetEntry,job.id);assert entry.status=='unknown' and entry.reserved_usd==Decimal('.002')

@pytest.mark.asyncio
async def test_crash_recovers_durable_title_without_provider_and_manual_choice_survives(client,db):
    me,aid,s=await make(client,db);await prepare(client,db,me,aid,s)
    tw=TitleWorker(db,s,client._transport.app.state.media_storage)
    await tw.repository.scan();c=await tw.repository.claim();assert await tw.repository.dispatch(c)
    await tw.results.save(str(c['job']),{'title':'기장 여행'})
    async with db() as session,session.begin():
        job=await session.get(AlbumTitleJob,c['job']);job.lease_until=now()-timedelta(seconds=1)
    await tw.recover();assert (await detail(client,aid))['album']['title']=='기장 여행'

@pytest.mark.asyncio
async def test_selection_boundary_is_durable_across_per_photo_reservations_and_idempotent_replay(client,db):
    from backend.tests.integration.test_easy_upload import optimized
    me,aid,s=await make(client,db);group=str(uuid4())
    for _ in range(2):
        version=(await detail(client,aid))['album']['version']
        body={'expected_version':version,'selection_id':group,'selection_count':2,'files':[optimized()]}
        h=headers(me,str(uuid4()));r=await client.post(f'/api/v1/albums/{aid}/uploads',json=body,headers=h)
        assert r.status_code==201,r.text
        assert (await client.post(f'/api/v1/albums/{aid}/uploads',json=body,headers=h)).json()['data']==r.json()['data']
    async with db() as session:
        seed=(await session.get(Album,UUID(aid))).title_seed
        assert seed['group_id']==group and seed['count']==2 and len(seed['page_ids'])==2
    body={'expected_version':(await detail(client,aid))['album']['version'],'files':[optimized()],'selection_id':group}
    assert (await client.post(f'/api/v1/albums/{aid}/uploads',json=body,headers=headers(me,str(uuid4())))).status_code==422

@pytest.mark.asyncio
async def test_deleted_initial_photo_cancels_title_before_dispatch(client,db):
    me,aid,s=await make(client,db);ids=await prepare(client,db,me,aid,s)
    tw=TitleWorker(db,s,client._transport.app.state.media_storage)
    await tw.repository.scan();c=await tw.repository.claim()
    async with db() as session,session.begin():
        p=await session.get(Page,UUID(ids[0]));p.removed_at=now()
    assert not await tw.repository.dispatch(c)
    await tw.repository.finish(c,'cancelled')
    assert (await detail(client,aid))['album']['title']=='새 앨범'

@pytest.mark.asyncio
async def test_explicit_selection_completion_finishes_after_local_failure_and_checks_owner_csrf(client,db):
    me,aid,s=await make(client,db);await prepare(client,db,me,aid,s)
    tw=TitleWorker(db,s,client._transport.app.state.media_storage)
    async with db() as session,session.begin():
        album=await session.get(Album,UUID(aid));album.title_seed={**album.title_seed,'count':2};group=album.title_seed['group_id']
    path=f'/api/v1/albums/{aid}/title-selection/complete';body={'selection_id':group}
    assert (await client.post(path,json=body)).status_code==403
    await tw.repository.scan()
    async with db() as session:assert await session.scalar(select(func.count()).select_from(AlbumTitleJob))==0
    assert (await client.post(path,json={'selection_id':str(uuid4())},headers=headers(me))).status_code==200
    await tw.repository.scan()
    async with db() as session:assert await session.scalar(select(func.count()).select_from(AlbumTitleJob))==0
    for _ in range(2):assert (await client.post(path,json=body,headers=headers(me))).status_code==200
    await tw.run_once();assert (await detail(client,aid))['album']['title']=='사진 모음'
    await login(client,'beta');other=(await client.get('/api/v1/me')).json()['data']
    assert (await client.post(path,json=body,headers=headers(other))).status_code==404

@pytest.mark.asyncio
async def test_dispatch_lease_and_removed_photo_never_apply_a_stale_title(client,db):
    me,aid,s=await make(client,db);ids=await prepare(client,db,me,aid,s)
    tw=TitleWorker(db,s,client._transport.app.state.media_storage)
    await tw.repository.scan();c=await tw.repository.claim();assert await tw.repository.dispatch(c)
    async with db() as session,session.begin():
        page=await session.get(Page,UUID(ids[0]));page.removed_at=now()
    await tw.repository.finish(c,'succeeded',payload={'title':'이전 사진 제목'})
    assert (await detail(client,aid))['album']['title']=='새 앨범'

@pytest.mark.asyncio
async def test_title_jobs_share_four_slot_limit_with_caption_workers(client,db):
    from backend.models import User
    me,aid,s=await make(client,db);await prepare(client,db,me,aid,s)
    async with db() as session,session.begin():
        for _ in range(4):
            album=Album(owner_id=UUID(me['user']['id']),content_enabled=True,legacy_access=True);session.add(album);await session.flush()
            session.add(AlbumTitleJob(album_id=album.id,captions=[],config_snapshot={},status='running',lease_until=now()+timedelta(seconds=120)))
    tw=TitleWorker(db,s,client._transport.app.state.media_storage)
    await tw.repository.scan();assert await tw.repository.claim() is None
    assert await ContentWorker(db,s,client._transport.app.state.media_storage).claim() is None

@pytest.mark.asyncio
async def test_abandoned_selections_do_not_starve_later_ready_album(client,db):
    me,aid,s=await make(client,db);await prepare(client,db,me,aid,s)
    async with db() as session,session.begin():
        for i in range(31):
            session.add(Album(id=UUID(int=i+1),owner_id=UUID(me['user']['id']),content_enabled=True,title_source='pending',
                title_seed={'group_id':str(uuid4()),'count':1,'started_at':now().isoformat(),'page_ids':[]}))
    tw=TitleWorker(db,s,client._transport.app.state.media_storage)
    await tw.repository.scan()
    async with db() as session:assert await session.scalar(select(func.count()).select_from(AlbumTitleJob))==0
    await tw.repository.scan()
    async with db() as session:assert await session.scalar(select(func.count()).select_from(AlbumTitleJob))==1

@pytest.mark.asyncio
async def test_unknown_receipts_do_not_starve_later_crash_recovery(client,db):
    me,aid,s=await make(client,db);await prepare(client,db,me,aid,s)
    tw=TitleWorker(db,s,client._transport.app.state.media_storage)
    await tw.repository.scan();c=await tw.repository.claim();assert await tw.repository.dispatch(c)
    await tw.results.save(str(c['job']),{'title':'기장 여행'})
    async with db() as session,session.begin():
        target=await session.get(AlbumTitleJob,c['job']);target.lease_until=now()-timedelta(seconds=1)
        for i in range(31):
            album=Album(owner_id=UUID(me['user']['id']));session.add(album);await session.flush()
            session.add(AlbumTitleJob(id=UUID(int=i+1),album_id=album.id,captions=[],config_snapshot={'execution_mode':'local_fake'},status='unknown'))
    await tw.recover();assert (await detail(client,aid))['album']['title']=='새 앨범'
    await tw.recover();assert (await detail(client,aid))['album']['title']=='기장 여행'

@pytest.mark.asyncio
async def test_migration_preserves_preexisting_title_and_marks_it_legacy(client,db):
    import asyncio,subprocess
    me=await login(client);old_id=uuid4()
    # The dedicated fixture guarantees this is the disposable workflow database.
    await asyncio.to_thread(subprocess.run,['python','-m','alembic','-c','backend/alembic.ini','downgrade','0019_photo_gps'],check=True,capture_output=True)
    try:
        async with db() as session,session.begin():
            await session.execute(text("INSERT INTO albums(id,owner_id,title,status,version) VALUES(:id,:owner,:title,'draft',1)"),{'id':old_id,'owner':UUID(me['user']['id']),'title':'내가 지은 오래된 앨범'})
    finally:
        await asyncio.to_thread(subprocess.run,['python','-m','alembic','-c','backend/alembic.ini','upgrade','head'],check=True,capture_output=True)
    async with db() as session:
        album=await session.get(Album,old_id)
        assert album.title=='내가 지은 오래된 앨범' and album.title_source=='legacy' and album.title_seed is None

@pytest.mark.asyncio
@pytest.mark.parametrize('outcome',['success','budget_denied','not_sent','invalid_responded'])
async def test_real_mode_title_billing_boundaries_without_network(client,db,outcome):
    from backend.generation.openai_provider import ProviderFailure
    class Provider:
        def __init__(self):self.calls=0;self.client=NS(responses=NS(create='request'))
        async def _call(self,*args,**kwargs):
            self.calls+=1
            if outcome=='not_sent':raise ProviderFailure('AI_TEMPORARY_FAILURE',dispatch_state='not_sent')
            return NS(status='completed',output_text='{"title":"' + ('a'*25 if outcome=='invalid_responded' else '기장 여행') + '"}',usage={'input_tokens':200,'output_tokens':20,'total_tokens':220},_request_id='synthetic')
    me,aid,s=await make(client,db);await prepare(client,db,me,aid,s)
    s.ai_real_calls_enabled=True;s.dev_ai_enabled=False
    if outcome=='budget_denied':s.ai_validation_initial_budget_usd=Decimal('.001')
    provider=Provider();worker=TitleWorker(db,s,client._transport.app.state.media_storage,provider)
    await worker.run_once();await worker.run_once()
    async with db() as session:
        album=await session.get(Album,UUID(aid));job=await session.scalar(select(AlbumTitleJob));entry=await session.get(AIBudgetEntry,job.id)
        if outcome=='budget_denied':
            assert provider.calls==0 and entry is None and job.error_code=='USAGE_LIMIT_EXCEEDED'
        else:
            assert provider.calls==1
            assert entry.status==('released' if outcome=='not_sent' else 'settled')
            if outcome!='not_sent':assert entry.actual_usd==Decimal('.00003')
        assert album.title==('기장 여행' if outcome=='success' else '새 앨범')
        assert job.status==('succeeded' if outcome=='success' else 'failed')

@pytest.mark.asyncio
@pytest.mark.parametrize('disabled',['content','executor','legacy_mode'])
async def test_title_pending_does_not_poll_when_no_title_worker_can_run(client,db,disabled):
    me,aid,s=await make(client,db);await prepare(client,db,me,aid,s)
    if disabled=='content':s.album_content_enabled=False
    elif disabled=='executor':s.dev_ai_enabled=False;s.ai_real_calls_enabled=False
    else:
        async with db() as session,session.begin():
            album=await session.get(Album,UUID(aid));album.content_enabled=False
    d=await detail(client,aid);assert d['album']['title_pending'] is False
    assert (await client.get('/api/v1/albums')).json()['data']['items'][0]['title_pending'] is False

@pytest.mark.asyncio
async def test_fresh_empty_pending_album_is_not_a_title_job(client,db):
    from backend.albums.repository import insert_album
    me=await login(client);s=client._transport.app.state.settings;s.album_content_enabled=True;s.dev_ai_enabled=True
    async with db() as session,session.begin():
        album=await insert_album(session,UUID(me['user']['id']));album.content_enabled=True
    worker=TitleWorker(db,s,client._transport.app.state.media_storage)
    await worker.run_once()
    async with db() as session:assert await session.scalar(select(func.count()).select_from(AlbumTitleJob))==0

@pytest.mark.asyncio
async def test_invalid_responded_title_recovers_accounting_after_settlement_crash(client,db):
    class Provider:
        def __init__(self):self.calls=0;self.client=NS(responses=NS(create='request'))
        async def _call(self,*args,**kwargs):
            self.calls+=1
            return NS(status='completed',output_text='not-json',usage={'input_tokens':200,'output_tokens':20,'total_tokens':220},_request_id='synthetic')
    me,aid,s=await make(client,db);await prepare(client,db,me,aid,s)
    s.ai_real_calls_enabled=True;s.dev_ai_enabled=False
    provider=Provider();worker=TitleWorker(db,s,client._transport.app.state.media_storage,provider)
    settle=worker.ledger.settle
    async def unavailable(*a,**kw):raise RuntimeError('simulated ledger outage')
    worker.ledger.settle=unavailable
    with pytest.raises(RuntimeError):await worker.run_once()
    async with db() as session,session.begin():
        job=await session.scalar(select(AlbumTitleJob));job.lease_until=now()-timedelta(seconds=1);job_id=job.id
    worker.ledger.settle=settle
    await worker.run_once();await worker.run_once()
    assert provider.calls==1
    async with db() as session:
        job=await session.get(AlbumTitleJob,job_id);entry=await session.get(AIBudgetEntry,job_id)
        assert job.status=='failed' and entry.status=='settled' and entry.actual_usd==Decimal('.00003')
        assert (await session.get(Album,UUID(aid))).title=='새 앨범'
