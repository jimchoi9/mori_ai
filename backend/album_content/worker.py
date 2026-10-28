"""One owned caption lane per instance, durable fencing, shared USD/global limit.

No image generation. Only definitely-unsent failures retry automatically (max 3).
A crash after dispatch recovers a durable result or retains unknown without resend.
"""
import asyncio
import hashlib
from decimal import Decimal
from io import BytesIO
from PIL import Image
from backend.generation.budget import BudgetLedger,BudgetExceeded
from backend.generation.openai_provider import CAPTION_RESERVATION_USD,ProviderFailure
from backend.storage.factory import result_store
from backend.album_content.caption import caption


class ContentWorker:
    def __init__(self,sessions,settings,store,provider=None):
        self.sessions,self.settings,self.store,self.provider=sessions,settings,store,provider
        from backend.album_content.repository import ContentRepository
        self.repository=ContentRepository(sessions,settings);self.recovery_after=None
        self.results=result_store(store)
        self.ledger=BudgetLedger(sessions,settings.ai_validation_initial_budget_usd,settings.ai_validation_budget_usd)

    async def scan(self):return await self.repository.scan()
    async def claim(self):return await self.repository.claim()
    async def dispatch(self,c):return await self.repository.dispatch(c)
    async def apply(self,c,payload):return await self.repository.apply(c,payload)

    async def fail(self,c,code,*,unsent=False):
        real=c['config']['execution_mode']=='openai'
        if real:
            if unsent:await self.ledger.release_unsent(c['attempt'])
            else:await self.ledger.settle(c['attempt'],None,{},None)
        await self.repository.record_failure(c,code,unsent=unsent)

    async def recover(self):
        contexts,self.recovery_after=await self.repository.expired(self.recovery_after)
        for c in contexts:
            payload=await self.results.load(str(c['attempt']))
            if payload is not None:
                if c['config']['execution_mode']=='openai':await self.ledger.settle(c['attempt'],Decimal(payload['cost']) if payload.get('cost') is not None else None,payload.get('usage',{}),payload.get('request_id'))
                if await self.apply(c,payload):continue
            if c['status']=='unknown':continue
            await self.fail(c,'AI_RESULT_UNKNOWN' if c['dispatch']!='not_sent' else 'AI_TEMPORARY_FAILURE',unsent=c['dispatch']=='not_sent')

    async def run_once(self):
        if not self.settings.album_content_enabled:return
        await self.recover();await self.scan()
        if not self.settings.generation_enabled:return
        c=await self.claim()
        if c is None:return
        real=c['config']['execution_mode']=='openai';reserved=False;dispatched=False
        try:
            data=await asyncio.to_thread(self.store.read_bytes,c['key'])
            if len(data)!=c['bytes'] or hashlib.sha256(data).hexdigest()!=c['sha']:raise ValueError('input')
            def validate():
                with Image.open(BytesIO(data)) as image:
                    if image.format!='WEBP' or image.width*image.height>40_000_000:raise ValueError('input')
                    image.load()
            await asyncio.to_thread(validate)
            if real:
                reserved=await self.ledger.reserve(c['attempt'],CAPTION_RESERVATION_USD)
                if not reserved:return await self.fail(c,'AI_RESULT_UNKNOWN')
            dispatched=await self.dispatch(c)
            if not dispatched:return await self.fail(c,'STATE_CONFLICT',unsent=True)
            if real:
                response=await caption(self.provider,data,c['config'])
                payload={'caption':response.caption,'sha':c['sha'],'usage':response.usage,'cost':str(response.cost_usd) if response.cost_usd is not None else None,'request_id':response.request_id}
                await self.ledger.settle(c['attempt'],response.cost_usd,response.usage,response.request_id)
            else:
                from backend.generation.fake_adapter import CAPTION
                payload={'caption':CAPTION,'sha':c['sha']}
            await self.results.save(str(c['attempt']),payload)
            await self.apply(c,payload)
            return True
        except BudgetExceeded:
            # No reservation was created. Preserve a terminal manual-editable state.
            await self.repository.terminal(c,'USAGE_LIMIT_EXCEEDED')
        except ProviderFailure as e:
            if real and e.dispatch_state=='responded':
                await self.ledger.settle(c['attempt'],e.cost_usd,e.usage,e.request_id)
                await self.repository.terminal(c,e.code,responded=True)
            else:
                await self.fail(c,e.code,unsent=e.dispatch_state=='not_sent')
        except asyncio.CancelledError:raise
        except Exception:
            await self.fail(c,'AI_RESULT_UNKNOWN' if dispatched else 'MEDIA_SAVE_FAILED',unsent=not dispatched)
