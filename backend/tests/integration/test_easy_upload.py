"""Configured 20/50 capacity, optimized-only transport and unchanged AI boundary."""
from io import BytesIO
from uuid import UUID
import pytest
from PIL import Image
from sqlalchemy import select,func
from backend.models import Page,Upload,Run
from backend.tests.integration.test_auth_http import client,config
from backend.tests.integration.test_upload_http import setup,consent,reserve,file
from backend.tests.integration.test_album_http import headers
from backend.uploads.validation import ValidationWorker

def optimized(**changes):
    return {**file('ready.webp'), 'mime':'image/webp', 'preprocessing':{'version':2,'original_width':600,'original_height':400,'captured_at_raw':None,'captured_timezone':None},**changes}

@pytest.mark.asyncio
@pytest.mark.parametrize('limit',[20,50])
async def test_limit_is_authoritative_and_replay_does_not_allocate_again(client,db,limit):
    settings=client._transport.app.state.settings;settings.easy_upload_enabled=True;settings.easy_upload_max_photos=limit
    me,album=await setup(client);await consent(client,me)
    files=[optimized() for _ in range(limit)]
    accepted=await reserve(client,me,album,files);assert accepted.status_code==201
    replay=await reserve(client,me,album,files);assert replay.json()['data']==accepted.json()['data']
    extra=await reserve(client,me,album,[optimized()],version=2,key='too-many');assert extra.status_code==422 and extra.json()['error']['code']=='PHOTO_COUNT_EXCEEDED'
    async with db() as s:assert await s.scalar(select(func.count()).select_from(Page))==limit
    advertised=(await client.get('/api/v1/client-config')).json()['data']['easy_upload'];assert advertised=={'enabled':True,'max_photos':limit}

@pytest.mark.asyncio
@pytest.mark.parametrize('invalid',[file('raw.heic'),optimized(preprocessing=None),optimized(mime='image/png'),optimized(bytes=1_000_001)])
async def test_easy_mode_never_accepts_original_fallback(client,db,invalid):
    client._transport.app.state.settings.easy_upload_enabled=True
    me,album=await setup(client);await consent(client,me)
    response=await reserve(client,me,album,[invalid]);assert response.status_code==422
    async with db() as s:assert await s.scalar(select(func.count()).select_from(Upload))==0

@pytest.mark.asyncio
async def test_saved_landscape_stays_landscape_without_ai_or_publish(client,db):
    client._transport.app.state.settings.easy_upload_enabled=True
    me,album=await setup(client);await consent(client,me)
    output=BytesIO();Image.new('RGB',(600,400),'green').save(output,format='WEBP');body=output.getvalue()
    response=await reserve(client,me,album,[optimized(bytes=len(body))]);assert response.status_code==201
    upload=response.json()['data']['uploads'][0]
    assert (await client.put(upload['upload_url'],content=body,headers={**upload['required_headers'],**headers(me)})).status_code==204
    path=f'/api/v1/albums/{album}/uploads/{upload["upload_id"]}'
    assert (await client.post(path+'/complete',json={},headers=headers(me))).status_code==202
    assert await ValidationWorker(db,config()).run_once()
    assert (await client.get(path)).json()['data']['status']=='ready'
    detail=(await client.get('/api/v1/albums/'+album)).json()['data']['detail']
    assert detail['album']['status']=='draft'
    assert detail['pages'][0]['source']['width']==600 and detail['pages'][0]['source']['height']==400
    assert detail['pages'][0]['caption_text'] is None
    async with db() as s:assert await s.scalar(select(func.count()).select_from(Run))==0
