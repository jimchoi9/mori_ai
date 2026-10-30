"""Run the real CLI against the disposable DB; never selects an operational database."""
import asyncio
import sys
import pytest
from backend.models import User


async def cli(*args):
    process = await asyncio.create_subprocess_exec(sys.executable, '-m', 'backend.access', *map(str,args),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=20)
    return process.returncode, stdout.decode(), stderr.decode()


@pytest.mark.asyncio
async def test_cli_admin_and_existing_approval_commands(db):
    async with db() as session, session.begin():
        users = [User(display_name='CLI tester') for _ in range(3)]
        session.add_all(users)
        await session.flush()
        first, second, target = [user.id for user in users]
    for uid in (first, second):
        code, out, err = await cli('admin-grant',uid)
        assert code == 0, err
        assert str(uid) in out
    code, out, err = await cli('admin-list')
    assert code == 0 and str(first) in out and str(second) in out and str(target) not in out
    code, out, err = await cli('revoke',first)
    assert code == 1 and 'ADMIN_APPROVAL_REQUIRED' in err
    assert (await cli('admin-revoke',first))[0] == 0
    async with db() as session:
        user = await session.get(User,first)
        assert not user.is_admin and user.test_access_approved
    code, out, err = await cli('admin-revoke',second)
    assert code == 1 and 'LAST_ADMIN_REQUIRED' in err
    for command in ('approve','revoke'):
        assert (await cli(command,target))[0] == 0
        async with db() as session:
            assert (await session.get(User,target)).test_access_approved == (command == 'approve')
    code, out, err = await cli('list')
    assert code == 0 and str(target) in out
