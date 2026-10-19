"""Explicit private-test approval; existing accounts are not auto-approved."""
from alembic import op
import sqlalchemy as sa
revision = '0006_test_access'
down_revision = '0005_goods_design'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('users', sa.Column('test_access_approved', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('users', sa.Column('test_access_changed_at', sa.DateTime(timezone=True), nullable=True))

def downgrade():
    op.drop_column('users', 'test_access_changed_at')
    op.drop_column('users', 'test_access_approved')
