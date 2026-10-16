"""DB execution and recovery with an explicitly injected AI port.

The default worker never invents AI/media success: it runs recovery and outbox
maintenance only until application adapters are installed. All file I/O is in
threads and outside database transactions; every heartbeat opens a new session.
"""
import asyncio
from contextlib import suppress
from datetime import datetime, timezone, timedelta
import hashlib
import json
import os
from pathlib import Path
from uuid import UUID, uuid4
from sqlalchemy import select, update, or_
from backend.models import Task, Attempt, Album, Run
from backend.generation.repository import claim_task, settle_task, _locked_task, _active, mark_action_required
from backend.worker.jobs import enqueue_job, dispatch_outbox, recover_jobs


def utcnow():
    return datetime.now(timezone.utc)


class ResultStore:
    """Local durable attempt envelope; no user-provided filesystem paths."""
    def __init__(self, root: Path):
        self.root = root

    def _path(self, key):
        return self.root / 'attempts' / f'{UUID(key)}.json'

    async def save(self, key, result):
        def write():
            path = self._path(key)
            path.parent.mkdir(parents=True, exist_ok=True)
            payload = json.dumps(result, sort_keys=True, ensure_ascii=False)
            checksum = hashlib.sha256(payload.encode()).hexdigest()
            envelope = json.dumps({'key': key, 'payload': payload, 'sha256': checksum})
            temporary = path.with_suffix(f'.{uuid4()}.tmp')
            try:
                with temporary.open('x') as f:
                    f.write(envelope); f.flush(); os.fsync(f.fileno())
                os.replace(temporary, path)
                fd = os.open(path.parent, os.O_DIRECTORY)
                try:
                    os.fsync(fd)
                finally:
                    os.close(fd)
            finally:
                temporary.unlink(missing_ok=True)
            return checksum
        return await asyncio.to_thread(write)

    async def load(self, key, expected_checksum=None):
        def read():
            try:
                envelope = json.loads(self._path(key).read_text())
                checksum = hashlib.sha256(envelope['payload'].encode()).hexdigest()
                if envelope['key'] != key or envelope['sha256'] != checksum or (expected_checksum and checksum != expected_checksum):
                    return None
                result = json.loads(envelope['payload'])
                if not isinstance(result, dict):
                    return None
                return result
            except (OSError, ValueError, KeyError, TypeError):
                return None
        return await asyncio.to_thread(read)


