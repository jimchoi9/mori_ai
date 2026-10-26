"""Isolated DB and fake transport only. No actual mail/AI/storage provider calls."""
import asyncio
from datetime import timedelta
from io import BytesIO
from uuid import UUID

import httpx
import pytest
from PIL import Image,ImageDraw
from sqlalchemy import select,func

from backend.main import create_app
from backend.models import GoodsDesign,GoodsRevision,GoodsTestPurchase,GoodsPurchaseDelivery,GoodsDeliveryAttempt,Album
from backend.tests.integration.test_goods_test_checkout import seed
from backend.tests.integration.test_auth_http import config,login,ORIGIN
from backend.tests.integration.test_album_http import headers
from backend.storage.local import LocalStorage
from backend.goods_design.delivery.worker import DeliveryWorker,retry
from backend.goods_design.delivery.service import now
from backend.goods_design.delivery.provider import MailFailure
from backend.http.errors import APIError


class Mail:
    def __init__(self, failure=None):self.calls=[];self.failure=failure
    async def send(self,payload,key):
        self.calls.append((payload,key))
        if self.failure:raise self.failure
        return 'accepted-test-id'


async def checkout(db,client,store):
    me=await login(client)
    did=await seed(db,me['user']['id'])
    image=Image.new('RGBA',(100,100));ImageDraw.Draw(image).rectangle((10,10,90,90),fill='#778855')
    out=BytesIO();image.save(out,format='PNG')
    async with db() as s,s.begin():
        design=await s.get(GoodsDesign,UUID(did));revision=await s.get(GoodsRevision,design.revision_id)
        revision.result_key=f'{design.owner_id}/{design.work_id}/{revision.id}/result'
        store.write(revision.result_key,out.getvalue())
    response=await client.post(f'/api/v1/goods/designs/{did}/test-checkout',json={'expected_version':1},headers=headers(me,'checkout'))
    assert response.status_code==201
    return me,response.json()['data'],out.getvalue()


def app_config(**kw):
    return config(goods_checkout_mode='test',goods_delivery_origin='https://mori.example',**kw)


@pytest.mark.asyncio
async def test_files_owner_checks_original_bytes_and_purchase_return(db,tmp_path):
    store=LocalStorage(tmp_path);settings=app_config();app=create_app(settings=settings,session_factory=db,media_storage=store)
    async with app.router.lifespan_context(app),httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url=ORIGIN) as c:
        me,p,original=await checkout(db,c,store);url=f"/api/v1/goods/purchases/{p['id']}"
        detail=(await c.get(url)).json()['data']
        assert detail['product']=='keyring'
        assert detail['image_url']==url+'/files/original'
        assert (await c.get(url+'/files/original')).content==original
        sheet=await c.get(url+'/files/sheet');assert sheet.status_code==200 and sheet.content.startswith(b'%PDF')
        assert sheet.headers['cache-control']=='private, no-store'
        detail=(await c.get(url)).json()['data'];assert detail['files_ready'] and 'localhost' not in detail['upload_url']
        assert (await c.get(f"/api/v1/goods/purchases/by-album/{p['album_id']}")).json()['data']['purchase_id']==p['id']
        await login(c,'beta')
        assert (await c.get(url)).status_code==404
        assert (await c.get(url+'/files/original')).status_code==404
        assert (await c.get(url+'/files/sheet')).status_code==404
        c.cookies.clear();assert (await c.get(url)).status_code==401


@pytest.mark.asyncio
async def test_missing_mail_config_does_not_block_files_or_purchase(db,tmp_path):
    store=LocalStorage(tmp_path);settings=app_config();app=create_app(settings=settings,session_factory=db,media_storage=store);mail=Mail()
    async with app.router.lifespan_context(app),httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url=ORIGIN) as c:
        _,p,_=await checkout(db,c,store)
        worker=DeliveryWorker(db,store,settings,mail);assert await worker.run_once()
        assert not mail.calls
        async with db() as s:
            delivery=await s.get(GoodsPurchaseDelivery,UUID(p['id']))
            assert delivery.status=='waiting_configuration' and delivery.manifest
            assert await s.scalar(select(func.count()).select_from(Album))==1
            assert await s.scalar(select(func.count()).select_from(GoodsTestPurchase))==1
        assert not await worker.run_once()


