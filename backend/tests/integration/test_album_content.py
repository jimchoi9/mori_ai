"""Incremental caption admission, editable publication, replacement and pinned NFC."""
from io import BytesIO
from uuid import UUID,uuid4
from datetime import timedelta
from decimal import Decimal
import pytest
from PIL import Image
from sqlalchemy import select,func
from backend.models import Album,Page,Upload,AlbumCaptionJob,AIBudgetEntry,NfcViewingSession
from backend.tests.integration.test_auth_http import client,config,login
from backend.tests.integration.test_upload_http import setup,consent
from backend.tests.integration.test_album_http import headers
from backend.tests.integration.test_easy_upload import optimized
from backend.tests.integration.test_nfc_viewing import purchased,enter
from backend.uploads.validation import ValidationWorker
from backend.album_content.worker import ContentWorker
from backend.album_content.service import now

async def start(client,db):
    settings=client._transport.app.state.settings
    settings.album_content_enabled=True;settings.easy_upload_enabled=True;settings.dev_ai_enabled=True
    me,aid=await setup(client);await consent(client,me)
    assert (await client.post(f'/api/v1/albums/{aid}/content',json={},headers=headers(me))).status_code==200
    return me,aid,settings

async def detail(client,aid):return (await client.get(f'/api/v1/albums/{aid}')).json()['data']['detail']

async def upload(client,db,me,aid,settings,*,replace=None,validate=True):
    d=await detail(client,aid);out=BytesIO();Image.new('RGB',(600,400),'green').save(out,format='WEBP');data=out.getvalue()
    body={'expected_version':d['album']['version'],'files':[optimized(bytes=len(data))]}
    if replace:body['replaces_page_id']=replace
    h=headers(me,str(uuid4()));r=await client.post(f'/api/v1/albums/{aid}/uploads',json=body,headers=h)
    assert r.status_code==201,r.text
    assert (await client.post(f'/api/v1/albums/{aid}/uploads',json=body,headers=h)).json()['data']==r.json()['data']
    u=r.json()['data']['uploads'][0]
    if not validate:return u
    assert (await client.put(u['upload_url'],content=data,headers={**u['required_headers'],**headers(me)})).status_code==204
    path=f'/api/v1/albums/{aid}/uploads/{u["upload_id"]}'
    assert (await client.post(path+'/complete',json={},headers=headers(me))).status_code==202
    validation=ValidationWorker(db,settings)
    for _ in range(20):
        await validation.run_once()
        if (await client.get(path)).json()['data']['status']=='ready':break
    assert (await client.get(path)).json()['data']['status']=='ready'
    return u

async def save(client,me,aid,page,text):
    r=await client.patch(f'/api/v1/albums/{aid}/pages/{page["id"]}/caption',json={'expected_version':page['version'],'caption_text':text},headers=headers(me))
    assert r.status_code==200,r.text
    return r

@pytest.mark.asyncio
async def test_incremental_caption_auto_publishes_without_image_generation(client,db):
    me,aid,s=await start(client,db);await upload(client,db,me,aid,s)
    worker=ContentWorker(db,s,client._transport.app.state.media_storage)
    await worker.run_once();d=await detail(client,aid)
    assert d['album']['status']=='published' and d['album']['content_ready']
    assert d['pages'][0]['source']['width']==600 and d['pages'][0]['source']['height']==400
    assert d['pages'][0]['caption_text'] and d['pages'][0]['caption_status']=='ready'
    assert (await client.get(f'/api/v1/albums/{aid}/viewer')).status_code==200
    from backend.models import Run,Task
    async with db() as session:
        assert await session.scalar(select(func.count()).select_from(Run))==0
        assert await session.scalar(select(func.count()).select_from(Task))==0
        assert await session.scalar(select(func.count()).select_from(AlbumCaptionJob))==1
    await worker.run_once()
    async with db() as session:assert await session.scalar(select(func.count()).select_from(AlbumCaptionJob))==1

@pytest.mark.asyncio
async def test_manual_caption_wins_before_dispatch_and_blank_is_allowed(client,db):
    me,aid,s=await start(client,db);await upload(client,db,me,aid,s)
    await save(client,me,aid,(await detail(client,aid))['pages'][0],'')
    worker=ContentWorker(db,s,client._transport.app.state.media_storage);await worker.run_once()
    d=await detail(client,aid);assert d['pages'][0]['caption_text']=='' and d['album']['content_ready']
    async with db() as session:assert await session.scalar(select(func.count()).select_from(AlbumCaptionJob))==0

