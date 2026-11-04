"""One owned naming lane. Financial reservations and unknown outcomes never replay."""
import asyncio
from decimal import Decimal
from backend.album_titles.repository import TitleRepository
from backend.album_titles.provider import generate,RESERVATION
from backend.generation.budget import BudgetLedger,BudgetExceeded
from backend.generation.openai_provider import ProviderFailure
from backend.storage.factory import result_store

class TitleWorker:
    def __init__(self,sessions,settings,store,provider=None):
        self.settings,self.provider=settings,provider
        self.repository=TitleRepository(sessions,settings)
        self.results=result_store(store)
        self.ledger=BudgetLedger(sessions,settings.ai_validation_initial_budget_usd,settings.ai_validation_budget_usd)

    async def settle_received(self,c,payload):
        if c['config']['execution_mode']=='openai':
            await self.ledger.settle(c['job'],Decimal(payload['cost']) if payload.get('cost') is not None else None,payload.get('usage',{}),payload.get('request_id'))
        if payload.get('error'):
            await self.repository.finish(c,'failed',payload['error'])
        else:
            await self.repository.finish(c,'succeeded',payload=payload)

    async def recover(self):
        for c in await self.repository.expired():
            payload=await self.results.load(str(c['job']))
            real=c['config']['execution_mode']=='openai'
            if payload is not None:
                await self.settle_received(c,payload)
            elif c['status']=='running':
                if real:
                    if c['dispatch']=='not_sent':await self.ledger.release_unsent(c['job'])
                    else:await self.ledger.settle(c['job'],None,{},None)
                await self.repository.finish(c,'failed' if c['dispatch']=='not_sent' else 'unknown','AI_RESULT_UNKNOWN')

    async def run_once(self):
        if not self.settings.album_content_enabled:return
        await self.recover()
        if not self.settings.generation_enabled:return
        await self.repository.scan()
        c=await self.repository.claim()
        if c is None:return
        real=c['config']['execution_mode']=='openai';dispatched=False;reserved=False
        try:
            if real:
                reserved=await self.ledger.reserve(c['job'],RESERVATION)
                if not reserved:
                    await self.repository.finish(c,'unknown','AI_RESULT_UNKNOWN');return
            dispatched=await self.repository.dispatch(c)
            if not dispatched:
                if real:await self.ledger.release_unsent(c['job'])
                await self.repository.finish(c,'cancelled');return
            if real:
                response=await generate(self.provider,c['captions'])
                payload={'title':response.caption,'usage':response.usage,'cost':str(response.cost_usd) if response.cost_usd is not None else None,'request_id':response.request_id}
            else:payload={'title':'사진 모음'}
            # Persist the response before settlement/application so crashes cannot lose a receipt.
            await self.results.save(str(c['job']),payload)
            await self.settle_received(c,payload)
            return True
        except BudgetExceeded:await self.repository.finish(c,'failed','USAGE_LIMIT_EXCEEDED')
        except ProviderFailure as exc:
            if exc.dispatch_state=='not_sent':
                if reserved:await self.ledger.release_unsent(c['job'])
                await self.repository.finish(c,'failed',exc.code)
            elif exc.dispatch_state=='responded':
                payload={'error':exc.code,'usage':exc.usage,'cost':str(exc.cost_usd) if exc.cost_usd is not None else None,'request_id':exc.request_id}
                await self.results.save(str(c['job']),payload)
                await self.settle_received(c,payload)
            else:
                if reserved:await self.ledger.settle(c['job'],None,exc.usage,exc.request_id)
                await self.repository.finish(c,'unknown',exc.code)
        except asyncio.CancelledError:raise
        except Exception:
            if real and reserved:
                if dispatched:await self.ledger.settle(c['job'],None,{},None)
                else:await self.ledger.release_unsent(c['job'])
            await self.repository.finish(c,'unknown' if dispatched else 'failed','AI_RESULT_UNKNOWN')
