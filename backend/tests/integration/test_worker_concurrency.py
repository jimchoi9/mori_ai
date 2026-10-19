import asyncio
from datetime import timedelta
import pytest
from sqlalchemy import select
from backend.models import Task, Page, Run
from backend.generation.repository import claim_task


async def add_tasks(db, seeded, stage, count, config=None):
    async with db() as s, s.begin():
        original = await s.get(Task, seeded['task'])
        original.stage = stage
        run = await s.get(Run, seeded['run'])
        if config is not None: run.config_snapshot = config
        for index in range(2, count+1):
            page = Page(album_id=seeded['album'], position=index, selection_index=index); s.add(page); await s.flush()
            s.add(Task(run_id=run.id, page_id=page.id, stage=stage))


@pytest.mark.asyncio
@pytest.mark.parametrize('stage,cap', [('caption',4), ('image_transform',2)])
async def test_simultaneous_claims_respect_global_stage_cap(db, seeded, stage, cap):
    await add_tasks(db, seeded, stage, 12, {'image_concurrency':4})
    async def claim():
        async with db() as s:
            return await claim_task(s, seeded['now'], 90, stage=stage)
    claims = await asyncio.wait_for(asyncio.gather(*(claim() for _ in range(12))), 5)
    assert sum(x is not None for x in claims) == cap
    assert len({x.task_id for x in claims if x}) == cap


@pytest.mark.asyncio
async def test_snapshot_cap_stage_filter_and_expired_slot(db, seeded):
    await add_tasks(db, seeded, 'caption', 5, {'caption_concurrency':1})
    async with db() as s:
        assert await claim_task(s, seeded['now'], 90, stage='image_transform') is None
        first = await claim_task(s, seeded['now'], 90, stage='caption')
        assert first
        assert await claim_task(s, seeded['now'], 90, stage='caption') is None
    async with db() as s, s.begin():
        (await s.get(Task, first.task_id)).lease_until = seeded['now']-timedelta(seconds=1)
    async with db() as s:
        assert await claim_task(s, seeded['now'], 90, stage='caption')


@pytest.mark.asyncio
async def test_optimize_dependency_and_global_limit(db, seeded):
    await add_tasks(db, seeded, 'optimize', 3)
    async with db() as s:
        assert await claim_task(s, seeded['now'], 90, stage='optimize') is None
    async with db() as s, s.begin():
        tasks = list(await s.scalars(select(Task)))
        for task in tasks:
            s.add(Task(run_id=task.run_id, page_id=task.page_id, stage='image_transform', status='succeeded'))
    async def claim():
        async with db() as s:
            return await claim_task(s, seeded['now'], 90, stage='optimize')
    claims = await asyncio.gather(*(claim() for _ in range(3)))
    assert sum(x is not None for x in claims) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('stage,setting', [('caption','caption_concurrency'),('image_transform','image_concurrency')])
async def test_caps_are_global_across_runs_and_execution_modes(db, seeded, stage, setting):
    from backend.models import Album
    await add_tasks(db, seeded, stage, 5, {setting:2, 'execution_mode':'first'})
    async with db() as s, s.begin():
        album = await s.get(Album, seeded['album'])
        other = Album(owner_id=album.owner_id, status='processing'); s.add(other); await s.flush()
        run = Run(album_id=other.id, config_snapshot={setting:4, 'execution_mode':'second'})
        s.add(run); await s.flush()
        for index in range(1,6):
            page = Page(album_id=other.id, position=index, selection_index=index)
            s.add(page); await s.flush()
            s.add(Task(run_id=run.id, page_id=page.id, stage=stage))
    async def claim(mode):
        async with db() as s:
            return await claim_task(s, seeded['now'], 90, stage=stage, execution_mode=mode)
    first = await asyncio.gather(*(claim('first') for _ in range(5)))
    second = await asyncio.gather(*(claim('second') for _ in range(5)))
    assert sum(c is not None for c in first) == 2
    assert sum(c is not None for c in second) == (2 if stage == 'caption' else 0)


