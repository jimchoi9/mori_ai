"""Anonymous appreciation grants never confer album-management privileges."""
import asyncio
from datetime import timedelta
from uuid import UUID,uuid4
import pytest
from sqlalchemy import select,func
from backend.models import GoodsNfcTag,NfcViewingSession,GoodsTestPurchase,GoodsPurchaseDelivery,Album,MediaAsset
from backend.nfc.service import now
from backend.tests.integration.test_review_viewer_http import client,publish
from backend.tests.integration.test_generation_pipeline import pipeline,drain
from backend.tests.integration.test_goods_delivery import checkout
from backend.tests.integration.test_album_http import headers
from backend.tests.integration.test_auth_http import ORIGIN


async def purchased(client,db,tmp_path,*,completed=True):
    client._transport.app.state.settings.goods_checkout_mode='test'
    store=client._transport.app.state.media_storage
    me,p,original=await checkout(db,client,store)
    if completed:
        me,aid,_,_,_,runner=await pipeline(client,db,tmp_path,count=2,legacy=False,album_id=p['album_id'])
        await drain(runner)
        detail=(await client.get(f'/api/v1/albums/{aid}')).json()['data']['detail']
        response=await publish(client,me,aid,detail['album']['version']);assert response.status_code==200
        assert response.json()['data']['album']['nfc_required'] is True
    async with db() as s:
        tag=await s.scalar(select(GoodsNfcTag).where(GoodsNfcTag.purchase_id==UUID(p['id'])))
        return me,p,str(tag.id),tag.write_token


async def enter(client,tid,key,*,origin=True):
    return await client.post(f'/api/v1/nfc/tags/{tid}/enter',json={'token':key},headers={'Origin':ORIGIN} if origin else {})


@pytest.mark.asyncio
async def test_anonymous_reader_and_owner_management_are_separate(client,db,tmp_path):
    me,p,tid,key=await purchased(client,db,tmp_path)
    viewer=await client.get(f"/api/v1/albums/{p['album_id']}/viewer")
    assert viewer.status_code==403 and viewer.json()['error']['code']=='NFC_REQUIRED'
    assert (await client.get(f"/api/v1/albums/{p['album_id']}")).status_code==200
    client.cookies.clear()
    response=await enter(client,tid,key);assert response.status_code==200
    assert response.headers['referrer-policy']=='no-referrer'
    data=response.json()['data'];assert data['state']=='ready' and len(data['pages'])==2
    assert '.' not in data['expires_at']  # Portable ISO seconds for mobile Date.parse.
    assert 'upload_url' not in data and 'owner_id' not in data
    h={'X-Mori-Viewer-Token':data['session_token']}
    media=await client.get(data['pages'][0]['src'],headers=h)
    assert media.status_code==200 and media.headers['content-type']=='image/webp'
    thumbnail=await client.get(data['pages'][0]['thumb'],headers=h)
    assert thumbnail.status_code==200 and thumbnail.headers['content-type']=='image/webp'
    assert (await client.get(data['pages'][0]['thumb'])).status_code==401
    assert media.headers['cache-control']=='private, no-store'
    assert (await client.get(data['pages'][0]['src'])).status_code==401
    assert (await client.get(f"/api/v1/albums/{p['album_id']}",headers=h)).status_code==401
    assert (await client.post(f"/api/v1/albums/{p['album_id']}/uploads",json={},headers=h)).status_code==401
    assert (await client.post('/api/v1/albums',json={},headers=h)).status_code==401


@pytest.mark.asyncio
async def test_preparing_album_issues_no_grant(client,db,tmp_path):
    _,p,tid,key=await purchased(client,db,tmp_path,completed=False)
    client.cookies.clear()
    response=await enter(client,tid,key)
    assert response.json()['data']=={'state':'preparing'}
    async with db() as s:assert await s.scalar(select(func.count()).select_from(NfcViewingSession))==0


@pytest.mark.asyncio
async def test_entry_rejects_bad_secret_origin_and_query(client,db,tmp_path):
    _,p,tid,key=await purchased(client,db,tmp_path,completed=False)
    assert (await enter(client,tid,'x'*43)).status_code==404
    assert (await enter(client,str(uuid4()),key)).status_code==404
    assert (await enter(client,tid,key,origin=False)).status_code==403
    assert (await client.post(f'/api/v1/nfc/tags/{tid}/enter?token=bad',json={'token':key},headers={'Origin':ORIGIN})).status_code==422
    assert (await client.post(f'/api/v1/nfc/tags/{tid}/enter',json={'token':key,'album_id':p['album_id']},headers={'Origin':ORIGIN})).status_code==422


@pytest.mark.asyncio
async def test_tag_secret_is_not_a_session_and_sessions_are_album_scoped(client,db,tmp_path):
    _,p,tid,key=await purchased(client,db,tmp_path)
    data=(await enter(client,tid,key)).json()['data'];path=data['pages'][0]['src']
    assert (await client.get(path,headers={'X-Mori-Viewer-Token':key})).status_code==401
    h={'X-Mori-Viewer-Token':data['session_token']}
    assert (await client.get('/api/v1/nfc/media/'+str(uuid4()),headers=h)).status_code==404
    async with db() as s:
        source=await s.scalar(select(MediaAsset.id).where(MediaAsset.album_id==UUID(p['album_id']),MediaAsset.role=='source'))
    assert (await client.get('/api/v1/nfc/media/'+str(source),headers=h)).status_code==404
    assert (await client.get(path+'?token='+data['session_token'],headers=h)).status_code==422


