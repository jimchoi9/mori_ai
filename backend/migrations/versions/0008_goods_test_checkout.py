"""Isolated test receipts and their automatically provisioned albums."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '0008_goods_test_checkout'
down_revision = '0007_upload_pairs'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('goods_test_purchases',
        sa.Column('id', sa.UUID(), primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('owner_id', sa.UUID(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('design_id', sa.UUID(), sa.ForeignKey('goods_designs.id'), nullable=False, unique=True),
        sa.Column('album_id', sa.UUID(), sa.ForeignKey('albums.id'), nullable=False, unique=True),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('design_snapshot', JSONB(), nullable=False),
        sa.CheckConstraint("status = 'simulated'"))
    op.create_index('ix_goods_test_purchases_owner_id', 'goods_test_purchases', ['owner_id'])


def downgrade():
    op.drop_table('goods_test_purchases')