@pytest.mark.asyncio
async def test_replacement_keeps_text_position_and_does_not_admit_new_ai(client,db):
    me,aid,s=await start(client,db);await upload(client,db,me,aid,s)
    worker=ContentWorker(db,s,client._transport.app.state.media_storage);await worker.run_once()
    first=(await detail(client,aid))['pages'][0];await save(client,me,aid,first,'직접 적은 추억')
    replacement=await upload(client,db,me,aid,s,replace=first['id'],validate=False)
    d=await detail(client,aid);assert len(d['pages'])==1 and d['pages'][0]['id']==first['id']
    # Simulate cancellation by removing only the hidden replacement reservation.
    r=await client.delete(f'/api/v1/albums/{aid}/pages/{replacement["page_id"]}?expected_version={d["album"]["version"]}',headers=headers(me));assert r.status_code==200
    replacement=await upload(client,db,me,aid,s,replace=first['id'])
    await worker.run_once();d=await detail(client,aid)
    assert len(d['pages'])==1 and d['pages'][0]['id']==replacement['page_id']
    assert d['pages'][0]['position']==1 and d['pages'][0]['caption_text']=='직접 적은 추억'
    async with db() as session:assert await session.scalar(select(func.count()).select_from(AlbumCaptionJob))==1

@pytest.mark.asyncio
async def test_order_delete_and_more_uploads_remain_editable_after_publication(client,db):
    me,aid,s=await start(client,db)
    worker=ContentWorker(db,s,client._transport.app.state.media_storage)
    for _ in range(2):await upload(client,db,me,aid,s);await worker.run_once()
    d=await detail(client,aid);ids=[p['id'] for p in reversed(d['pages'])]
    r=await client.put(f'/api/v1/albums/{aid}/page-order',json={'expected_version':d['album']['version'],'page_ids':ids},headers=headers(me));assert r.status_code==200
    d=await detail(client,aid);assert [p['id'] for p in d['pages']]==ids
    r=await client.delete(f'/api/v1/albums/{aid}/pages/{ids[0]}?expected_version={d["album"]["version"]}',headers=headers(me));assert r.status_code==200
    await upload(client,db,me,aid,s);await worker.run_once()
    assert len((await detail(client,aid))['pages'])==2

@pytest.mark.asyncio
async def test_pinned_nfc_keeps_existing_session_and_new_entry_excludes_deleted_photo(client,db,tmp_path):
    me,p,tid,key=await purchased(client,db,tmp_path,completed=False);aid=p['album_id']
    s=client._transport.app.state.settings;s.album_content_enabled=True;s.easy_upload_enabled=True;s.dev_ai_enabled=True
    await consent(client,me);assert (await client.post(f'/api/v1/albums/{aid}/content',json={},headers=headers(me))).status_code==200
    await upload(client,db,me,aid,s);await ContentWorker(db,s,client._transport.app.state.media_storage).run_once()
    grant=(await enter(client,tid,key)).json()['data'];assert grant['state']=='ready'
    d=await detail(client,aid);page=d['pages'][0]
    assert (await client.delete(f'/api/v1/albums/{aid}/pages/{page["id"]}?expected_version={d["album"]["version"]}',headers=headers(me))).status_code==200
    assert (await enter(client,tid,key)).json()['data']['state']=='preparing'
    validation=ValidationWorker(db,s)
    for _ in range(5):await validation.run_once()
    h={'X-Mori-Viewer-Token':grant['session_token']}
    assert (await client.get(grant['pages'][0]['src'],headers=h)).status_code==200
    async with db() as session,session.begin():
        row=await session.scalar(select(NfcViewingSession));row.expires_at=now()-timedelta(seconds=1)
    assert (await client.get(grant['pages'][0]['src'],headers=h)).status_code==401
    assert (await client.get(f'/api/v1/albums/{aid}/viewer')).status_code==403

