"""Durable recommendation admission, cost/quota separation and private context."""
import asyncio
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import httpx
import pytest
from sqlalchemy import func, select

from backend.main import create_app
from backend.models import GoodsRevision, GoodsSuggestionBatch, GoodsWork, AIBudgetEntry
from backend.generation.openai_provider import ProviderFailure
from backend.goods_design.suggestions.provider import RecommendationResult
from backend.goods_design.suggestions.policy import SuggestionResult
from backend.goods_design.worker import GoodsWorker
from backend.storage.local import LocalStorage
from backend.tests.goods.test_suggestions import image, result
from backend.tests.integration.test_auth_http import config, ORIGIN, login
from backend.tests.integration.test_album_http import headers
from backend.tests.integration.test_goods_guests import guest, consent, work


class Provider:
    def __init__(self):
        self.calls = []
        self.failure = None
        self.wait = None

    async def suggest(self, context, data):
        self.calls.append((context, data))
        if self.wait: await self.wait.wait()
        if self.failure: raise self.failure
        value = result()
        # Distinct additional batches, without relying on any actual LLM.
        number = len(self.calls)
        for item in value['suggestions']: item['prompt'] += f' {number}'
        return RecommendationResult(SuggestionResult.model_validate(value),
            {'input_tokens': 2000, 'output_tokens': 400, 'total_tokens': 2400}, Decimal('0.0004'), 'req_test')


async def setup(c):
    me = await guest(c); await consent(c, me)
    wid = await work(c, me)
    assert (await c.put(f'/api/v1/goods/work/{wid}/source', content=image(), headers=headers(me))).status_code == 200
    return me, wid


def payload(**kwargs):
    return {'style': 'badge', 'product': 'magnet', 'parent_id': None, 'batch': 0, **kwargs}


@pytest.mark.asyncio
async def test_cached_suggestions_reuse_vision_without_spending_image_quota(db, tmp_path):
    provider = Provider()
    settings = config(dev_ai_enabled=True, goods_suggestions_enabled=True)
    app = create_app(settings=settings, session_factory=db, media_storage=LocalStorage(tmp_path), suggestion_provider=provider)
    async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as c:
        me, wid = await setup(c); url = f'/api/v1/goods/work/{wid}/suggestions'
        assert (await c.get('/api/v1/goods/catalog')).json()['data']['suggestions_enabled']
        a = await c.post(url, json=payload(), headers=headers(me))
        assert a.status_code == 200 and len(a.json()['data']['items']) == 10
        assert (await c.post(url, json=payload(), headers=headers(me))).json()['data'] == a.json()['data']
        assert len(provider.calls) == 1 and provider.calls[0][1] is not None
        other = await c.post(url, json=payload(style='book'), headers=headers(me))
        assert other.status_code == 200 and provider.calls[-1][1] is None
        assert provider.calls[-1][0].visual_summary == result()['visual_summary']
        await c.post(url, json=payload(batch=1), headers=headers(me))
        assert len(provider.calls[-1][0].excluded) == 10
        detail = (await c.get(f'/api/v1/goods/work/{wid}')).json()['data']
        assert detail['remaining_generations'] == 3 and detail['revisions'] == []
        async with db() as s:
            entries = (await s.scalars(select(AIBudgetEntry))).all()
            assert len(entries) == 3 and all(e.actual_usd == Decimal('0.0004') for e in entries)
        member = await login(c)
        assert (await c.post(url, json=payload(), headers=headers(member))).status_code == 403
        from backend.tests.integration.test_upload_http import consent as member_consent
        await member_consent(c, member)
        assert (await c.post(url, json=payload(), headers=headers(member))).status_code == 404
        assert (await c.post('/api/v1/goods/claim', json={'work_id': wid}, headers=headers(member))).status_code == 200
        assert (await c.post(url, json=payload(), headers=headers(member))).status_code == 200