@pytest.mark.asyncio
@pytest.mark.parametrize('stage,cap', [('caption',4), ('image_transform',2)])
async def test_runner_shutdown_preserves_unknown_boundary_and_recovery(db, seeded, tmp_path, stage, cap):
    from backend.worker.runner import Runner, ResultStore, utcnow
    from backend.models import Attempt
    await add_tasks(db, seeded, stage, 5, {'image_concurrency':4})
    entered = asyncio.Event()
    active = 0
    class Adapter:
        async def execute(self, attempt_id, stage):
            nonlocal active
            active += 1
            if active == cap: entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                active -= 1
    runner = Runner(db, ResultStore(tmp_path), Adapter(), heartbeat_seconds=.02)
    async def lane():
        while not await runner.run_once(stage=stage):
            await asyncio.sleep(.005)
    work = [asyncio.create_task(lane()) for _ in range(cap)]
    try:
        await asyncio.wait_for(entered.wait(), 5)
        assert active == cap
    finally:
        for task in work: task.cancel()
        await asyncio.gather(*work, return_exceptions=True)
    assert active == 0
    async with db() as s, s.begin():
        tasks = list(await s.scalars(select(Task).where(Task.status == 'running')))
        assert len(tasks) == cap
        for task in tasks: task.lease_until = utcnow()-timedelta(seconds=1)
    await runner.recover()
    async with db() as s:
        tasks = list(await s.scalars(select(Task).where(Task.status == 'unknown')))
        assert len(tasks) == cap
        assert all(not task.safe_to_retry for task in tasks)
        assert len(list(await s.scalars(select(Attempt)))) == cap
    assert not await runner.run_once(stage=stage)


@pytest.mark.asyncio
async def test_recovery_settles_saved_result_without_waiting_for_execution_slot(db, seeded, tmp_path):
    from backend.worker.runner import Runner, ResultStore, utcnow
    await add_tasks(db, seeded, 'caption', 5)
    runner = Runner(db, ResultStore(tmp_path))
    async with db() as s:
        first = await claim_task(s, utcnow(), 90, stage='caption')
    attempt_id, _, _ = await runner.prepare(first)
    await runner.store.save(str(attempt_id), {'caption':'보존된 문장'})
    async with db() as s, s.begin():
        (await s.get(Task, first.task_id)).lease_until = utcnow()-timedelta(seconds=1)
    claims = []
    for _ in range(4):
        async with db() as s:
            claims.append(await claim_task(s, utcnow(), 90, stage='caption'))
    assert all(claims)
    assert await runner.recover() == 1
    async with db() as s:
        assert (await s.get(Task, first.task_id)).status == 'succeeded'
        assert len(list(await s.scalars(select(Task).where(Task.status == 'running')))) == 4


@pytest.mark.asyncio
@pytest.mark.parametrize('config,cap', [({},2), ({'image_concurrency':1},1), ({'image_concurrency':2},2), ({'image_concurrency':4},2)])
async def test_image_snapshot_legacy_default_is_independent_of_global_cap(db, seeded, config, cap):
    await add_tasks(db, seeded, 'image_transform', 8, config)
    claims = []
    for _ in range(8):
        async with db() as s:
            claims.append(await claim_task(s, seeded['now'], 90, stage='image_transform'))
    assert sum(c is not None for c in claims) == cap
    async with db() as s:
        assert (await s.get(Run, seeded['run'])).config_snapshot == config


@pytest.mark.asyncio
async def test_new_snapshot_admits_two_images(db, seeded):
    from backend.generation.service import config_snapshot
    from backend.settings import Settings
    settings = Settings(database_url='postgresql+asyncpg://mori:local@postgres/mori_workflow_test')
    snapshot = config_snapshot(settings)
    assert snapshot['image_concurrency'] == 2
    assert snapshot['caption_concurrency'] == 4
    await add_tasks(db, seeded, 'image_transform', 6, snapshot)
    claims = []
    for _ in range(6):
        async with db() as s:
            claims.append(await claim_task(s, seeded['now'], 90, stage='image_transform'))
    assert sum(c is not None for c in claims) == 2


