"""Anonymous goods sessions cannot enter member APIs; no paid calls."""
import asyncio
from uuid import UUID
import httpx
import pytest
from sqlalchemy import select

from backend.main import create_app
from backend.models import User, Session, GoodsWork, GoodsRevision
from backend.storage.local import LocalStorage
from backend.goods_design.worker import GoodsWorker
from backend.tests.integration.test_auth_http import config, login, ORIGIN
from backend.tests.integration.test_album_http import headers


async def guest(client):
    response = await client.post('/api/v1/goods/guest-session', headers={'Origin': ORIGIN})
    assert response.status_code == 200
    return response.json()['data']


async def consent(client, me):
    response = await client.post('/api/v1/goods/consents', json={
        'policy_version': me['consent']['policy_version'],
        'purpose': 'photo_upload_and_ai_processing', 'agreed': True}, headers=headers(me))
    assert response.status_code in (200, 201)


async def work(client, me, key='work'):
    response = await client.post('/api/v1/goods/work', json={}, headers=headers(me, key))
    assert response.status_code == 201, response.text
    return response.json()['data']['id']


def body(parent=None):
    return {'style': 'free', 'message': '바다 여행의 조개', 'parent_id': parent, 'use_source': False}


@pytest.mark.asyncio
async def test_guest_cookie_csrf_consent_and_member_boundary(db, tmp_path):
    app = create_app(settings=config(dev_ai_enabled=True), session_factory=db, media_storage=LocalStorage(tmp_path))
    async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as c:
        assert (await c.get('/api/v1/goods/catalog')).status_code == 200
        assert (await c.post('/api/v1/goods/guest-session')).status_code == 403
        me = await guest(c)
        assert (await guest(c))['user']['id'] == me['user']['id']
        cookie = c.cookies.get('mori_guest')
        async with db() as s:
            user = await s.get(User, UUID(me['user']['id']))
            session = await s.scalar(select(Session).where(Session.user_id == user.id))
            assert user.is_guest and session.token_hash != cookie
        assert (await c.post('/api/v1/goods/work', json={}, headers=headers(me))).status_code == 403
        await consent(c, me)
        assert (await c.post('/api/v1/goods/work', json={}, headers={'Origin': ORIGIN})).status_code == 403
        wid = await work(c, me)
        for path in ['/api/v1/me', '/api/v1/albums', '/api/v1/goods/designs']:
            assert (await c.get(path)).status_code == 401
        # A valid guest token must never become a member session by changing its cookie name.
        c.cookies.set('mori_session', cookie)
        assert (await c.get('/api/v1/me')).status_code == 401
        c.cookies.delete('mori_session')
        response = await c.post(f'/api/v1/goods/work/{wid}/complete', json={
            'revision_id': wid, 'placement': {'holeX': .5, 'holeY': 0, 'widthMm': 50}}, headers=headers(me))
        assert response.status_code == 401
        app.state.settings.goods_guest_enabled = False
        assert (await c.get(f'/api/v1/goods/work/{wid}')).status_code == 401
        assert (await c.post('/api/v1/goods/guest-session', headers={'Origin': ORIGIN})).status_code == 503