@pytest.mark.asyncio
async def test_expiry_close_and_retag(client,db,tmp_path):
    _,_,tid,key=await purchased(client,db,tmp_path)
    data=(await enter(client,tid,key)).json()['data'];h={'X-Mori-Viewer-Token':data['session_token']}
    async with db() as s,s.begin():
        row=await s.scalar(select(NfcViewingSession));row.expires_at=now()-timedelta(seconds=1)
    assert (await client.get(data['pages'][0]['src'],headers=h)).status_code==401
    fresh=(await enter(client,tid,key)).json()['data']
    assert fresh['session_token']!=data['session_token']
    for _ in range(2):
        assert (await client.post('/api/v1/nfc/close',json={'token':fresh['session_token']},headers={'Origin':ORIGIN})).status_code==204
    assert (await client.get(fresh['pages'][0]['src'],headers={'X-Mori-Viewer-Token':fresh['session_token']})).status_code==401


@pytest.mark.parametrize('mutation',['tag_disabled','album_deleted','album_changed'])
@pytest.mark.asyncio
async def test_recheck_live_state_on_every_media_request(client,db,tmp_path,mutation):
    _,p,tid,key=await purchased(client,db,tmp_path)
    data=(await enter(client,tid,key)).json()['data']
    async with db() as s,s.begin():
        if mutation=='tag_disabled':(await s.get(GoodsNfcTag,UUID(tid))).active=False
        else:
            album=await s.get(Album,UUID(p['album_id']))
            if mutation=='album_deleted':album.deleted_at=now();album.status='deleted'
            else:album.version+=1
    assert (await client.get(data['pages'][0]['src'],headers={'X-Mori-Viewer-Token':data['session_token']})).status_code==401


@pytest.mark.asyncio
async def test_manufacturing_spec_has_nfc_writing_address_separate_from_upload_qr(client,db,tmp_path):
    _,p,tid,key=await purchased(client,db,tmp_path,completed=False)
    settings=client._transport.app.state.settings
    settings.goods_delivery_origin='https://mobile.example.test'
    url=f"/api/v1/goods/purchases/{p['id']}/files/spec"
    responses=await asyncio.gather(client.get(url),client.get(url))
    assert all(r.status_code==200 for r in responses)
    assert responses[0].content==responses[1].content
    spec=responses[0].json()
    assert 'nfc_view_url' not in spec
    assert key.encode() not in responses[0].content
    assert (await client.get(f"/api/v1/goods/purchases/{p['id']}/files/operator_spec")).status_code==404
    async with db() as s:
        delivery=await s.get(GoodsPurchaseDelivery,UUID(p['id']))
        operator=delivery.manifest['operator_files']['spec']
    import json
    production=json.loads(client._transport.app.state.media_storage.read_bytes(operator['key']))
    assert production['nfc_view_url']==f'https://mobile.example.test/nfc/{tid}#key={key}'
    from backend.goods_design.delivery.worker import DeliveryWorker
    from backend.tests.integration.test_goods_delivery import Mail
    import base64
    settings=settings.model_copy(update={'goods_mail_to':'operator@example.test','goods_mail_from':'mori@example.test'})
    message=await DeliveryWorker(db,client._transport.app.state.media_storage,settings,Mail()).payload(UUID(p['id']),delivery.manifest)
    attachment=next(a for a in message['attachments'] if a['filename']=='mori-production.json')
    assert json.loads(base64.b64decode(attachment['content']))['nfc_view_url']==production['nfc_view_url']
    assert message['to']==['operator@example.test']
    assert spec['upload_url'].endswith(f"/purchases/{p['id']}/photos")
    assert '/nfc/' not in spec['upload_url']
    async with db() as s:
        assert await s.scalar(select(func.count()).select_from(GoodsNfcTag))==1
        assert await s.scalar(select(func.count()).select_from(GoodsTestPurchase))==1


@pytest.mark.asyncio
async def test_tag_exchange_cannot_claim_a_pending_gift_album(client,db,tmp_path):
    _,p,tid,key=await purchased(client,db,tmp_path,completed=False)
    async with db() as s,s.begin():
        album=await s.get(Album,UUID(p['album_id']));album.management_pending=True
        purchase=await s.get(GoodsTestPurchase,UUID(p['id']));purchase.gift=True
    client.cookies.clear()
    assert (await enter(client,tid,key)).json()['data']=={'state':'preparing'}
    async with db() as s:
        purchase=await s.get(GoodsTestPurchase,UUID(p['id']))
        assert purchase.claimed_by is None
        assert await s.scalar(select(func.count()).select_from(NfcViewingSession))==0


@pytest.mark.asyncio
async def test_old_receipt_lazy_tag_is_single_under_concurrent_file_requests(client,db,tmp_path):
    _,p,tid,_=await purchased(client,db,tmp_path,completed=False)
    from sqlalchemy import delete
    async with db() as s,s.begin():
        await s.execute(delete(GoodsNfcTag).where(GoodsNfcTag.id==UUID(tid)))
    client._transport.app.state.settings.goods_delivery_origin='https://mobile.example.test'
    responses=await asyncio.gather(*(client.get(f"/api/v1/goods/purchases/{p['id']}/files/spec") for _ in range(3)))
    assert all(r.status_code==200 for r in responses)
    assert len({r.content for r in responses})==1
    async with db() as s:
        assert await s.scalar(select(func.count()).select_from(GoodsNfcTag))==1
        assert await s.scalar(select(func.count()).select_from(GoodsTestPurchase))==1
        assert await s.scalar(select(func.count()).select_from(Album))==1