@pytest.mark.asyncio
async def test_goods_album_claim_race_shares_two_slots_and_cancel_does_not_redispatch(db, seeded, tmp_path):
    from backend.models import Album, GoodsWork, GoodsRevision, Attempt
    from backend.goods_design.worker import GoodsWorker
    from backend.tests.integration.test_auth_http import config
    from backend.storage.local import LocalStorage
    from backend.worker.runner import Runner, ResultStore, utcnow
    await add_tasks(db, seeded, 'image_transform', 12, {'image_concurrency':4})
    store = LocalStorage(tmp_path / 'media')
    async with db() as s, s.begin():
        owner = (await s.get(Album, seeded['album'])).owner_id
        for index in range(8):
            work = GoodsWork(owner_id=owner, expires_at=utcnow()+timedelta(hours=1))
            s.add(work); await s.flush()
            work.source_key=f'{owner}/{work.id}/{work.id}/source'
            store.write(work.source_key,b'fixture')
            s.add(GoodsRevision(work_id=work.id, request_key=str(index), request_hash='x',
                style='photo', message='x', prompt='x', config={'mode':'real','model':'test'}))
    active=0; peak=0; entered=asyncio.Event(); album_calls=[]; goods_calls=[]
    async def block():
        nonlocal active, peak
        active+=1; peak=max(peak,active)
        if active==2: entered.set()
        try: await asyncio.Event().wait()
        finally: active-=1
    class Adapter:
        async def execute(self, attempt_id, stage):
            album_calls.append(attempt_id)
            await block()
    class Provider:
        async def generate(self, *args):
            goods_calls.append(1)
            await block()
    runner=Runner(db,ResultStore(tmp_path/'receipts'),Adapter())
    goods=GoodsWorker(db,store,config(ai_real_calls_enabled=True,openai_api_key='test'),Provider())
    # Reserve one goods call, then race both products for the remaining slots.
    workers=[asyncio.create_task(goods.run_once())]
    try:
        async with asyncio.timeout(10):
            while not goods_calls: await asyncio.sleep(.01)
        workers += [asyncio.create_task(runner.run_once(stage='image_transform')) for _ in range(8)]
        workers += [asyncio.create_task(goods.run_once()) for _ in range(8)]
        await asyncio.wait_for(entered.wait(),10)
        await asyncio.sleep(.2)
        assert peak==active==2
        async with db() as s:
            tasks=list(await s.scalars(select(Task).where(Task.status=='running')))
            revisions=list(await s.scalars(select(GoodsRevision).where(GoodsRevision.status=='running')))
            assert len(tasks)+len(revisions)==2
            attempts=list(await s.scalars(select(Attempt)))
            assert len(attempts)==len({a.task_id for a in attempts})==len(album_calls)
    finally:
        for worker in workers: worker.cancel()
        await asyncio.gather(*workers,return_exceptions=True)
    assert active==0
    # Cancelled callers retain leases: neither product may dispatch another call.
    assert not await runner.run_once(stage='image_transform')
    assert not await goods.run_once()
    async with db() as s, s.begin():
        for task in await s.scalars(select(Task).where(Task.status=='running')):
            task.lease_until=utcnow()-timedelta(seconds=1)
        for revision in await s.scalars(select(GoodsRevision).where(GoodsRevision.status=='running')):
            revision.lease_until=utcnow()-timedelta(seconds=1)
    await runner.recover(); await goods.maintenance()
    async with db() as s:
        assert len(list(await s.scalars(select(Task).where(Task.status=='unknown'))))==len(album_calls)
        assert len(list(await s.scalars(select(GoodsRevision).where(GoodsRevision.status=='unknown'))))==len(goods_calls)


@pytest.mark.asyncio
async def test_image_retry_wait_releases_capacity_and_respects_backoff(db, seeded):
    await add_tasks(db, seeded, 'image_transform', 6, {'image_concurrency':4})
    claims=[]
    for _ in range(2):
        async with db() as s:
            claims.append(await claim_task(s,seeded['now'],90,stage='image_transform'))
    async with db() as s:
        assert await claim_task(s,seeded['now'],90,stage='image_transform') is None
    async with db() as s,s.begin():
        task=await s.get(Task,claims[0].task_id)
        task.status='retry_wait'; task.lease_until=None
        task.next_retry_at=seeded['now']+timedelta(seconds=30)
        for task in await s.scalars(select(Task).where(Task.status=='queued')):
            task.status='cancelled'
    async with db() as s:
        assert await claim_task(s,seeded['now'],90,stage='image_transform') is None
        retry=await claim_task(s,seeded['now']+timedelta(seconds=31),90,stage='image_transform')
        assert retry.task_id==claims[0].task_id
        assert retry.fence_version==claims[0].fence_version+1


@pytest.mark.asyncio
async def test_legacy_new_and_goods_share_two_slots_and_release_capacity(db, seeded):
    from backend.models import Album, GoodsWork, GoodsRevision
    await add_tasks(db, seeded, 'image_transform', 6, {'execution_mode':'legacy'})
    async with db() as s,s.begin():
        owner=(await s.get(Album,seeded['album'])).owner_id
        other=Album(owner_id=owner,status='processing');s.add(other);await s.flush()
        new=Run(album_id=other.id,config_snapshot={'execution_mode':'new','image_concurrency':4})
        s.add(new);await s.flush()
        for index in range(1,7):
            page=Page(album_id=other.id,position=index,selection_index=index);s.add(page);await s.flush()
            s.add(Task(run_id=new.id,page_id=page.id,stage='image_transform'))
        work=GoodsWork(owner_id=owner,expires_at=seeded['now']+timedelta(hours=1))
        s.add(work);await s.flush()
        revision=GoodsRevision(work_id=work.id,request_key='g',request_hash='g',style='photo',
            message='x',prompt='x',config={},status='running',lease_until=seeded['now']+timedelta(minutes=5))
        s.add(revision);await s.flush();rid=revision.id
    async def claim(mode):
        async with db() as s:
            return await claim_task(s,seeded['now'],90,stage='image_transform',execution_mode=mode)
    legacy=await asyncio.gather(*(claim('legacy') for _ in range(6)))
    new=await asyncio.gather(*(claim('new') for _ in range(6)))
    assert sum(c is not None for c in legacy)==1
    assert sum(c is not None for c in new)==0
    assert len({c.task_id for c in legacy+new if c})==1
    async with db() as s,s.begin():
        revision=await s.get(GoodsRevision,rid)
        revision.status='cancelled';revision.lease_until=None
    assert await claim('new') is not None
    assert await claim('legacy') is None
    assert await claim('new') is None
    async with db() as s:
        assert len(list(await s.scalars(select(Task).where(Task.status=='running'))))==2
        assert (await s.get(Run,seeded['run'])).config_snapshot=={'execution_mode':'legacy'}


