"""Fixed, owned polling lanes: no task is allocated per queued or idle item."""
import asyncio
import logging
from datetime import datetime, timezone
from functools import partial

from backend.generation.concurrency import GLOBAL_STAGE_LIMITS


async def _poll(operation, stopped, interval, name, *, drain_ready=False):
    while not stopped.is_set():
        try:
            processed = await operation()
            if drain_ready and processed is True:
                # A claimed item completed. Keep one owned lane, yielding to
                # shutdown/other lanes, without sleeping between queued items.
                await asyncio.sleep(0)
                continue
        except Exception as exc:
            # Exceptions can carry provider payloads or signed URLs.
            logging.warning('Worker %s failed error_class=%s', name, type(exc).__name__)
        try:
            await asyncio.wait_for(stopped.wait(), timeout=interval)
        except TimeoutError:
            pass


async def run_worker(validation, runner, stopped, *, poll_seconds,
                     generation_enabled=True, oauth_cleanup=None, goods_operation=None, delivery_operation=None,
                     content_operation=None, content_operations=()):
    if poll_seconds <= 0:
        raise ValueError('poll_seconds must be positive')
    if content_operation is not None and content_operations:
        raise ValueError('Use one content operation form')
    content_operations = tuple(content_operations) if content_operation is None else (content_operation,)
    if len(content_operations) > 2:
        raise ValueError('At most two owned content lanes per worker')
    async def scan():
        await validation.scan_incomplete_uploads(datetime.now(timezone.utc), limit=10)
    operations = [(_poll(validation.run_once, stopped, poll_seconds, 'validation', drain_ready=True)),
                  (_poll(runner.maintenance, stopped, poll_seconds, 'maintenance')),
                  (_poll(scan, stopped, 30, 'storage_scan'))]
    if oauth_cleanup is not None:
        operations.append(_poll(oauth_cleanup, stopped, 60, 'oauth_cleanup'))
    if goods_operation is not None:
        operations.append(_poll(goods_operation, stopped, poll_seconds, 'goods'))
    if delivery_operation is not None:
        operations.append(_poll(delivery_operation, stopped, max(5, poll_seconds), 'purchase_delivery'))
    for index, operation in enumerate(content_operations):
        operations.append(_poll(operation,stopped,poll_seconds,f'album_content_{index}',drain_ready=True))
    if generation_enabled:
        for stage, count in GLOBAL_STAGE_LIMITS.items():
            for _ in range(count):
                operations.append(_poll(partial(runner.run_once, stage=stage), stopped, poll_seconds, stage))
    owned = [asyncio.create_task(op) for op in operations]
    try:
        await stopped.wait()
    finally:
        for task in owned:
            task.cancel()
        await asyncio.gather(*owned, return_exceptions=True)
