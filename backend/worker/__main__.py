"""Signal-safe DB polling. Explicit adapters are required to execute product work."""
import asyncio
import logging
import signal
from datetime import datetime, timezone
from backend.database import session_factory
from backend.settings import Settings
from backend.worker.runner import Runner
from backend.worker.scheduler import run_worker
from backend.uploads.validation import ValidationWorker


async def main() -> None:
    settings = Settings()
    sessions = session_factory(settings.database_url)
    validation = ValidationWorker(sessions, settings)
    executor = None
    if settings.ai_real_calls_enabled:
        from backend.generation.real_adapter import RealExecutor
        from backend.generation.openai_provider import OpenAIProvider
        from backend.generation.budget import BudgetLedger
        executor = RealExecutor(sessions, validation.store, OpenAIProvider(settings),
            BudgetLedger(sessions, limit_usd=settings.ai_validation_initial_budget_usd,
                hard_limit_usd=settings.ai_validation_budget_usd), settings)
    elif settings.app_env == 'local' and settings.dev_ai_enabled:
        from backend.generation.fake_adapter import FakeExecutor
        executor = FakeExecutor(sessions, validation.store)
    from backend.storage.factory import result_store
    runner = Runner(sessions, result_store(validation.store), executor, local_executor=executor)
    from backend.goods_design.worker import GoodsWorker
    goods = GoodsWorker(sessions, validation.store, settings)
    from backend.goods_design.delivery.worker import DeliveryWorker
    delivery = DeliveryWorker(sessions, validation.store, settings)
    contents=[]
    if settings.album_content_enabled:
        from backend.album_content.worker import ContentWorker
        # Separate recovery cursors per lane; DB claims still share the global
        # four-caption limit with legacy generation and other worker processes.
        contents=[ContentWorker(sessions,settings,validation.store,
            executor.provider if settings.ai_real_calls_enabled and executor else None) for _ in range(2)]
    stopped = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stopped.set)
    logging.info('Worker DB recovery ready; upload validation/cleanup enabled; %s',
                 ('real AI executor enabled' if settings.ai_real_calls_enabled else 'local fake AI executor enabled') if executor else 'AI executor is not configured')
    async def oauth_cleanup():
        from backend.auth.oauth_repository import prune_login_requests
        async with sessions() as session, session.begin():
            await prune_login_requests(session, datetime.now(timezone.utc))

    try:
        await run_worker(validation, runner, stopped,
                         poll_seconds=settings.worker_poll_seconds,
                         generation_enabled=executor is not None,
                         oauth_cleanup=oauth_cleanup, goods_operation=goods.run_once if executor else goods.maintenance,
                         delivery_operation=delivery.run_once, content_operations=tuple(c.run_once for c in contents))
    finally:
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.remove_signal_handler(sig)
        if settings.ai_real_calls_enabled and executor is not None:
            await executor.provider.aclose()
        if goods.provider is not None:
            await goods.provider.aclose()
        await delivery.aclose()
        await sessions.kw['bind'].dispose()
        logging.info('Worker stopped safely')


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    asyncio.run(main())