@pytest.mark.asyncio
@pytest.mark.parametrize('entrant', ['album', 'goods'])
async def test_reduced_cap_preserves_four_running_leases_until_capacity_drains(db, seeded, tmp_path, entrant):
    """Frozen four-slot runs survive reduction; only new admissions see cap two."""
    from backend.models import Album, GoodsWork, GoodsRevision
    from backend.goods_design.worker import GoodsWorker
    from backend.tests.integration.test_auth_http import config
    from backend.storage.local import LocalStorage
    from backend.worker.runner import utcnow

    frozen = {'image_concurrency': 4, 'caption_concurrency': 4}
    await add_tasks(db, seeded, 'image_transform', 6, frozen)
    stamp = utcnow()
    store = LocalStorage(tmp_path / 'media')
    async with db() as s, s.begin():
        tasks = list(await s.scalars(select(Task).order_by(Task.id)))
        running_ids = [task.id for task in tasks[:4]]
        for task in tasks[:4]:
            task.status = 'running'
            task.lease_until = stamp + timedelta(minutes=5)
            task.fence_version = 7
            task.attempt_count = 1
        owner = (await s.get(Album, seeded['album'])).owner_id
        work = GoodsWork(owner_id=owner, expires_at=stamp+timedelta(hours=1))
        s.add(work); await s.flush()
        work.source_key = f'{owner}/{work.id}/{work.id}/source'
        store.write(work.source_key, b'fixture')
        revision = GoodsRevision(work_id=work.id, request_key='reduced-cap', request_hash='x',
            style='photo', message='x', prompt='x', config={'mode':'real','model':'test'})
        s.add(revision); await s.flush()
        revision_id = revision.id

    entered = asyncio.Event()
    class Provider:
        async def generate(self, *args):
            entered.set()
            await asyncio.Event().wait()
    goods = GoodsWorker(db, store, config(ai_real_calls_enabled=True, openai_api_key='test'), Provider())

    async def album_claim():
        async with db() as s:
            return await claim_task(s, stamp, 90, stage='image_transform')

    # While four, three, or two existing leases remain, neither product may
    # claim. Claim attempts must not revoke leases, change fences or backfill.
    for remaining in (4, 3, 2):
        assert await album_claim() is None
        assert not await goods.run_once()
        assert not entered.is_set()
        async with db() as s, s.begin():
            assert (await s.get(Run, seeded['run'])).config_snapshot == frozen
            assert (await s.get(GoodsRevision, revision_id)).status == 'queued'
            active_ids = running_ids[4-remaining:]
            for task_id in active_ids:
                task = await s.get(Task, task_id)
                assert (task.status, task.fence_version, task.attempt_count, task.lease_until) == (
                    'running', 7, 1, stamp+timedelta(minutes=5))
            # Model one pre-existing call finishing normally between admissions.
            completed = await s.get(Task, active_ids[0])
            completed.status = 'succeeded'; completed.lease_until = None

    pending = None
    try:
        if entrant == 'album':
            claim = await album_claim()
            assert claim is not None and claim.task_id not in running_ids
        else:
            pending = asyncio.create_task(goods.run_once())
            await asyncio.wait_for(entered.wait(), 5)
        assert await album_claim() is None
        assert not await goods.run_once()
        async with db() as s:
            survivor = await s.get(Task, running_ids[-1])
            assert (survivor.status, survivor.fence_version, survivor.attempt_count) == ('running', 7, 1)
            assert survivor.lease_until == stamp+timedelta(minutes=5)
            assert (await s.get(Run, seeded['run'])).config_snapshot == frozen
            album_active = list(await s.scalars(select(Task).where(Task.status == 'running')))
            goods_active = list(await s.scalars(select(GoodsRevision).where(GoodsRevision.status == 'running')))
            assert len(album_active)+len(goods_active) == 2
    finally:
        if pending is not None:
            pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)