@pytest.mark.asyncio
async def test_guest_three_total_generations_replay_and_claim_preserve_result(db, tmp_path):
    settings = config(dev_ai_enabled=True, goods_checkout_mode='test')
    store = LocalStorage(tmp_path)
    app = create_app(settings=settings, session_factory=db, media_storage=store)
    worker = GoodsWorker(db, store, settings)
    async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as c:
        me = await guest(c); await consent(c, me)
        wid = await work(c, me)
        parent = None
        for i in range(3):
            payload = body(parent)
            url = f'/api/v1/goods/work/{wid}/revisions'
            result = await c.post(url, json=payload, headers=headers(me, f'gen-{i}'))
            assert result.status_code == 202, result.text
            rid = result.json()['data']['id']
            assert (await c.post(url, json=payload, headers=headers(me, f'gen-{i}'))).json()['data']['id'] == rid
            assert await worker.run_once()
            parent = rid
        state = (await c.get(f'/api/v1/goods/work/{wid}')).json()['data']
        assert state['remaining_generations'] == 0 and not state['has_source']
        image_url = state['revisions'][-1]['image_url']
        image = (await c.get(image_url)).content
        second = await work(c, me, 'new-work')
        assert (await c.post(f'/api/v1/goods/work/{second}/revisions', json=body(), headers=headers(me, 'fourth'))).status_code == 429
        # Claim after real authentication; no copied bytes and no regeneration.
        member = await login(c)
        for _ in range(2):
            assert (await c.post('/api/v1/goods/claim', json={'work_id': wid}, headers=headers(member))).status_code == 200
        assert (await c.get(image_url)).content == image
        async with db() as s:
            revision = await s.get(GoodsRevision, UUID(rid))
            assert revision.result_key.startswith(me['user']['id'] + '/')
            assert revision.config['guest_id'] == me['user']['id']
            assert (await s.get(GoodsWork, UUID(wid))).owner_id == UUID(member['user']['id'])
        finish = await c.post(f'/api/v1/goods/work/{wid}/complete', json={
            'revision_id': rid, 'placement': {'holeX': .3, 'holeY': .2, 'widthMm': 60}}, headers=headers(member))
        assert finish.status_code == 200, finish.text
        design = finish.json()['data']['id']
        checkout = await c.post(f'/api/v1/goods/designs/{design}/test-checkout',
            json={'expected_version': 1}, headers=headers(member, 'checkout'))
        assert checkout.status_code == 201
        assert checkout.json()['data']['album_status'] == 'draft'
        # Original guest quota remains exhausted even after transfer and logout.
        await c.post('/api/v1/auth/logout', json={}, headers=headers(member))
        assert (await guest(c))['guest']['remaining'] == 0
        assert (await c.get(image_url)).status_code == 404
        other = await login(c, 'beta')
        assert (await c.post('/api/v1/goods/claim', json={'work_id': wid}, headers=headers(other))).status_code == 404


@pytest.mark.asyncio
async def test_guest_parallel_works_share_admission_cap_and_inflight_cannot_transfer(db, tmp_path):
    settings = config(dev_ai_enabled=True)
    app = create_app(settings=settings, session_factory=db, media_storage=LocalStorage(tmp_path))
    async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as c:
        me = await guest(c); await consent(c, me)
        works = [await work(c, me, f'work-{i}') for i in range(5)]
        results = await asyncio.gather(*(c.post(f'/api/v1/goods/work/{wid}/revisions', json=body(), headers=headers(me, f'gen-{i}')) for i, wid in enumerate(works)))
        assert sorted(r.status_code for r in results) == [202, 202, 202, 429, 429]
        wid = next(wid for wid, result in zip(works, results) if result.status_code == 202)
        member = await login(c)
        response = await c.post('/api/v1/goods/claim', json={'work_id': wid}, headers=headers(member))
        assert response.status_code == 409
        async with db() as s:
            assert (await s.get(GoodsWork, UUID(wid))).owner_id == UUID(me['user']['id'])


@pytest.mark.asyncio
async def test_pre_dispatch_failure_returns_guest_quota(db, tmp_path):
    settings = config(dev_ai_enabled=True)
    store = LocalStorage(tmp_path)
    app = create_app(settings=settings, session_factory=db, media_storage=store)
    async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as c:
        me = await guest(c); await consent(c, me)
        wid = await work(c, me)
        result = await c.post(f'/api/v1/goods/work/{wid}/revisions', json=body(), headers=headers(me, 'gen'))
        rid = UUID(result.json()['data']['id'])
        async with db() as s, s.begin():
            revision = await s.get(GoodsRevision, rid)
            revision.config = {**revision.config, 'source_key': 'missing-source'}
        assert await GoodsWorker(db, store, settings).run_once()
        state = (await c.get(f'/api/v1/goods/work/{wid}')).json()['data']
        assert state['remaining_generations'] == 3
        assert state['revisions'][0]['status'] == 'failed'