class Runner:
    def __init__(self, sessions, store, adapter=None, *, lease_seconds=90, heartbeat_seconds=15, local_executor=None):
        if not 0 < heartbeat_seconds < lease_seconds:
            raise ValueError('heartbeat must be shorter than lease')
        self.sessions, self.store, self.adapter = sessions, store, adapter
        self.lease_seconds, self.heartbeat_seconds = lease_seconds, heartbeat_seconds
        self.local_executor = local_executor

    async def prepare(self, claim):
        async with self.sessions() as s, s.begin():
            rows = await _locked_task(s, claim.task_id)
            if rows is None or not _active(*rows, claim.fence_version, utcnow()):
                return None
            album, run, task, page = rows
            if task.requires_ai_call and run.status == 'action_required':
                task.status = 'queued'; task.lease_until = None
                return None
            task.attempt_count += 1
            attempt = Attempt(task_id=task.id, attempt_no=task.attempt_count, fence_version=claim.fence_version)
            s.add(attempt); await s.flush()
            attempt.result_key = str(attempt.id)
            return attempt.id, task.stage, task.requires_ai_call

    async def _mark_sent(self, claim, attempt_id):
        async with self.sessions() as s, s.begin():
            rows = await _locked_task(s, claim.task_id)
            if rows is None or not _active(*rows, claim.fence_version, utcnow()):
                return False
            album, run, task, page = rows
            if task.requires_ai_call and run.status == 'action_required':
                task.status = 'queued'; task.lease_until = None
                return False
            attempt = await s.get(Attempt, attempt_id)
            attempt.status = 'dispatching'; attempt.dispatch_state = 'accepted_or_unknown'
            return True

    async def _heartbeat(self, claim):
        while True:
            await asyncio.sleep(self.heartbeat_seconds)
            async with self.sessions() as s, s.begin():
                now = utcnow()
                result = await s.execute(update(Task).where(Task.id == claim.task_id, Task.status == 'running', Task.fence_version == claim.fence_version, Task.lease_until > now).values(lease_until=now+timedelta(seconds=self.lease_seconds)))
                if not result.rowcount:
                    return

    async def _received(self, claim, attempt_id, result, checksum):
        async with self.sessions() as s, s.begin():
            rows = await _locked_task(s, claim.task_id)
            if rows is None:
                return False
            album, run, task, page = rows
            attempt = await s.get(Attempt, attempt_id)
            # Preserve the original response even if scanner has marked it unknown.
            # Never let an older attempt replace the current attempt's result.
            if attempt.attempt_no != task.attempt_count:
                if result.get('asset_id'):
                    await enqueue_job(s, 'cleanup_asset', UUID(result['asset_id']))
                return False
            attempt.status = 'received'; attempt.result_sha256 = checksum; attempt.finished_at = utcnow()
            attempt.output_caption = result.get('caption')
            attempt.output_asset_id = UUID(result['asset_id']) if result.get('asset_id') else None
            if album.deleted_at is not None or album.status == 'deleted' or page.removed_at is not None:
                if attempt.output_asset_id:
                    await enqueue_job(s, 'cleanup_asset', attempt.output_asset_id)
                return False
            if not _active(*rows, claim.fence_version, utcnow()):
                return False
            task.output_caption = attempt.output_caption; task.output_asset_id = attempt.output_asset_id
            return True

    async def run_once(self):
        if self.adapter is None and self.local_executor is None:
            return False
        async with self.sessions() as s:
            claim = await claim_task(s, utcnow(), self.lease_seconds)
        if claim is None:
            return False
        prepared = await self.prepare(claim)
        if prepared is None:
            return False
        attempt_id, stage, needs_ai = prepared
        executor = self.adapter if needs_ai else self.local_executor
        if executor is None:
            # No handler is not a successful job. Leave unsent attempt for scanner.
            return False
        heartbeat = asyncio.create_task(self._heartbeat(claim))
        try:
            if needs_ai and not await self._mark_sent(claim, attempt_id):
                return False
            result = await executor.execute(attempt_id, stage)
            checksum = await self.store.save(str(attempt_id), result)
            if await self._received(claim, attempt_id, result, checksum):
                async with self.sessions() as s:
                    await settle_task(s, claim.task_id, claim.fence_version, 'succeeded', utcnow())
            return True
        except asyncio.CancelledError:
            raise  # Shutdown preserves dispatch boundary; scanner determines safe recovery.
        except Exception:
            # Without definitive not_sent/rejected evidence, never automatically retry AI.
            async with self.sessions() as s:
                await settle_task(s, claim.task_id, claim.fence_version, 'unknown' if needs_ai else 'failed', utcnow())
            return True
        finally:
            heartbeat.cancel()
            with suppress(asyncio.CancelledError):
                await heartbeat

    async def recover(self, now=None):
        now = now or utcnow()
        async with self.sessions() as s:
            task_ids = list(await s.scalars(select(Task.id).where(or_(Task.status == 'unknown', (Task.status == 'running') & (Task.lease_until <= now)))))
        recovered = 0
        for task_id in task_ids:
            async with self.sessions() as s:
                attempt = await s.scalar(select(Attempt).where(Attempt.task_id == task_id).order_by(Attempt.attempt_no.desc()).limit(1))
                key = attempt.result_key if attempt else None
                checksum = attempt.result_sha256 if attempt else None
                attempt_id = attempt.id if attempt else None
                db_result = ({'caption': attempt.output_caption} if attempt and attempt.status == 'received' and attempt.output_caption is not None else None)
            # No row lock while looking for deterministic preserved output.
            result = await self.store.load(key, checksum) if key else None
            if result is None:
                result = db_result
            recovered_claim = None
            async with self.sessions() as s, s.begin():
                rows = await _locked_task(s, task_id)
                if rows is None:
                    continue
                album, run, task, page = rows
                if not (task.status == 'unknown' or (task.status == 'running' and task.lease_until and task.lease_until <= now)):
                    continue
                latest = await s.scalar(select(Attempt).where(Attempt.task_id == task_id).order_by(Attempt.attempt_no.desc()).limit(1))
                if (latest.id if latest else None) != attempt_id:
                    continue
                if album.deleted_at is not None or album.status == 'deleted' or page.removed_at is not None or run.status == 'cancelled':
                    task.status = 'cancelled'; task.fence_version += 1; task.lease_until = None
                    if result and result.get('asset_id'):
                        await enqueue_job(s, 'cleanup_asset', UUID(result['asset_id']))
                    continue
                if result is not None:
                    latest.status = 'received'; latest.finished_at = now
                    latest.output_caption = result.get('caption')
                    latest.output_asset_id = UUID(result['asset_id']) if result.get('asset_id') else None
                    task.output_caption = latest.output_caption; task.output_asset_id = latest.output_asset_id
                    task.fence_version += 1; task.status = 'running'; task.lease_until = now+timedelta(seconds=self.lease_seconds)
                    from backend.generation.repository import TaskClaim
                    recovered_claim = TaskClaim(task.id, task.fence_version, task.lease_until)
                elif latest is None or latest.dispatch_state in {'not_sent', 'rejected'}:
                    if task.status != 'unknown':
                        exhausted = task.attempt_count >= run.config_snapshot.get('max_attempts', 3)
                        task.status = 'failed' if exhausted else 'queued'
                        task.fence_version += 1; task.lease_until = None
                        if exhausted:
                            task.safe_to_retry = True
                            mark_action_required(album, run)
                else:
                    if task.status != 'unknown':
                        task.fence_version += 1
                    task.status = 'unknown'; task.lease_until = None
                    latest.status = 'unknown'; mark_action_required(album, run)
                    await enqueue_job(s, 'reconcile_attempt', latest.id)
            if recovered_claim:
                async with self.sessions() as s:
                    if await settle_task(s, task_id, recovered_claim.fence_version, 'succeeded', now):
                        recovered += 1
        return recovered

    async def maintenance(self):
        now = utcnow()
        await self.recover(now)
        async with self.sessions() as s:
            await recover_jobs(s, now)
        async with self.sessions() as s:
            await dispatch_outbox(s, now)
