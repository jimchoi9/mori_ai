"""Exercise migration against a pre-existing approved account in the disposable DB."""
import importlib
from uuid import uuid4
import pytest
from sqlalchemy import text
from alembic.migration import MigrationContext
from alembic.operations import Operations
from backend.models import User


def migrate(sync_session, direction):
    migration = importlib.import_module('backend.migrations.versions.0017_admin_access')
    with Operations.context(MigrationContext.configure(sync_session.connection())):
        getattr(migration, direction)()


@pytest.mark.asyncio
async def test_existing_approval_survives_upgrade_and_admin_blocks_downgrade(db):
    user_id = uuid4()
    async with db() as session, session.begin():
        await session.run_sync(migrate, 'downgrade')
        await session.execute(text("INSERT INTO users (id, display_name, test_access_approved) "
                                   "VALUES (:id, 'existing tester', true)"), {'id': user_id})
        await session.run_sync(migrate, 'upgrade')
        user = await session.get(User, user_id)
        assert user.test_access_approved and not user.is_admin and user.access_version == 0
        user.is_admin = True
        await session.flush()
        with pytest.raises(RuntimeError, match='Administrator data exists'):
            await session.run_sync(migrate, 'downgrade')