@pytest.mark.asyncio
async def test_parallel_same_context_only_dispatches_once_and_daily_admission_is_durable(db, tmp_path):
    provider = Provider(); provider.wait = asyncio.Event()
    app = create_app(settings=config(goods_suggestions_enabled=True), session_factory=db,
        media_storage=LocalStorage(tmp_path), suggestion_provider=provider)
    async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as c:
        me, wid = await setup(c); url = f'/api/v1/goods/work/{wid}/suggestions'
        first = asyncio.create_task(c.post(url, json=payload(), headers=headers(me)))
        for _ in range(100):
            if provider.calls: break
            await asyncio.sleep(.01)
        assert len(provider.calls) == 1
        duplicate = await c.post(url, json=payload(), headers=headers(me))
        assert duplicate.json()['data']['source'] == 'pending'
        provider.wait.set(); assert (await first).status_code == 200
        async with db() as s, s.begin():
            for _ in range(19):
                s.add(GoodsSuggestionBatch(owner_id=UUID(me['user']['id']), work_id=UUID(wid),
                    context_hash=uuid4().hex, image_ref='source:test', batch=0, status='fallback'))
        limited = await c.post(url, json=payload(batch=1), headers=headers(me))
        assert limited.json()['data']['source'] == 'fallback' and len(provider.calls) == 1


@pytest.mark.asyncio
async def test_failures_keep_fallback_unknown_costs_and_do_not_retry(db, tmp_path):
    provider = Provider(); provider.failure = ProviderFailure('AI_RESULT_UNKNOWN')
    app = create_app(settings=config(goods_suggestions_enabled=True), session_factory=db,
        media_storage=LocalStorage(tmp_path), suggestion_provider=provider)
    async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as c:
        me, wid = await setup(c); url = f'/api/v1/goods/work/{wid}/suggestions'
        assert (await c.post(url, json=payload(), headers=headers(me))).json()['data']['source'] == 'fallback'
        await c.post(url, json=payload(), headers=headers(me))
        assert len(provider.calls) == 1
        async with db() as s:
            entry = await s.scalar(select(AIBudgetEntry))
            assert entry.status == 'unknown' and entry.actual_usd is None
        provider.failure = ProviderFailure('AI_TEMPORARY_FAILURE', dispatch_state='rejected')
        await c.post(url, json=payload(batch=1), headers=headers(me))
        async with db() as s:
            assert await s.scalar(select(func.count()).select_from(AIBudgetEntry).where(AIBudgetEntry.status == 'released')) == 1


@pytest.mark.asyncio
async def test_csrf_consent_owner_expiration_and_parent_are_checked(db, tmp_path):
    provider = Provider()
    app = create_app(settings=config(goods_suggestions_enabled=True), session_factory=db,
        media_storage=LocalStorage(tmp_path), suggestion_provider=provider)
    async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as c:
        me, wid = await setup(c); url = f'/api/v1/goods/work/{wid}/suggestions'
        assert (await c.post(url, json=payload())).status_code == 403
        assert (await c.post(url, json=payload(parent_id=str(uuid4())), headers=headers(me))).status_code == 422
        assert (await c.post(url, json=payload(batch=4), headers=headers(me))).status_code == 422
        async with db() as s, s.begin():
            current = await s.get(GoodsWork, UUID(wid))
            current.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        assert (await c.post(url, json=payload(), headers=headers(me))).status_code == 404
        assert provider.calls == []


@pytest.mark.asyncio
async def test_photo_without_prompt_generates_selected_style_and_replay_keeps_quota(db, tmp_path):
    settings = config(dev_ai_enabled=True)
    store = LocalStorage(tmp_path)
    app = create_app(settings=settings, session_factory=db, media_storage=store)
    async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as c:
        me, wid = await setup(c); url = f'/api/v1/goods/work/{wid}/revisions'
        body = {'style': 'illustration', 'message': '', 'parent_id': None}
        first = await c.post(url, json=body, headers=headers(me, 'photo-only'))
        assert first.status_code == 202, first.text
        assert (await c.post(url, json=body, headers=headers(me, 'photo-only'))).json()['data'] == first.json()['data']
        async with db() as s:
            row = await s.get(GoodsRevision, UUID(first.json()['data']['id']))
            assert row.message == '' and row.config['automatic_request']
            assert row.config['prompt_version'] == 'goods-small-v10-keyring-auto'
            assert 'WHOLE photographed scene' in row.prompt
        assert await GoodsWorker(db, store, settings).run_once()
        state = (await c.get(f'/api/v1/goods/work/{wid}')).json()['data']
        assert state['remaining_generations'] == 2
        assert (await c.post(url, json={**body, 'parent_id': first.json()['data']['id']}, headers=headers(me, 'empty-edit'))).status_code == 422
        empty = await work(c, me, 'empty')
        assert (await c.post(f'/api/v1/goods/work/{empty}/revisions', json={**body, 'use_source': False}, headers=headers(me, 'no-input'))).status_code == 422