@pytest.mark.asyncio
async def test_unknown_paid_caption_is_accounted_and_never_retried(client,db):
    me,aid,s=await start(client,db);await upload(client,db,me,aid,s);s.ai_real_calls_enabled=True
    from backend.generation.openai_provider import ProviderFailure
    class Provider:
        calls=0
        async def caption(self,*args,**kwargs):self.calls+=1;raise ProviderFailure('AI_RESULT_UNKNOWN',dispatch_state='unknown')
    provider=Provider();worker=ContentWorker(db,s,client._transport.app.state.media_storage,provider)
    await worker.run_once();await worker.run_once();assert provider.calls==1
    async with db() as session:
        assert (await session.scalar(select(AlbumCaptionJob))).status=='unknown'
        assert (await session.scalar(select(AIBudgetEntry))).status=='unknown'
    # User-supplied text unblocks publication without another paid request.
    await save(client,me,aid,(await detail(client,aid))['pages'][0],'내가 직접 적어요')
    await worker.run_once();assert provider.calls==1 and (await detail(client,aid))['album']['content_ready']

@pytest.mark.asyncio
async def test_replace_at_twenty_keeps_existing_book_while_other_additions_are_pending(client,db):
    me,aid,s=await start(client,db);await upload(client,db,me,aid,s)
    await ContentWorker(db,s,client._transport.app.state.media_storage).run_once()
    d=await detail(client,aid);first=d['pages'][0]
    r=await client.post(f'/api/v1/albums/{aid}/uploads',json={'expected_version':d['album']['version'],'files':[optimized() for _ in range(19)]},headers=headers(me,str(uuid4())))
    assert r.status_code==201
    replacement=await upload(client,db,me,aid,s,replace=first['id'])
    d=await detail(client,aid);assert len(d['pages'])==20
    async with db() as session:
        album=await session.get(Album,UUID(aid));assert album.content_manifest[0]['id']==replacement['page_id']
        assert album.content_manifest[0]['text']==first['caption_text']
    extra=await client.post(f'/api/v1/albums/{aid}/uploads',json={'expected_version':d['album']['version'],'files':[optimized()]},headers=headers(me,str(uuid4())))
    assert extra.status_code==422 and extra.json()['error']['code']=='PHOTO_COUNT_EXCEEDED'

@pytest.mark.asyncio
async def test_first_manual_caption_can_follow_ai_but_another_manual_writer_conflicts(client,db):
    me,aid,s=await start(client,db);await upload(client,db,me,aid,s);before=(await detail(client,aid))['pages'][0]
    await ContentWorker(db,s,client._transport.app.state.media_storage).run_once()
    await save(client,me,aid,before,'자동 글귀보다 내가 적던 글귀를 유지해요')
    r=await client.patch(f'/api/v1/albums/{aid}/pages/{before["id"]}/caption',json={'expected_version':before['version'],'caption_text':'다른 수정'},headers=headers(me))
    assert r.status_code==409

@pytest.mark.asyncio
async def test_durable_response_recovers_after_crash_without_another_caption(client,db):
    me,aid,s=await start(client,db);await upload(client,db,me,aid,s)
    worker=ContentWorker(db,s,client._transport.app.state.media_storage);await worker.scan();c=await worker.claim();assert await worker.dispatch(c)
    await worker.results.save(str(c['attempt']),{'caption':'중단 뒤에도 보존된 글귀예요','sha':c['sha']})
    async with db() as session,session.begin():
        job=await session.get(AlbumCaptionJob,c['job']);job.lease_until=now()-timedelta(seconds=1)
    await worker.recover();d=await detail(client,aid);assert d['pages'][0]['caption_text']=='중단 뒤에도 보존된 글귀예요'
    async with db() as session:assert (await session.get(AlbumCaptionJob,c['job'])).attempt_count==1

@pytest.mark.asyncio
async def test_late_ai_result_never_overwrites_manual_text(client,db):
    me,aid,s=await start(client,db);await upload(client,db,me,aid,s)
    worker=ContentWorker(db,s,client._transport.app.state.media_storage);await worker.scan();c=await worker.claim();assert await worker.dispatch(c)
    await save(client,me,aid,(await detail(client,aid))['pages'][0],'이미 직접 작성한 글귀')
    await worker.apply(c,{'caption':'나중에 도착한 자동 글귀','sha':c['sha']})
    assert (await detail(client,aid))['pages'][0]['caption_text']=='이미 직접 작성한 글귀'

