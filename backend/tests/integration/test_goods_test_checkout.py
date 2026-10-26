"""Real PostgreSQL test checkout: no provider, payment, storage or QA calls."""
import asyncio
from datetime import datetime, timedelta, timezone
from uuid import UUID

import httpx
import pytest
from sqlalchemy import func, select

from backend.main import create_app
from backend.models import Album, GoodsDesign, GoodsRevision, GoodsTestPurchase, GoodsWork, GoodsPurchaseDelivery
from backend.tests.integration.test_auth_http import config, login, ORIGIN
from backend.tests.integration.test_album_http import headers


async def seed(db, owner_id):
    async with db() as s, s.begin():
        work = GoodsWork(owner_id=UUID(owner_id), status='completed',
                         expires_at=datetime.now(timezone.utc) + timedelta(hours=24))
        s.add(work)
        await s.flush()
        revision = GoodsRevision(work_id=work.id, request_key='seed', request_hash='seed',
            style='free', message='travel', prompt='travel', config={'mode':'fake'},
            status='ready', result_key=f'{owner_id}/{work.id}/result')
        s.add(revision)
        await s.flush()
        design = GoodsDesign(owner_id=UUID(owner_id), work_id=work.id,
            revision_id=revision.id, placement={'holeX':.5,'holeY':0,'widthMm':50})
        s.add(design)
        await s.flush()
        return str(design.id)


def app_for(db, **kwargs):
    return create_app(settings=config(goods_checkout_mode='test', **kwargs), session_factory=db)


@pytest.mark.asyncio
async def test_checkout_creates_and_connects_draft_without_legacy_or_paid_state(db):
    app = app_for(db)
    async with app.router.lifespan_context(app), httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as client:
        me = await login(client)
        design_id = await seed(db, me['user']['id'])
        response = await client.post(f'/api/v1/goods/designs/{design_id}/test-checkout',
            json={'expected_version':1}, headers=headers(me,'checkout'))
        assert response.status_code == 201
        data = response.json()['data']
        assert (data['mode'], data['status'], data['album_status']) == ('test','simulated','draft')
        album = (await client.get(f"/api/v1/albums/{data['album_id']}")).json()['data']
        assert album['detail']['pages'] == []
        assert album['detail']['album']['status'] == 'draft'
        view = (await client.get(f'/api/v1/goods/designs/{design_id}')).json()['data']
        assert view['test_purchase'] == data
        assert view['album_id'] is None and view['production_started'] is False
        async with db() as s:
            purchase = await s.get(GoodsTestPurchase, UUID(data['id']))
            assert purchase.design_snapshot['placement']['widthMm'] == 50
            assert purchase.design_snapshot['snapshot_version'] == 2
            assert purchase.design_snapshot['artwork_key']
            delivery = await s.get(GoodsPurchaseDelivery, purchase.id)
            assert delivery.status == 'pending' and delivery.attempt_count == 0
        # Even a separate client request must not reassign the test album manually.
        assert (await client.put(f'/api/v1/goods/designs/{design_id}/album',
            json={'album_id':data['album_id'],'expected_version':1},
            headers=headers(me,'link'))).status_code == 409


@pytest.mark.asyncio
async def test_checkout_replay_and_concurrent_new_keys_provision_only_one_album(db):
    from backend.goods_design.checkout import test_checkout
    app = app_for(db)
    async with app.router.lifespan_context(app), httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as client:
        me = await login(client)
        design_id = await seed(db, me['user']['id'])
        async def checkout(key):
            async with db() as s, s.begin():
                return await test_checkout(s,UUID(me['user']['id']),UUID(design_id),1,key,app.state.settings)
        results = await asyncio.gather(*(checkout(f'key-{i}') for i in range(4)))
        assert sorted(status for status,_ in results) == [200,200,200,201]
        assert len({data['album_id'] for _,data in results}) == 1
        replay = await checkout('key-0')
        assert replay == results[0]
        async with db() as s:
            assert await s.scalar(select(func.count()).select_from(Album)) == 1
            assert await s.scalar(select(func.count()).select_from(GoodsTestPurchase)) == 1
            assert await s.scalar(select(func.count()).select_from(GoodsPurchaseDelivery)) == 1
        conflict = await client.post(f'/api/v1/goods/designs/{design_id}/test-checkout',
            json={'expected_version':2},headers=headers(me,'key-0'))
        assert conflict.status_code == 409


@pytest.mark.asyncio
async def test_checkout_failure_rolls_back_receipt_album_and_retries_cleanly(db,monkeypatch):
    import backend.goods_design.checkout as checkout
    app = app_for(db)
    async with app.router.lifespan_context(app), httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app,raise_app_exceptions=False),base_url=ORIGIN) as client:
        me = await login(client)
        design_id = await seed(db,me['user']['id'])
        original = checkout.save_record
        async def fail(*args):
            raise RuntimeError('injected failure after album and receipt flush')
        monkeypatch.setattr(checkout,'save_record',fail)
        assert (await client.post(f'/api/v1/goods/designs/{design_id}/test-checkout',
            json={'expected_version':1},headers=headers(me,'retry'))).status_code == 500
        async with db() as s:
            assert await s.scalar(select(func.count()).select_from(Album)) == 0
            assert await s.scalar(select(func.count()).select_from(GoodsTestPurchase)) == 0
            assert await s.scalar(select(func.count()).select_from(GoodsPurchaseDelivery)) == 0
        monkeypatch.setattr(checkout,'save_record',original)
        assert (await client.post(f'/api/v1/goods/designs/{design_id}/test-checkout',
            json={'expected_version':1},headers=headers(me,'retry'))).status_code == 201


