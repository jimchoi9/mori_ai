"""Magnet selection survives guest claim, completion and simulated checkout."""
from uuid import UUID
import httpx
import pytest
from sqlalchemy import select

from backend.main import create_app
from backend.models import GoodsRevision, GoodsTestPurchase
from backend.goods_design.worker import GoodsWorker
from backend.goods_design.service import revision_view
from backend.storage.local import LocalStorage
from backend.tests.integration.test_auth_http import config, login, ORIGIN
from backend.tests.integration.test_album_http import headers
from backend.tests.integration.test_goods_guests import guest, consent, work, body


@pytest.mark.asyncio
async def test_magnet_guest_generation_claim_save_and_checkout_preserve_product(db, tmp_path):
    settings = config(dev_ai_enabled=True, goods_checkout_mode='test')
    store = LocalStorage(tmp_path)
    app = create_app(settings=settings, session_factory=db, media_storage=store)
    async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as c:
        me = await guest(c); await consent(c, me)
        wid = await work(c, me)
        url = f'/api/v1/goods/work/{wid}/revisions'
        payload = {**body(), 'product': 'magnet'}
        result = await c.post(url, json=payload, headers=headers(me, 'magnet'))
        assert result.status_code == 202, result.text
        rid = result.json()['data']['id']
        assert (await c.post(url, json=payload, headers=headers(me, 'magnet'))).json()['data']['id'] == rid
        assert (await c.post(url, json={**payload, 'product': 'keyring'}, headers=headers(me, 'magnet'))).status_code == 409
        assert await GoodsWorker(db, store, settings).run_once()
        state = (await c.get(f'/api/v1/goods/work/{wid}')).json()['data']
        assert state['remaining_generations'] == 2
        assert state['revisions'][0]['product'] == 'magnet'
        async with db() as s:
            revision = await s.get(GoodsRevision, UUID(rid))
            assert revision.config['product'] == 'magnet'
            assert revision.config['prompt_version'] == 'goods-small-v10-magnet'
            assert 'acrylic magnet artwork' in revision.prompt
        member = await login(c)
        assert (await c.post('/api/v1/goods/claim', json={'work_id': wid}, headers=headers(member))).status_code == 200
        finish = {'revision_id': rid, 'product': 'magnet', 'placement': {'holeX': .5, 'holeY': 0, 'widthMm': 50}}
        response = await c.post(f'/api/v1/goods/work/{wid}/complete', json=finish, headers=headers(member))
        assert response.status_code == 200, response.text
        design = response.json()['data']
        assert design['product'] == 'magnet'
        replay = await c.post(f'/api/v1/goods/work/{wid}/complete', json=finish, headers=headers(member))
        assert replay.json()['data']['id'] == design['id']
        assert (await c.post(f'/api/v1/goods/work/{wid}/complete', json={**finish, 'product': 'keyring'}, headers=headers(member))).status_code == 409
        assert (await c.get(f"/api/v1/goods/designs/{design['id']}")).json()['data']['product'] == 'magnet'
        assert (await c.get('/api/v1/goods/designs')).json()['data']['items'][0]['product'] == 'magnet'
        checkout = await c.post(f"/api/v1/goods/designs/{design['id']}/test-checkout", json={'expected_version': 1}, headers=headers(member, 'checkout'))
        assert checkout.status_code == 201
        async with db() as s:
            receipt = await s.scalar(select(GoodsTestPurchase).where(GoodsTestPurchase.design_id == UUID(design['id'])))
            assert receipt.design_snapshot['product'] == 'magnet'


@pytest.mark.asyncio
async def test_legacy_keyring_requests_keep_same_replay_identity(db, tmp_path):
    from backend.http.idempotency import request_hash
    settings = config(dev_ai_enabled=True)
    store = LocalStorage(tmp_path)
    app = create_app(settings=settings, session_factory=db, media_storage=store)
    async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as c:
        me = await guest(c); await consent(c, me)
        wid = await work(c, me)
        url = f'/api/v1/goods/work/{wid}/revisions'
        original = await c.post(url, json=body(), headers=headers(me, 'legacy'))
        # Simulate a request accepted before the prompt upgrade. Replay must keep
        # the stored prompt/config, not regenerate it from today's profile.
        async with db() as s, s.begin():
            historical = await s.get(GoodsRevision, UUID(original.json()['data']['id']))
            historical.prompt = 'frozen historical artwork instructions'
            historical.config = {**historical.config, 'prompt_version': 'goods-pilot-v1'}
        explicit = await c.post(url, json={**body(), 'product': 'keyring'}, headers=headers(me, 'legacy'))
        assert original.status_code == explicit.status_code == 202
        assert original.json()['data'] == explicit.json()['data']
        async with db() as s:
            revision = await s.get(GoodsRevision, UUID(original.json()['data']['id']))
            assert revision.request_hash == request_hash(body())
            assert revision.config['prompt_version'] == 'goods-pilot-v1'
            assert revision.prompt == 'frozen historical artwork instructions'
            # Historical revisions have no product key and must still read as keyrings.
            revision.config = {}
            assert revision_view(revision)['product'] == 'keyring'


@pytest.mark.asyncio
async def test_product_is_strict_and_does_not_enable_multiple_generation(db, tmp_path):
    app = create_app(settings=config(dev_ai_enabled=True), session_factory=db, media_storage=LocalStorage(tmp_path))
    async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as c:
        me = await login(c)
        from backend.tests.integration.test_upload_http import consent as member_consent
        await member_consent(c, me)
        wid = await work(c, me)
        for invalid in ['other', '', None, 1, True]:
            assert (await c.post(f'/api/v1/goods/work/{wid}/revisions', json={**body(), 'product': invalid}, headers=headers(me, 'invalid'))).status_code == 422
            assert (await c.post(f'/api/v1/goods/work/{wid}/complete', json={'revision_id': wid, 'product': invalid, 'placement': {'holeX': .5, 'holeY': 0, 'widthMm': 50}}, headers=headers(me))).status_code == 422
        assert (await c.post(f'/api/v1/goods/work/{wid}/revisions', json={**body(), 'product': 'magnet', 'count': 3}, headers=headers(me, 'three'))).status_code == 422
        assert (await c.get(f'/api/v1/goods/work/{wid}')).json()['data']['revisions'] == []
