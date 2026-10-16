"""Signal-safe foundation loop; does not claim or execute product jobs yet."""
import asyncio
import logging
import signal

from backend.settings import Settings


async def main() -> None:
    settings = Settings()
    stopped = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stopped.set)
    logging.info("Worker foundation ready; job execution is not implemented")
    try:
        while not stopped.is_set():
            try:
                await asyncio.wait_for(stopped.wait(), timeout=settings.worker_poll_seconds)
            except TimeoutError:
                pass
    finally:
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.remove_signal_handler(sig)
        logging.info("Worker stopped safely")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    asyncio.run(main())
