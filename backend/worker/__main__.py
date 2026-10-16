"""Signal-safe DB polling. Explicit adapters are required to execute product work."""
import asyncio
from contextlib import suppress
import logging
import signal
from datetime import datetime, timezone
from backend.database import session_factory
from backend.settings import Settings
from backend.worker.runner import Runner, ResultStore
from backend.uploads.validation import ValidationWorker


async def main() -> None:
    settings = Settings()
    sessions = session_factory(settings.database_url)
    validation = ValidationWorker(sessions, settings)
    executor = None
    if settings.app_env == 'local' and settings.dev_ai_enabled:
        from backend.generation.fake_adapter import FakeExecutor
        executor = FakeExecutor(sessions, validation.store)
    from backend.storage.factory import result_store
    runner = Runner(sessions, result_store(validation.store), executor, local_executor=executor)
    stopped = asyncio.Event()
    loop = asyncio.get_running_loop()
    next_oauth_cleanup = 0.0
    next_storage_scan = 0.0
    storage_scan = None
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stopped.set)
    logging.info('Worker DB recovery ready; upload validation/cleanup enabled; %s',
                 'local fake AI executor enabled' if executor else 'AI executor is not configured')
    try:
        while not stopped.is_set():
            # Claim useful work before maintenance; storage outages in recovery or
            # tombstone discovery must not prevent unrelated uploads from running.
            try:
                await validation.run_once()
            except Exception:
                logging.exception('Worker validation/cleanup job failed; retrying after poll interval')
            try:
                if loop.time() >= next_oauth_cleanup:
                    from backend.auth.oauth_repository import prune_login_requests
                    async with sessions() as session, session.begin():
                        await prune_login_requests(session, datetime.now(timezone.utc))
                    next_oauth_cleanup = loop.time() + 60
                await runner.maintenance()
            except Exception:
                logging.exception('Worker maintenance failed; retrying after poll interval')
            try:
                if validation.store.mode == 'r2':
                    if storage_scan is not None and storage_scan.done():
                        finished_scan, storage_scan = storage_scan, None
                        next_storage_scan = loop.time() + 30
                        # Retrieve errors without stopping the foreground job loop.
                        finished_scan.result()
                    if storage_scan is None and loop.time() >= next_storage_scan:
                        storage_scan = asyncio.create_task(validation.scan_incomplete_uploads(
                            datetime.now(timezone.utc), limit=10))
                else:
                    await validation.scan_incomplete_uploads(datetime.now(timezone.utc))
            except Exception:
                logging.exception('Worker storage sweep failed; retrying on next scan interval')
            try:
                if executor is not None:
                    work = asyncio.create_task(runner.run_once())
                    stopping = asyncio.create_task(stopped.wait())
                    try:
                        await asyncio.wait((work, stopping),return_when=asyncio.FIRST_COMPLETED)
                        if stopping.done() and not work.done(): work.cancel()
                        with suppress(asyncio.CancelledError): await work
                    finally:
                        stopping.cancel()
                        with suppress(asyncio.CancelledError): await stopping
            except Exception:
                logging.exception('Worker generation failed; retrying after poll interval')
            try:
                await asyncio.wait_for(stopped.wait(), timeout=settings.worker_poll_seconds)
            except TimeoutError:
                pass
    finally:
        if storage_scan is not None:
            storage_scan.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await storage_scan
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.remove_signal_handler(sig)
        await sessions.kw['bind'].dispose()
        logging.info('Worker stopped safely')


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    asyncio.run(main())
