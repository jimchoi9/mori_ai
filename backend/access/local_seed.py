"""Bootstrap synthetic accounts only in the dedicated admin-local database."""
import asyncio
from sqlalchemy.engine import make_url
from backend.access.service import set_admin_from_cli
from backend.auth.repository import synthetic_user
from backend.database import session_factory
from backend.settings import Settings


def validate_environment(settings):
    url = make_url(settings.database_url)
    if (settings.app_env != 'local' or not settings.dev_auth_enabled
            or settings.storage_mode != 'local' or settings.ai_real_calls_enabled
            or url.database != 'mori_admin_local' or url.host != 'postgres'):
        raise ValueError('Bootstrap requires the isolated admin-local environment; use scripts/admin-local.sh up.')


async def seed_accounts(factory):
    async with factory() as session, session.begin():
        alpha = await synthetic_user(session, 'alpha')
        beta = await synthetic_user(session, 'beta')
        if alpha is None or beta is None:
            raise ValueError('A development account was deleted; it will not be restored automatically.')
        await set_admin_from_cli(session, alpha.id, True)
        return {'alpha': alpha.id, 'beta': beta.id}


async def main():
    settings = Settings()
    validate_environment(settings)
    factory = session_factory(settings.database_url)
    try:
        accounts = await seed_accounts(factory)
        for name, user_id in accounts.items():
            print(f'{name}: {user_id}')
    finally:
        await factory.kw['bind'].dispose()


if __name__ == '__main__':
    asyncio.run(main())