@pytest.mark.asyncio
async def test_checkout_requires_owner_csrf_approval_and_explicit_mode(db):
    app = app_for(db)
    async with app.router.lifespan_context(app), httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),base_url=ORIGIN) as client:
        me = await login(client)
        design_id = await seed(db,me['user']['id'])
        url=f'/api/v1/goods/designs/{design_id}/test-checkout'
        assert (await client.post(url,json={'expected_version':1})).status_code == 403
        missing_key={'Origin':ORIGIN,'X-CSRF-Token':me['csrf_token']}
        assert (await client.post(url,json={'expected_version':1},headers=missing_key)).status_code == 422
        assert (await client.post(url,json={'expected_version':2},headers=headers(me,'stale'))).status_code == 409
        other=await login(client,'beta')
        assert (await client.post(url,json={'expected_version':1},headers=headers(other,'foreign'))).status_code == 404
        app.state.settings.goods_checkout_mode='disabled'
        assert (await client.get('/api/v1/client-config')).json()['data']['goods_checkout_mode']=='disabled'
        assert (await client.post(url,json={'expected_version':1},headers=headers(other,'disabled'))).status_code == 404
        app.state.settings.goods_checkout_mode='test'
        app.state.settings.access_mode='approved_only'
        assert (await client.post(url,json={'expected_version':1},headers=headers(other,'approval'))).status_code == 403
        client.cookies.clear()
        assert (await client.post(url,json={'expected_version':1})).status_code == 401
        async with db() as s:
            assert await s.scalar(select(func.count()).select_from(Album)) == 0


@pytest.mark.asyncio
async def test_deleted_test_album_never_gets_silently_replaced(db):
    app=app_for(db)
    async with app.router.lifespan_context(app),httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),base_url=ORIGIN) as client:
        me=await login(client)
        design_id=await seed(db,me['user']['id'])
        url=f'/api/v1/goods/designs/{design_id}/test-checkout'
        original=(await client.post(url,json={'expected_version':1},headers=headers(me,'first'))).json()['data']
        async with db() as s,s.begin():
            album=await s.get(Album,UUID(original['album_id']))
            album.status='deleted';album.deleted_at=datetime.now(timezone.utc)
        again=(await client.post(url,json={'expected_version':1},headers=headers(me,'new-key'))).json()['data']
        assert again['album_id']==original['album_id'] and again['album_status']=='deleted'
        async with db() as s:
            assert await s.scalar(select(func.count()).select_from(Album))==1


@pytest.mark.asyncio
@pytest.mark.parametrize('legacy',['linked','production'])
async def test_checkout_preserves_legacy_designs(db,legacy):
    app=app_for(db)
    async with app.router.lifespan_context(app),httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),base_url=ORIGIN) as client:
        me=await login(client)
        design_id=await seed(db,me['user']['id'])
        async with db() as s,s.begin():
            design=await s.get(GoodsDesign,UUID(design_id))
            if legacy=='production':design.production_started_at=datetime.now(timezone.utc)
            else:
                album=Album(owner_id=design.owner_id,status='published');s.add(album);await s.flush()
                design.album_id=album.id
        assert (await client.post(f'/api/v1/goods/designs/{design_id}/test-checkout',
            json={'expected_version':1},headers=headers(me,'legacy'))).status_code==409
        async with db() as s:
            assert await s.scalar(select(func.count()).select_from(GoodsTestPurchase))==0


@pytest.mark.asyncio
@pytest.mark.parametrize('product', ['keyring', 'magnet'])
async def test_purchase_snapshot_does_not_follow_later_design_or_revision_changes(db, product):
    app = app_for(db)
    async with app.router.lifespan_context(app), httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as client:
        me = await login(client)
        design_id = await seed(db, me['user']['id'])
        async with db() as s, s.begin():
            design = await s.get(GoodsDesign, UUID(design_id))
            design.product = product
        url = f'/api/v1/goods/designs/{design_id}/test-checkout'
        first = (await client.post(url, json={'expected_version': 1},
            headers=headers(me, 'snapshot-first'))).json()['data']
        async with db() as s, s.begin():
            purchase = await s.get(GoodsTestPurchase, UUID(first['id']))
            frozen = dict(purchase.design_snapshot)
            design = await s.get(GoodsDesign, UUID(design_id))
            design.product = 'magnet' if product == 'keyring' else 'keyring'
            design.placement = {'holeX': .9, 'holeY': .9, 'widthMm': 70}
            design.version += 1
            revision = await s.get(GoodsRevision, design.revision_id)
            revision.message = 'later request'
        again = (await client.post(url, json={'expected_version': 2},
            headers=headers(me, 'snapshot-again'))).json()['data']
        assert again == first
        async with db() as s:
            purchase = await s.get(GoodsTestPurchase, UUID(first['id']))
            assert purchase.design_snapshot == frozen
            assert frozen['product'] == product
            assert frozen['placement'] == {'holeX': .5, 'holeY': 0, 'widthMm': 50}
            assert frozen['message'] == 'travel'
            assert await s.scalar(select(func.count()).select_from(GoodsPurchaseDelivery)) == 1
