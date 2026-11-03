"""Real DB/media flow with fake model; no paid API or existing-service changes."""
import json
from decimal import Decimal
from uuid import UUID, uuid4
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from backend.models import Page, AlbumCaptionJob, Album, MediaAsset
from backend.album_content.worker import ContentWorker
from backend.album_content.place_context import available_references
from backend.album_content.prompts import PLACE_EXPERIENCE_VERSION, SHORT_MEMORY_VERSION
from backend.album_content.service import now
from backend.generation.openai_provider import ProviderResult
from backend.tests.integration.test_auth_http import client, config
from backend.tests.integration.test_album_content import start, upload, detail, save

GPS={'latitude':35.241234,'longitude':129.221234}


def real(settings,profile='luna_places_1024_v1'):
    settings.dev_ai_enabled=False;settings.ai_real_calls_enabled=True
    settings.album_content_caption_profile=profile


@pytest.mark.asyncio
async def test_gps_without_date_reaches_new_caption_but_not_public_media_or_caption_context(client,db,monkeypatch):
    me,aid,settings=await start(client,db)
    source=await upload(client,db,me,aid,settings,captured='2026:11:02 12:00:00',gps=GPS)
    d=await detail(client,aid)
    await save(client,me,aid,d['pages'][0],'대학 친구들과 짜장면을 먹었다.')
    target=await upload(client,db,me,aid,settings,gps=GPS)
    d=await detail(client,aid)
    assert 'latitude' not in json.dumps(d) and 'photo_gps' not in json.dumps(d)
    real(settings)
    import backend.album_content.worker as module
    calls=[]
    async def fake(provider,data,config,*,reference_images):
        calls.append(config)
        assert config['caption_prompt_version']==PLACE_EXPERIENCE_VERSION
        assert config['caption_place_context']['gps']=={'latitude':35.241,'longitude':129.221}
        assert len(reference_images)==1
        assert '대학 친구' not in json.dumps(config,ensure_ascii=False)
        return ProviderResult(caption='식당에서 만두를 나눠 먹었다.',usage={'input_tokens':1,'output_tokens':1,'total_tokens':2},cost_usd=Decimal('.0001'))
    monkeypatch.setattr(module,'caption',fake)
    worker=ContentWorker(db,settings,client._transport.app.state.media_storage)
    assert await worker.run_once()
    assert await worker.run_once() is None
    async with db() as s:
        a=await s.get(Page,UUID(source['page_id']));b=await s.get(Page,UUID(target['page_id']))
        assert a.caption_text=='대학 친구들과 짜장면을 먹었다.'
        assert b.captured_at_raw is None and b.photo_gps==GPS
        assert b.caption_text=='식당에서 만두를 나눠 먹었다.'
    assert len(calls)==1


@pytest.mark.asyncio
async def test_old_job_stays_frozen_new_job_uses_places(client,db):
    me,aid,settings=await start(client,db)
    first=await upload(client,db,me,aid,settings,captured='2026:11:02 12:00:00')
    real(settings,'luna_1024_v1')
    worker=ContentWorker(db,settings,client._transport.app.state.media_storage)
    await worker.scan()
    second=await upload(client,db,me,aid,settings,captured='2026:11:02 12:10:00')
    real(settings);await worker.scan()
    async with db() as s:
        jobs=(await s.scalars(select(AlbumCaptionJob))).all()
        versions={str(j.page_id):j.config_snapshot['caption_prompt_version'] for j in jobs}
        assert versions=={first['page_id']:SHORT_MEMORY_VERSION,second['page_id']:PLACE_EXPERIENCE_VERSION}
        new=next(j for j in jobs if str(j.page_id)==second['page_id'])
        assert len(new.config_snapshot['caption_place_context']['references'])==1


@pytest.mark.asyncio
async def test_removed_reference_is_not_sent_and_cross_scope_reference_is_rejected(client,db):
    me,aid,settings=await start(client,db)
    source=await upload(client,db,me,aid,settings,gps=GPS)
    await save(client,me,aid,(await detail(client,aid))['pages'][0],'보존할 글.')
    target=await upload(client,db,me,aid,settings,gps=GPS)
    real(settings);worker=ContentWorker(db,settings,client._transport.app.state.media_storage)
    await worker.scan();c=await worker.claim()
    assert c['page']==UUID(target['page_id']) and len(c['place_references'])==1
    async with db() as s:
        album=await s.get(Album,UUID(aid))
        assert await available_references(s,SimpleNamespace(id=uuid4(),owner_id=album.owner_id),c['config'])==[]
        assert await available_references(s,SimpleNamespace(id=album.id,owner_id=uuid4()),c['config'])==[]
    async with db() as s,s.begin():
        p=await s.get(Page,UUID(source['page_id']));p.removed_at=now()
    assert not await worker.dispatch(c)
    async with db() as s:
        album=await s.get(Album,UUID(aid))
        assert await available_references(s,album,c['config'])==[]
    await worker.fail(c,'STATE_CONFLICT',unsent=True)
    # Removed evidence never alters the admission snapshot or causes a paid retry.
    async with db() as s,s.begin():
        j=await s.get(AlbumCaptionJob,c['job']);j.next_retry_at=now()
    again=await worker.claim()
    assert again['place_references']==[] and again['config']==c['config']
    assert await worker.dispatch(again)


