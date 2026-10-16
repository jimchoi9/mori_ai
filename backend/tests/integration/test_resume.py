from uuid import uuid4
import pytest
from backend.models import Task, Run, Album


def test_unknown_allows_only_persisted_local_retry():
    from backend.generation.resume_policy import ResumeTask, eligible_resume_tasks
    local, missing, success, unknown = [uuid4() for _ in range(4)]
    tasks = [ResumeTask(local, 'failed', True, False, True), ResumeTask(missing, 'failed', True, False, False), ResumeTask(success, 'succeeded', True, False, True), ResumeTask(unknown, 'unknown', True, False, True)]
    assert eligible_resume_tasks(tasks, True) == [local]


def test_unknown_blocks_ai_retry():
    from backend.generation.resume_policy import ResumeTask, eligible_resume_tasks
    assert eligible_resume_tasks([ResumeTask(uuid4(), 'failed', True, True, True)], True) == []


def test_no_unknown_allows_safe_failed_retry():
    from backend.generation.resume_policy import ResumeTask, eligible_resume_tasks
    safe, unsafe = uuid4(), uuid4()
    assert eligible_resume_tasks([ResumeTask(safe, 'failed', True, True, True), ResumeTask(unsafe, 'failed', False, True, True)], False) == [safe]


@pytest.mark.asyncio
async def test_mixed_resume_keeps_action_required(db, seeded):
    from backend.generation.resume_policy import resume_failed_tasks
    async with db() as s, s.begin():
        run = await s.get(Run, seeded['run']); run.status = 'action_required'
        album = await s.get(Album, seeded['album']); album.status = 'action_required'
        task = await s.get(Task, seeded['task']); task.status = 'unknown'
        local = Task(run_id=run.id, page_id=seeded['page'], stage='image_transform', status='failed', safe_to_retry=True, requires_ai_call=False, has_persisted_input=True)
        ai = Task(run_id=run.id, page_id=seeded['page'], stage='optimize', status='failed', safe_to_retry=True, requires_ai_call=True, has_persisted_input=True)
        s.add_all([local, ai]); await s.flush(); local_id, ai_id = local.id, ai.id
    async with db() as s:
        assert await resume_failed_tasks(s, seeded['run']) == [local_id]
        assert (await s.get(Run, seeded['run'])).status == 'action_required'
        assert (await s.get(Album, seeded['album'])).status == 'action_required'
        assert (await s.get(Task, ai_id)).status == 'failed'