@pytest.mark.asyncio
async def test_budget_failure_uses_fallback_without_dispatch_or_image_quota(db, tmp_path):
    provider = Provider()
    settings = config(goods_suggestions_enabled=True, ai_validation_initial_budget_usd=Decimal('0.005'))
    app = create_app(settings=settings, session_factory=db, media_storage=LocalStorage(tmp_path), suggestion_provider=provider)
    async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as c:
        me, wid = await setup(c)
        response = await c.post(f'/api/v1/goods/work/{wid}/suggestions', json=payload(), headers=headers(me))
        assert response.json()['data']['source'] == 'fallback' and provider.calls == []
        assert (await c.get(f'/api/v1/goods/work/{wid}')).json()['data']['remaining_generations'] == 3
        async with db() as s:
            assert await s.scalar(select(func.count()).select_from(AIBudgetEntry)) == 0


@pytest.mark.asyncio
async def test_discard_during_recommendation_blocks_late_result_and_erases_private_cache(db, tmp_path):
    provider = Provider(); provider.wait = asyncio.Event()
    settings = config(dev_ai_enabled=True, goods_suggestions_enabled=True)
    store = LocalStorage(tmp_path)
    app = create_app(settings=settings, session_factory=db, media_storage=store, suggestion_provider=provider)
    async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as c:
        me, wid = await setup(c)
        pending = asyncio.create_task(c.post(f'/api/v1/goods/work/{wid}/suggestions', json=payload(), headers=headers(me)))
        for _ in range(100):
            if provider.calls: break
            await asyncio.sleep(.01)
        assert provider.calls
        assert (await c.delete(f'/api/v1/goods/work/{wid}', headers=headers(me))).status_code == 204
        provider.wait.set()
        assert (await pending).status_code == 404
        await GoodsWorker(db, store, settings).maintenance()
        async with db() as s:
            cached = await s.scalar(select(GoodsSuggestionBatch))
            assert cached.items is None and cached.visual_summary is None
            assert (await s.scalar(select(AIBudgetEntry))).actual_usd == Decimal('0.0004')


@pytest.mark.asyncio
async def test_cancelled_dispatch_remains_pending_and_never_repeats_paid_call(db, tmp_path):
    provider = Provider(); provider.wait = asyncio.Event()
    app = create_app(settings=config(goods_suggestions_enabled=True), session_factory=db,
        media_storage=LocalStorage(tmp_path), suggestion_provider=provider)
    async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as c:
        me, wid = await setup(c)
        from backend.goods_design.suggestions.policy import SuggestRequest
        service = app.state.goods_suggestions
        pending = asyncio.create_task(service.suggest(UUID(me['user']['id']), UUID(wid), SuggestRequest(**payload())))
        for _ in range(100):
            if provider.calls: break
            await asyncio.sleep(.01)
        assert provider.calls
        pending.cancel()
        with pytest.raises(asyncio.CancelledError): await pending
        replay = await service.suggest(UUID(me['user']['id']), UUID(wid), SuggestRequest(**payload()))
        assert replay['source'] == 'pending' and len(provider.calls) == 1
        async with db() as s:
            entry = await s.scalar(select(AIBudgetEntry))
            assert entry.status == 'reserved' and entry.actual_usd is None


@pytest.mark.asyncio
async def test_selected_design_is_the_image_and_only_its_ancestry_is_used(db, tmp_path):
    provider = Provider(); settings = config(dev_ai_enabled=True, goods_suggestions_enabled=True)
    store = LocalStorage(tmp_path)
    app = create_app(settings=settings, session_factory=db, media_storage=store, suggestion_provider=provider)
    async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as c:
        me, wid = await setup(c)
        ids = []
        for index, message in enumerate(['첫 여행', '선택한 수정', '다른 갈래']):
            response = await c.post(f'/api/v1/goods/work/{wid}/revisions', json={
                'style': 'free', 'message': message, 'parent_id': ids[0] if ids else None}, headers=headers(me, f'branch-{index}'))
            assert response.status_code == 202
            ids.append(response.json()['data']['id'])
            assert await GoodsWorker(db, store, settings).run_once()
        response = await c.post(f'/api/v1/goods/work/{wid}/suggestions', json=payload(parent_id=ids[1]), headers=headers(me))
        assert response.status_code == 200
        context, data = provider.calls[-1]
        assert context.editing and context.image_ref == f'revision:{ids[1]}' and data
        assert context.history == ('첫 여행', '선택한 수정')
