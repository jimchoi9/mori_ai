from types import SimpleNamespace
import pytest
from backend.models import User
from backend.access import local_seed


def settings(**changes):
    return SimpleNamespace(**({'app_env':'local','dev_auth_enabled':True,'storage_mode':'local',
        'ai_real_calls_enabled':False,'database_url':'postgresql+asyncpg://local@postgres/mori_admin_local'}|changes))


def test_seed_rejects_other_environments():
    local_seed.validate_environment(settings())
    for changes in ({'app_env':'production'},{'dev_auth_enabled':False},{'storage_mode':'r2'},
                    {'ai_real_calls_enabled':True},{'database_url':'postgresql://local@postgres/mori'}):
        with pytest.raises(ValueError):local_seed.validate_environment(settings(**changes))


@pytest.mark.asyncio
async def test_seed_is_repeatable_without_resetting_user_approval(db):
    first=await local_seed.seed_accounts(db)
    async with db() as s,s.begin():
        alpha=await s.get(User,first['alpha']);beta=await s.get(User,first['beta'])
        assert alpha.is_admin and alpha.test_access_approved
        assert not beta.is_admin and not beta.test_access_approved
        beta.test_access_approved=True
    assert await local_seed.seed_accounts(db)==first
    async with db() as s:
        assert (await s.get(User,first['beta'])).test_access_approved
        assert (await s.get(User,first['alpha'])).access_version==1
