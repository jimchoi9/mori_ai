"""Mark isolated guest principals; existing accounts remain members."""
from alembic import op
import sqlalchemy as sa

revision = '0009_goods_guests'
down_revision = '0008_goods_test_checkout'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('is_guest', sa.Boolean(), nullable=False, server_default=sa.text('false')))


def downgrade():
    # Never promote temporary principals to members on a live downgrade.
    connection = op.get_bind()
    if connection.scalar(sa.text('SELECT EXISTS (SELECT 1 FROM users WHERE is_guest)')):
        raise RuntimeError('Guest data must be retired before downgrading guest support')
    op.drop_column('users', 'is_guest')
