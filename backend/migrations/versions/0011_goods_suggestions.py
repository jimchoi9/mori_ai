"""Private recommendation cache; financial receipts remain in the shared ledger."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0011_goods_suggestions'
down_revision = '0010_goods_products'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'goods_suggestion_batches',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('owner_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('work_id', sa.Uuid(), sa.ForeignKey('goods_work.id', ondelete='CASCADE'), nullable=False),
        sa.Column('context_hash', sa.String(64), nullable=False),
        sa.Column('image_ref', sa.String(80), nullable=False),
        sa.Column('batch', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('items', postgresql.JSONB()),
        sa.Column('visual_summary', sa.Text()),
        sa.UniqueConstraint('owner_id', 'context_hash', 'batch'),
        sa.CheckConstraint('batch >= 0 AND batch <= 3'),
        sa.CheckConstraint("status IN ('pending','ready','fallback')"),
    )
    op.create_index('ix_goods_suggestion_batches_owner_id', 'goods_suggestion_batches', ['owner_id'])
    op.create_index('ix_goods_suggestion_batches_work_id', 'goods_suggestion_batches', ['work_id'])


def downgrade():
    op.drop_table('goods_suggestion_batches')