@pytest.mark.asyncio
async def test_replacement_gets_own_gps_and_keeps_caption_without_new_job(client,db):
    me,aid,settings=await start(client,db)
    source=await upload(client,db,me,aid,settings,gps=GPS)
    await save(client,me,aid,(await detail(client,aid))['pages'][0],'가족과 먹었다.')
    replacement=await upload(client,db,me,aid,settings,replace=source['page_id'])
    real(settings);worker=ContentWorker(db,settings,client._transport.app.state.media_storage)
    await worker.scan()
    async with db() as s:
        page=await s.get(Page,UUID(replacement['page_id']))
        assert page.photo_gps is None and page.caption_text=='가족과 먹었다.'
        assert (await s.scalars(select(AlbumCaptionJob))).all()==[]


@pytest.mark.asyncio
async def test_frozen_plain_job_and_new_structured_job_publish_through_real_adapter(client,db):
    import httpx
    from pydantic import SecretStr
    import backend.generation.openai_provider as provider_module
    from backend.album_content.prompts import PLACE_MEMORY_VERSION
    from backend.models import AIBudgetEntry
    from backend.tests.test_openai_provider import make_provider,caption_response
    me,aid,settings=await start(client,db)
    source=await upload(client,db,me,aid,settings,gps=GPS)
    await save(client,me,aid,(await detail(client,aid))['pages'][0],'친구 이름은 이 사진에만 보존한다.')
    legacy=await upload(client,db,me,aid,settings,gps=GPS)
    real(settings);settings.openai_api_key=SecretStr('test')
    worker=ContentWorker(db,settings,client._transport.app.state.media_storage)
    await worker.scan()
    async with db() as s,s.begin():
        job=await s.scalar(select(AlbumCaptionJob).where(AlbumCaptionJob.page_id==UUID(legacy['page_id'])))
        job.config_snapshot={**job.config_snapshot,'caption_prompt_version':PLACE_MEMORY_VERSION}
        frozen=dict(job.config_snapshot)
    fresh=await upload(client,db,me,aid,settings,gps=GPS)
    calls=[]
    def handler(request):
        payload=json.loads(request.content);calls.append(payload)
        assert '친구 이름은' not in json.dumps(payload,ensure_ascii=False)
        if 'text' in payload:
            text=json.dumps({'venue':'코엑스','neighborhood':'삼성동','district':'강남구','city':'서울','setting':'팝업','activity':'캐릭터 그림을 둘러봤다.'},ensure_ascii=False)
        else:text='기존 방식의 글귀를 보존한다.'
        return httpx.Response(200,json=caption_response(text=text))
    provider=make_provider(provider_module,settings,handler);worker.provider=provider
    try:
        assert await worker.run_once()
        assert await worker.run_once()
        assert await worker.run_once() is None
    finally:await provider.aclose()
    async with db() as s:
        jobs=(await s.scalars(select(AlbumCaptionJob))).all()
        assert len(jobs)==2 and all(j.status=='succeeded' for j in jobs)
        assert next(j for j in jobs if j.page_id==UUID(legacy['page_id'])).config_snapshot==frozen
        assert next(j for j in jobs if j.page_id==UUID(fresh['page_id'])).config_snapshot['caption_prompt_version']==PLACE_EXPERIENCE_VERSION
        assert (await s.get(Page,UUID(source['page_id']))).caption_text=='친구 이름은 이 사진에만 보존한다.'
        assert (await s.get(Page,UUID(legacy['page_id']))).caption_text=='기존 방식의 글귀를 보존한다.'
        assert (await s.get(Page,UUID(fresh['page_id']))).caption_text=='코엑스 팝업에서 캐릭터 그림을 둘러봤다.'
        album=await s.get(Album,UUID(aid))
        assert any(p['text']=='코엑스 팝업에서 캐릭터 그림을 둘러봤다.' for p in album.content_manifest)
        entries=(await s.scalars(select(AIBudgetEntry))).all()
        assert len(entries)==2 and all(e.actual_usd==Decimal('.00011') for e in entries)
    assert len(calls)==2 and sum('text' in c for c in calls)==1


@pytest.mark.asyncio
async def test_invalid_structured_caption_is_charged_once_and_stays_manual_editable(client,db):
    import httpx
    from pydantic import SecretStr
    import backend.generation.openai_provider as provider_module
    from backend.models import AIBudgetEntry
    from backend.tests.test_openai_provider import make_provider,caption_response
    me,aid,settings=await start(client,db)
    photo=await upload(client,db,me,aid,settings,gps=GPS)
    real(settings);settings.openai_api_key=SecretStr('test');calls=[]
    def handler(request):
        calls.append(1);return httpx.Response(200,json=caption_response(text='{}'))
    provider=make_provider(provider_module,settings,handler)
    worker=ContentWorker(db,settings,client._transport.app.state.media_storage,provider)
    try:
        await worker.run_once();await worker.run_once()
        assert calls==[1]
    finally:await provider.aclose()
    async with db() as s:
        job=await s.scalar(select(AlbumCaptionJob))
        assert job.status=='failed' and job.dispatch_state=='responded' and job.error_code=='CAPTION_INVALID'
        assert (await s.get(Page,UUID(photo['page_id']))).caption_text is None
        entry=await s.scalar(select(AIBudgetEntry));assert entry.actual_usd==Decimal('.00011')
    await save(client,me,aid,(await detail(client,aid))['pages'][0],'직접 쓴 글을 보존한다.')
    assert (await detail(client,aid))['pages'][0]['caption_text']=='직접 쓴 글을 보존한다.'
