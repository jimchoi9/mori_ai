"""Server-managed administrators; preserve existing access approvals."""
from alembic import op
import sqlalchemy as sa
revision = '0017_admin_access'
down_revision = '0016_album_content'
branch_labels = depends_on = None


def upgrade():
    op.add_column('users', sa.Column('is_admin', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.add_column('users', sa.Column('access_version', sa.Integer(), nullable=False, server_default=sa.text('0')))


def downgrade():
    if op.get_bind().scalar(sa.text('SELECT EXISTS (SELECT 1 FROM users WHERE is_admin)')):
        raise RuntimeError('Administrator data exists; downgrade would remove administrator access.')
    op.drop_column('users', 'access_version')
    op.drop_column('users', 'is_admin')
