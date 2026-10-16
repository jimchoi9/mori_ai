"""Signal-safe DB polling. Explicit adapters are required to execute product work."""
import asyncio
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
    runner = Runner(sessions, ResultStore(settings.storage_root))
    validation = ValidationWorker(sessions, settings)
    stopped = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stopped.set)
    logging.info('Worker DB recovery ready; upload validation/cleanup enabled; AI executor is not configured')
    try:
        while not stopped.is_set():
            try:
                await runner.maintenance()
                await validation.scan_incomplete_uploads(datetime.now(timezone.utc))
                await validation.run_once()
            except Exception:
                # DB outage or migrations not applied must not invent success or spin.
                logging.exception('Worker maintenance failed; retrying after poll interval')
            try:
                await asyncio.wait_for(stopped.wait(), timeout=settings.worker_poll_seconds)
            except TimeoutError:
                pass
    finally:
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.remove_signal_handler(sig)
        await sessions.kw['bind'].dispose()
        logging.info('Worker stopped safely')


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    asyncio.run(main())
