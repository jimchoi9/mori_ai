"""Recommendation orchestration. Image quota and image dispatch are never involved."""
import asyncio

from backend.generation.budget import BudgetLedger
from backend.generation.openai_provider import ProviderFailure
from backend.generation.service import require_consent
from backend.goods_design.service import work
from backend.telemetry import emit
from . import repository
from .policy import RESERVATION_USD, public_items
from .provider import thumbnail


class SuggestionService:
    def __init__(self, sessions, storage, settings, provider):
        self.sessions, self.storage, self.settings, self.provider = sessions, storage, settings, provider
        self.ledger = BudgetLedger(sessions, settings.ai_validation_initial_budget_usd,
                                   settings.ai_validation_budget_usd)
        self.slots = asyncio.Semaphore(2)

    async def suggest(self, owner, work_id, body):
        async with self.sessions() as session, session.begin():
            await require_consent(session, owner, self.settings)
            if not self.settings.goods_suggestions_enabled or not self.provider:
                await work(session, owner, work_id)
                return {'items': [], 'source': 'disabled', 'batch': body.batch}
            admission = await repository.prepare(session, owner, work_id, body)
        if admission.response is not None:
            return admission.response
        context, attempt = admission.context, admission.id
        acquired = False
        result = None
        try:
            await asyncio.wait_for(self.slots.acquire(), timeout=0.05)
            acquired = True
            result = await self._generate(context, attempt)
        except TimeoutError:
            pass
        finally:
            if acquired:
                self.slots.release()
        items = None
        if result:
            try:
                items = public_items(result.result, context.excluded, style=context.style, editing=context.editing)
            except ValueError:
                emit('goods.suggestions.fallback', error_code='SUGGESTIONS_NOT_DISTINCT', outcome='fallback')
        async with self.sessions() as session, session.begin():
            return await repository.finish(session, owner, work_id, attempt, items,
                result.result.visual_summary if result and items else None)

    async def _generate(self, context, attempt):
        # Durable admission survives cancellation/restart; pending calls are never redispatched.
        result = None
        try:
            image = None
            if not context.visual_summary:
                data = await asyncio.to_thread(self.storage.read_bytes, context.image_key)
                image = await asyncio.to_thread(thumbnail, data)
            if not await self.ledger.reserve(attempt, RESERVATION_USD):
                return None
            try:
                result = await self.provider.suggest(context, image)
            except ProviderFailure as exc:
                emit('goods.suggestions.fallback', error_code=exc.code, outcome='fallback')
                if exc.dispatch_state in ('not_sent', 'rejected'):
                    await self.ledger.release_unsent(attempt)
                else:
                    await self.ledger.settle(attempt, exc.cost_usd, exc.usage, exc.request_id)
            except asyncio.CancelledError:
                # Keep the reservation and pending admission; an unknown dispatch cannot retry.
                raise
            except Exception:
                await self.ledger.settle(attempt, None, {}, None)
            else:
                await self.ledger.settle(attempt, result.cost_usd, result.usage, result.request_id)
        except Exception as exc:
            # Storage/budget failures keep the private base recommendations usable.
            # If dispatch occurred, its durable reservation remains charged.
            emit('goods.suggestions.fallback', error_type=type(exc).__name__, outcome='fallback')
        return result