@pytest.mark.asyncio
async def test_first_upload_activates_once_and_preserves_old_request_replay(client,db):
    settings=client._transport.app.state.settings;settings.album_content_enabled=True;settings.easy_upload_enabled=True
    me,aid=await setup(client);await consent(client,me)
    body={'expected_version':1,'files':[optimized()]};h=headers(me,'first-content-upload')
    r=await client.post(f'/api/v1/albums/{aid}/uploads',json=body,headers=h)
    assert r.status_code==201 and r.json()['data']['album_version']==2
    replay=await client.post(f'/api/v1/albums/{aid}/uploads',json=body,headers=h)
    assert replay.json()['data']==r.json()['data']
    async with db() as session:assert await session.scalar(select(func.count()).select_from(Page))==1

@pytest.mark.asyncio
async def test_profile_change_keeps_pending_mini_and_admits_new_luna(client,db):
    me,aid,s=await start(client,db);await upload(client,db,me,aid,s)
    s.dev_ai_enabled=False;s.ai_real_calls_enabled=True
    worker=ContentWorker(db,s,client._transport.app.state.media_storage)
    await worker.scan()
    s.album_content_caption_profile='luna_1024_v1'
    first=await worker.claim();assert first['config']['caption_model']=='gpt-5.4-mini'
    await worker.apply(first,{'caption':'기존 설정으로 준비한 글귀','sha':first['sha']})
    await upload(client,db,me,aid,s);await worker.scan()
    second=await worker.claim();assert second['config']['caption_model']=='gpt-6-luna'
    assert second['config']['caption_analysis_profile']=='webp-fit-1024-q80-v1'

@pytest.mark.asyncio
async def test_invalid_response_cost_is_settled_without_retry(client,db):
    from backend.generation.openai_provider import ProviderFailure
    class Invalid:
        async def caption(self,*args,**kwargs):
            raise ProviderFailure('CAPTION_INVALID',dispatch_state='responded',cost_usd=Decimal('0.0001'),usage={'input_tokens':1},request_id='req_test')
    me,aid,s=await start(client,db);await upload(client,db,me,aid,s)
    s.dev_ai_enabled=False;s.ai_real_calls_enabled=True
    worker=ContentWorker(db,s,client._transport.app.state.media_storage,Invalid())
    await worker.run_once();await worker.run_once()
    async with db() as session:
        job=await session.scalar(select(AlbumCaptionJob))
        entry=await session.get(AIBudgetEntry,job.attempt_id)
        assert job.status=='failed' and job.attempt_count==1 and job.dispatch_state=='responded'
        assert entry.status=='settled' and entry.actual_usd==Decimal('0.0001')

@pytest.mark.asyncio
async def test_luna_worker_publishes_and_settles_luna_price(client,db):
    from types import SimpleNamespace
    from backend.generation.openai_provider import OpenAIProvider
    from backend.tests.test_openai_provider import make_provider,caption_response
    from pydantic import SecretStr
    import backend.generation.openai_provider as module
    import httpx,json,base64
    me,aid,s=await start(client,db);await upload(client,db,me,aid,s)
    s.dev_ai_enabled=False;s.ai_real_calls_enabled=True;s.album_content_caption_profile='luna_1024_v1'
    calls=[]
    def handle(request):
        payload=json.loads(request.content);calls.append(payload['model'])
        with Image.open(BytesIO(base64.b64decode(payload['input'][0]['content'][0]['image_url'].split(',')[1]))) as image:
            assert image.size==(600,400)
        return httpx.Response(200,json=caption_response(),headers={'x-request-id':'req_mock'})
    provider=make_provider(module,SimpleNamespace(openai_api_key=SecretStr('test'),openai_org_id='',openai_project_id='',openai_caption_model='gpt-5.4-mini',openai_image_model='gpt-image-2'),handle)
    try:
        worker=ContentWorker(db,s,client._transport.app.state.media_storage,provider)
        await worker.run_once();await worker.run_once()
        assert calls==['gpt-6-luna']
        d=await detail(client,aid);assert d['album']['content_ready']
        assert d['pages'][0]['source']['width']==600
        async with db() as session:
            job=await session.scalar(select(AlbumCaptionJob));entry=await session.get(AIBudgetEntry,job.attempt_id)
            assert entry.actual_usd==Decimal('0.000110') and entry.status=='settled'
    finally:await provider.aclose()