@pytest.mark.asyncio
async def test_concurrent_workers_send_once_and_preserve_attempt(db,tmp_path):
    store=LocalStorage(tmp_path);settings=app_config(goods_mail_enabled=True,resend_api_key='test',goods_mail_to='operator@example.test',goods_mail_from='test@example.test')
    app=create_app(settings=settings,session_factory=db,media_storage=store);mail=Mail()
    async with app.router.lifespan_context(app),httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url=ORIGIN) as c:
        _,p,_=await checkout(db,c,store);pid=UUID(p['id'])
        workers=[DeliveryWorker(db,store,settings,mail) for _ in range(3)]
        await asyncio.gather(*(worker.run_once() for worker in workers))
        assert len(mail.calls)==1
        assert mail.calls[0][0]['to']==['operator@example.test']
        assert len(mail.calls[0][0]['attachments'])==4
        async with db() as s:
            delivery=await s.get(GoodsPurchaseDelivery,pid);assert delivery.status=='accepted' and delivery.attempt_count==1
            assert await s.scalar(select(func.count()).select_from(GoodsDeliveryAttempt))==1
        with pytest.raises(APIError):await retry(db,pid,settings)


@pytest.mark.asyncio
async def test_unknown_requires_explicit_retry_same_payload_and_expires(db,tmp_path):
    store=LocalStorage(tmp_path);settings=app_config(goods_mail_enabled=True,resend_api_key='test',goods_mail_to='operator@example.test',goods_mail_from='test@example.test')
    app=create_app(settings=settings,session_factory=db,media_storage=store);mail=Mail(MailFailure('MAIL_RESULT_UNKNOWN',unknown=True))
    async with app.router.lifespan_context(app),httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url=ORIGIN) as c:
        _,p,_=await checkout(db,c,store);pid=UUID(p['id']);worker=DeliveryWorker(db,store,settings,mail)
        await worker.run_once();assert not await worker.run_once()
        await retry(db,pid,settings);await worker.run_once()
        assert len(mail.calls)==2 and mail.calls[0]==mail.calls[1]
        async with db() as s,s.begin():
            attempt=await s.scalar(select(GoodsDeliveryAttempt));attempt.first_dispatched_at=now()-timedelta(hours=24)
            assert await s.scalar(select(func.count()).select_from(Album))==1
        with pytest.raises(APIError) as caught:await retry(db,pid,settings)
        assert caught.value.code=='MAIL_RECONCILIATION_REQUIRED'


@pytest.mark.asyncio
async def test_known_failure_new_attempt_and_sending_crash_no_auto_resend(db,tmp_path):
    store=LocalStorage(tmp_path);settings=app_config(goods_mail_enabled=True,resend_api_key='test',goods_mail_to='operator@example.test',goods_mail_from='test@example.test')
    app=create_app(settings=settings,session_factory=db,media_storage=store);mail=Mail(MailFailure('MAIL_REJECTED'))
    async with app.router.lifespan_context(app),httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url=ORIGIN) as c:
        _,p,_=await checkout(db,c,store);pid=UUID(p['id']);worker=DeliveryWorker(db,store,settings,mail)
        await worker.run_once();await retry(db,pid,settings);mail.failure=None;await worker.run_once()
        assert len(mail.calls)==2 and mail.calls[0][1]!=mail.calls[1][1]
        async with db() as s,s.begin():
            delivery=await s.get(GoodsPurchaseDelivery,pid);delivery.status='sending';delivery.lease_until=now()-timedelta(seconds=1)
            latest=await s.scalar(select(GoodsDeliveryAttempt).order_by(GoodsDeliveryAttempt.number.desc()).limit(1));latest.status='sending'
        assert not await worker.run_once()
        assert len(mail.calls)==2
        async with db() as s:assert (await s.get(GoodsPurchaseDelivery,pid)).status=='unknown'


