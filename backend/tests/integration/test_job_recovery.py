import asyncio
from datetime import timedelta
from pathlib import Path
import os
import sys
import pytest
from sqlalchemy import select, func
from backend.models import Task, Attempt, Job, Outbox, Page, Run, Album
pytestmark = pytest.mark.asyncio


async def wait_marker(path, process):
    for _ in range(300):
        if path.exists():
            return
        if process.returncode is not None:
            raise AssertionError(f'worker exited early: {process.returncode}')
        await asyncio.sleep(.02)
    raise AssertionError(f'barrier not reached: {path}')


async def crash_worker(db, seeded, tmp_path, phase):
    process = await asyncio.create_subprocess_exec(sys.executable, '-m', 'backend.tests.integration.crash_worker', phase, str(tmp_path))
    try:
        await wait_marker(tmp_path / 'barrier', process)
        process.kill()
        await process.wait()
        assert process.returncode < 0
    finally:
        if process.returncode is None:
            process.kill(); await process.wait()
    # Expire in the database after true process termination, not a fabricated in-memory task.
    async with db() as s, s.begin():
        task = await s.get(Task, seeded['task']); task.lease_until = seeded['now'] - timedelta(seconds=1)


async def restart_worker(tmp_path):
    process = await asyncio.create_subprocess_exec(sys.executable, '-m', 'backend.tests.integration.crash_worker', 'restart', str(tmp_path), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        async with asyncio.timeout(10):
            output, errors = await process.communicate()
        assert process.returncode == 0, errors.decode()
    finally:
        if process.returncode is None:
            process.kill(); await process.wait()


async def test_sent_attempt_lease_expiry_is_unknown_without_second_call(db, seeded, tmp_path):
    from backend.worker.runner import Runner, ResultStore
    await crash_worker(db, seeded, tmp_path, 'sent')
    runner = Runner(db, ResultStore(tmp_path))
    await runner.recover(seeded['now'])
    await runner.recover(seeded['now'])
    async with db() as s:
        assert (await s.get(Task, seeded['task'])).status == 'unknown'
        assert (await s.get(Run, seeded['run'])).status == 'action_required'
        assert (await s.get(Album, seeded['album'])).version == 2
        assert await s.scalar(select(func.count()).select_from(Job).where(Job.kind == 'reconcile_attempt')) == 1
    # Restart production Runner with the same counting fake: unknown must never be dispatched.
    await restart_worker(tmp_path)
    assert (tmp_path / 'calls').read_text() == 'call\n'


async def test_unsent_attempt_can_requeue(db, seeded, tmp_path):
    from backend.worker.runner import Runner, ResultStore
    await crash_worker(db, seeded, tmp_path, 'prepared')
    runner = Runner(db, ResultStore(tmp_path))
    await runner.recover(seeded['now'])
    async with db() as s:
        assert (await s.get(Task, seeded['task'])).status == 'queued'
    assert not (tmp_path / 'calls').exists()
    await restart_worker(tmp_path)
    async with db() as s:
        assert (await s.get(Task, seeded['task'])).status == 'succeeded'
    assert (tmp_path / 'calls').read_text() == 'call\n'


async def test_saved_result_recovers_without_ai(db, seeded, tmp_path):
    from backend.worker.runner import Runner, ResultStore
    await crash_worker(db, seeded, tmp_path, 'saved')
    await restart_worker(tmp_path)
    runner = Runner(db, ResultStore(tmp_path))
    await runner.recover(seeded['now'])
    await runner.recover(seeded['now'])
    async with db() as s:
        assert (await s.get(Task, seeded['task'])).status == 'succeeded'
        assert (await s.get(Page, seeded['page'])).caption_text == '보존된 한 문장.'
    assert (tmp_path / 'calls').read_text() == 'call\n'


async def test_outbox_replay_has_one_cleanup_job(db, seeded):
    from backend.worker.jobs import dispatch_outbox
    async with db() as s, s.begin():
        s.add_all([Outbox(event_type='album_cleanup', entity_id=seeded['album']), Outbox(event_type='album_cleanup', entity_id=seeded['album'])])
    async with db() as a, db() as b:
        await asyncio.gather(dispatch_outbox(a, seeded['now']), dispatch_outbox(b, seeded['now']))
    async with db() as s:
        jobs = (await s.scalars(select(Job))).all()
        assert len(jobs) == 1 and jobs[0].kind == 'cleanup_album'
        events = (await s.scalars(select(Outbox))).all()
        assert all(e.published_at is not None for e in events)
        for event in events:
            event.published_at = None
        await s.commit()
        await dispatch_outbox(s, seeded['now'])
        assert await s.scalar(select(func.count()).select_from(Job)) == 1


async def test_heartbeat_uses_independent_session_while_adapter_waits(db, seeded, tmp_path):
    from backend.worker.runner import Runner, ResultStore
    from backend.tests.integration.crash_worker import CountingAdapter
    runner = Runner(db, ResultStore(tmp_path), CountingAdapter(tmp_path), lease_seconds=2, heartbeat_seconds=.05)
    running = asyncio.create_task(runner.run_once())
    try:
        await wait_marker(tmp_path/'barrier', type('P', (), {'returncode': None})())
        async with db() as s:
            first = (await s.get(Task, seeded['task'])).lease_until
        await asyncio.sleep(.2)
        async with db() as s:
            assert (await s.get(Task, seeded['task'])).lease_until > first
            # Acquiring album lock during adapter wait proves no external-call row lock.
            async with asyncio.timeout(1):
                await s.scalar(select(Album).where(Album.id == seeded['album']).with_for_update())
        (tmp_path/'release').touch()
        assert await running
    finally:
        running.cancel()
        await asyncio.gather(running, return_exceptions=True)


async def test_job_lease_recovery_rejects_old_fence(db, seeded):
    from backend.worker.jobs import claim_job, recover_jobs, finish_job, reserve_upload_validation
    async with db() as s:
        await reserve_upload_validation(s, seeded['upload'], seeded['now'])
    async with db() as a, db() as b:
        claims = await asyncio.gather(claim_job(a, seeded['now'], 1, ['validate_upload']), claim_job(b, seeded['now'], 1, ['validate_upload']))
        assert sum(c is not None for c in claims) == 1
    old = next(c for c in claims if c)
    async with db() as s:
        assert await recover_jobs(s, seeded['now']+timedelta(seconds=1)) == 1
        newer = await claim_job(s, seeded['now']+timedelta(seconds=2), 90, ['validate_upload'])
        assert newer.fence_version > old.fence_version
        assert not await finish_job(s, old, seeded['now']+timedelta(seconds=2))
        assert await finish_job(s, newer, seeded['now']+timedelta(seconds=2))


async def test_saved_result_checksum_mismatch_stays_unknown(db, seeded, tmp_path):
    from backend.worker.runner import Runner, ResultStore
    await crash_worker(db, seeded, tmp_path, 'saved')
    path = next((tmp_path/'attempts').glob('*.json'))
    path.write_text(path.read_text().replace('sha256', 'broken'))
    await Runner(db, ResultStore(tmp_path)).recover(seeded['now'])
    async with db() as s:
        assert (await s.get(Task, seeded['task'])).status == 'unknown'
        assert (await s.get(Page, seeded['page'])).caption_text is None
    assert (tmp_path/'calls').read_text() == 'call\n'


async def test_worker_entrypoint_sigterm(db, seeded, tmp_path):
    process = await asyncio.create_subprocess_exec(sys.executable, '-m', 'backend.worker', env={**os.environ, 'STORAGE_ROOT': str(tmp_path), 'WORKER_POLL_SECONDS': '.05'}, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        async with asyncio.timeout(5):
            while b'Worker DB recovery ready' not in await process.stderr.readline():
                assert process.returncode is None
        process.terminate()
        async with asyncio.timeout(5):
            output, errors = await process.communicate()
        assert process.returncode == 0
        assert b'Worker stopped safely' in errors
    finally:
        if process.returncode is None:
            process.kill(); await process.wait()


async def test_received_caption_in_db_recovers_without_file_or_ai(db, seeded, tmp_path):
    from backend.worker.runner import Runner, ResultStore
    from backend.generation.repository import claim_task
    runner = Runner(db, ResultStore(tmp_path))
    async with db() as s:
        claim = await claim_task(s, seeded['now'], 90)
    attempt_id, _, _ = await runner.prepare(claim)
    async with db() as s, s.begin():
        task = await s.get(Task, seeded['task']); task.lease_until = seeded['now']-timedelta(seconds=1)
        attempt = await s.get(Attempt, attempt_id); attempt.status = 'received'; attempt.dispatch_state = 'accepted_or_unknown'; attempt.output_caption = 'DB에 보존한 응답.'
    assert await runner.recover(seeded['now']) == 1
    async with db() as s:
        assert (await s.get(Page, seeded['page'])).caption_text == 'DB에 보존한 응답.'
        assert (await s.get(Task, seeded['task'])).status == 'succeeded'


async def test_unsent_recovery_stops_at_attempt_budget(db, seeded, tmp_path):
    from backend.worker.runner import Runner, ResultStore
    from backend.generation.repository import claim_task
    runner = Runner(db, ResultStore(tmp_path))
    async with db() as s:
        claim = await claim_task(s, seeded['now'], 90)
    attempt_id, _, _ = await runner.prepare(claim)
    async with db() as s, s.begin():
        task = await s.get(Task, seeded['task']); task.lease_until = seeded['now']-timedelta(seconds=1)
        task.attempt_count = 3
        (await s.get(Attempt, attempt_id)).attempt_no = 3
    await runner.recover(seeded['now'])
    async with db() as s:
        assert (await s.get(Task, seeded['task'])).status == 'failed'
        assert (await s.get(Run, seeded['run'])).status == 'action_required'
        assert (await s.get(Album, seeded['album'])).status == 'action_required'
