"""Purchase-free creation to private shared book rendering; all AI stays fake."""
from uuid import UUID
import pytest
from sqlalchemy import select,func
from backend.models import Album,GoodsTestPurchase,Page
from backend.album_content.worker import ContentWorker
from backend.tests.integration.test_auth_http import client,login
from backend.tests.integration.test_album_http import headers,create
from backend.tests.integration.test_album_content import upload,detail,save
from backend.tests.integration.test_upload_http import consent


@pytest.mark.asyncio
async def test_independent_album_upload_edit_and_owner_book_without_goods(client,db):
    settings=client._transport.app.state.settings
    settings.album_content_enabled=True;settings.easy_upload_enabled=True;settings.dev_ai_enabled=True
    me=await login(client);await consent(client,me)
    response=await create(client,me,'independent')
    assert response.status_code==201
    album=response.json()['data']['album'];aid=album['id']
    assert album['content_enabled'] and not album['nfc_required']
    assert (await create(client,me,'independent')).json()['data']['album']['id']==aid
    await upload(client,db,me,aid,settings,gps={'latitude':35.2412,'longitude':129.2211})
    worker=ContentWorker(db,settings,client._transport.app.state.media_storage)
    assert await worker.run_once()
    d=await detail(client,aid);assert d['album']['content_ready']
    viewer=await client.get(f'/api/v1/albums/{aid}/viewer');assert viewer.status_code==200,viewer.text
    book=viewer.json()['data'];assert len(book['pages'])==1 and book['media_access']
    assert not any(k in str(book) for k in ['photo_gps','latitude','write_token','session_token'])
    assert (await client.get(book['media_access'][0]['url'])).status_code==200
    await save(client,me,aid,d['pages'][0],'직접 남긴 추억.')
    fresh=(await client.get(f'/api/v1/albums/{aid}/viewer')).json()['data']
    assert fresh['pages'][0]['caption_text']=='직접 남긴 추억.'
    async with db() as s:
        assert await s.scalar(select(func.count()).select_from(GoodsTestPurchase))==0
        assert (await s.get(Page,UUID(d['pages'][0]['id']))).photo_gps is not None
        assert not (await s.get(Album,UUID(aid))).legacy_access
    await login(client,'beta')
    assert (await client.get(f'/api/v1/albums/{aid}/viewer')).status_code==404
    assert (await client.get(book['media_access'][0]['url'])).status_code in (403,404)
    client.cookies.clear()
    assert (await client.get(f'/api/v1/albums/{aid}/viewer')).status_code==401