@pytest.mark.asyncio
async def test_gift_login_and_inspection_never_claim_and_first_explicit_registration_wins(db,tmp_path):
    from backend.goods_design.delivery.gifts import inspect
    store=LocalStorage(tmp_path);settings=app_config();app=create_app(settings=settings,session_factory=db,media_storage=store)
    async with app.router.lifespan_context(app),httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url=ORIGIN) as c:
        buyer=await login(c);did=await seed(db,buyer['user']['id'])
        response=await c.post(f'/api/v1/goods/designs/{did}/test-checkout',json={'expected_version':1,'gift':True},headers=headers(buyer,'gift'))
        assert response.status_code==201;p=response.json()['data'];pid=UUID(p['id'])
        assert (await c.get(f"/api/v1/albums/{p['album_id']}")).status_code==404
        async with db() as s:
            purchase=await s.get(GoodsTestPurchase,pid);token=purchase.gift_token
            assert not purchase.claimed_by
        url=f'/api/v1/goods/purchases/{pid}/gift'
        assert (await c.post(url+'/inspect',json={'token':token},headers=headers(buyer,'inspect'))).json()['data']['status']=='available'
        recipient=await login(c,'beta')
        assert (await c.post(url+'/inspect',json={'token':token},headers=headers(recipient,'inspect'))).json()['data']['status']=='available'
        assert (await c.post(url+'/claim',json={'token':'invalid'},headers=headers(recipient,'bad'))).status_code==404
        assert (await c.post(url+'/claim',json={'token':token})).status_code==403
        async with db() as s:
            assert (await s.get(GoodsTestPurchase,pid)).claimed_by is None
        async def claim(actor):
            async with db() as s,s.begin():return await inspect(s,UUID(actor),pid,token,claim=True,settings=settings)
        results=await asyncio.gather(claim(recipient['user']['id']),claim(buyer['user']['id']))
        assert sorted(r['status'] for r in results)==['claimed','registered']
        winner=recipient if results[0]['status']=='registered' else buyer
        async with db() as s:
            purchase=await s.get(GoodsTestPurchase,pid);album=await s.get(Album,purchase.album_id)
            assert purchase.claimed_by==UUID(winner['user']['id'])==album.owner_id
            assert not album.management_pending
            assert await s.scalar(select(func.count()).select_from(Album))==1
        again=await claim(winner['user']['id']);assert again['status']=='registered'
        buyer=await login(c,'alpha')
        assert (await c.get(f'/api/v1/goods/designs/{did}')).json()['data']['test_purchase']['id']==p['id']
        duplicate=await c.post(f'/api/v1/goods/designs/{did}/test-checkout',json={'expected_version':1,'gift':True},headers=headers(buyer,'gift-new-key'))
        assert duplicate.status_code==200 and duplicate.json()['data']['id']==p['id']
        assert (await c.post(f'/api/v1/goods/designs/{did}/test-checkout',json={'expected_version':1},headers=headers(buyer,'self-mismatch'))).status_code==409


@pytest.mark.asyncio
async def test_mail_scope_limits_delivery_without_overriding_disabled_switch(db,tmp_path):
    store=LocalStorage(tmp_path);settings=app_config();app=create_app(settings=settings,session_factory=db,media_storage=store);mail=Mail()
    async with app.router.lifespan_context(app),httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url=ORIGIN) as c:
        _,first,_=await checkout(db,c,store)
        # A second design requires a fresh idempotency key; direct seed avoids changing first receipt.
        from backend.goods_design.checkout import test_checkout
        me=await login(c);did=await seed(db,me['user']['id'])
        async with db() as s,s.begin():
            _,second=await test_checkout(s,UUID(me['user']['id']),UUID(did),1,'second-purchase',settings)
        scoped=settings.model_copy(update={'goods_mail_purchase_id':UUID(first['id'])})
        worker=DeliveryWorker(db,store,scoped,mail)
        assert await worker.run_once()
        assert not await worker.run_once() and not mail.calls
        async with db() as s:
            assert (await s.get(GoodsPurchaseDelivery,UUID(first['id']))).status=='waiting_configuration'
            assert (await s.get(GoodsPurchaseDelivery,UUID(second['id']))).status=='pending'
