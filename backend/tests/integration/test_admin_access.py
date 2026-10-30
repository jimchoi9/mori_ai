import asyncio
from datetime import datetime, timezone
from uuid import uuid4
import pytest
from sqlalchemy import select, func
from backend.models import User
from backend.http.errors import APIError
from backend.access import service

async def seed(db, count=2):
    async with db() as s,s.begin():
        rows=[User(display_name=f'User {i}') for i in range(count)]
        s.add_all(rows);await s.flush()
        return [u.id for u in rows]

async def grant(db, uid, value=True):
    async with db() as s,s.begin():
        return await service.set_admin_from_cli(s,uid,value)

@pytest.mark.asyncio
async def test_admin_grant_revoke_and_noop(db):
    a,b=await seed(db)
    await grant(db,a);await grant(db,b)
    await grant(db,a)
    async with db() as s:
        u=await s.get(User,a)
        assert u.is_admin and u.test_access_approved and u.access_version==1
    await grant(db,a,False)
    async with db() as s:
        u=await s.get(User,a)
        assert not u.is_admin and u.test_access_approved and u.access_version==2
    with pytest.raises(APIError) as e:await grant(db,b,False)
    assert e.value.code=='LAST_ADMIN_REQUIRED'

@pytest.mark.asyncio
async def test_last_admin_concurrent_revokes_leave_one(db):
    a,b=await seed(db);await grant(db,a);await grant(db,b)
    results=await asyncio.gather(grant(db,a,False),grant(db,b,False),return_exceptions=True)
    assert sum(isinstance(x,APIError) for x in results)==1
    async with db() as s:
        assert await s.scalar(select(func.count()).select_from(User).where(User.is_admin))==1

@pytest.mark.asyncio
async def test_approval_version_revoke_and_protection(db):
    a,b=await seed(db);await grant(db,a)
    async def change(target,value,version):
        async with db() as s,s.begin():
            return await service.change_approval(s,actor_id=a,target_id=target,approved=value,expected_version=version,source='web')
    await change(b,True,0)
    await change(b,True,1)
    with pytest.raises(APIError) as e:await change(b,False,0)
    assert e.value.code=='ACCESS_STATE_CONFLICT'
    with pytest.raises(APIError) as e:await change(a,False,1)
    assert e.value.code=='ADMIN_APPROVAL_REQUIRED'
    await change(b,False,1)
    async with db() as s:
        u=await s.get(User,b);assert not u.test_access_approved and u.access_version==2

@pytest.mark.asyncio
async def test_guest_deleted_and_missing_are_not_targets(db):
    a,b=await seed(db)
    async with db() as s,s.begin():
        (await s.get(User,a)).is_guest=True
        (await s.get(User,b)).deleted_at=datetime.now(timezone.utc)
    for uid in (a,b,uuid4()):
        with pytest.raises(APIError) as e:await grant(db,uid)
        assert e.value.status==404

@pytest.mark.asyncio
async def test_revoked_actor_and_rollback(db):
    a,b,c=await seed(db,3);await grant(db,a);await grant(db,b)
    await grant(db,a,False)
    async with db() as s,s.begin():
        with pytest.raises(APIError) as e:
            await service.change_approval(s,actor_id=a,target_id=c,approved=True,expected_version=0,source='web')
        assert e.value.status==403
    with pytest.raises(RuntimeError):
        async with db() as s,s.begin():
            await service.change_approval(s,actor_id=b,target_id=c,approved=True,expected_version=0,source='web')
            raise RuntimeError('rollback')
    async with db() as s:assert not (await s.get(User,c)).test_access_approved

@pytest.mark.asyncio
async def test_revoked_actor_cannot_approve_after_lock(db):
    a,b,c=await seed(db,3);await grant(db,a);await grant(db,b)
    checked=asyncio.Event()
    async with db() as s,s.begin():
        await service.set_admin_from_cli(s,a,False)
        async def attempt():
            async with db() as other,other.begin():
                # This initial lookup sees the old committed role. The mutation
                # must re-read it after waiting for the CLI's transaction lock.
                await service.require_admin(other,a)
                checked.set()
                await service.change_approval(other,actor_id=a,target_id=c,approved=True,expected_version=0,source='web')
        task=asyncio.create_task(attempt())
        await asyncio.wait_for(checked.wait(),timeout=5)
        assert not task.done()
    with pytest.raises(APIError) as e:await task
    assert e.value.code=='ADMIN_REQUIRED'
    async with db() as s:assert not (await s.get(User,c)).test_access_approved
