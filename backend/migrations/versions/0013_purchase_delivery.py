"""Purchase delivery outbox; existing purchases are not automatically mailed."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '0013_purchase_delivery'
down_revision = '0012_member_suggestions'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('albums', sa.Column('management_pending', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.add_column('goods_test_purchases', sa.Column('gift', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.add_column('goods_test_purchases', sa.Column('gift_token', sa.Text()))
    op.add_column('goods_test_purchases', sa.Column('gift_token_hash', sa.String(64)))
    op.add_column('goods_test_purchases', sa.Column('claimed_by', sa.UUID(), sa.ForeignKey('users.id', name='fk_goods_gift_claimed_by')))
    op.add_column('goods_test_purchases', sa.Column('claimed_at', sa.DateTime(timezone=True)))
    op.create_table('goods_purchase_deliveries',
        sa.Column('purchase_id', sa.UUID(), sa.ForeignKey('goods_test_purchases.id'), primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('status', sa.String(30), nullable=False),
        sa.Column('attempt_count', sa.Integer(), nullable=False),
        sa.Column('last_error', sa.String(50)),
        sa.Column('manifest', JSONB()),
        sa.Column('lease_until', sa.DateTime(timezone=True)),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.CheckConstraint("status IN ('pending','waiting_configuration','preparing','sending','accepted','failed','unknown','not_requested')", name='ck_goods_delivery_status'),
        sa.CheckConstraint('attempt_count >= 0', name='ck_goods_delivery_attempt_count'))

    op.create_table('goods_delivery_attempts',
        sa.Column('id', sa.UUID(), primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('purchase_id', sa.UUID(), sa.ForeignKey('goods_purchase_deliveries.purchase_id'), nullable=False),
        sa.Column('number', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('payload', JSONB(), nullable=False),
        sa.Column('provider_id', sa.String(200)),
        sa.Column('error_code', sa.String(50)),
        sa.Column('first_dispatched_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True)),
        sa.UniqueConstraint('purchase_id', 'number'),
        sa.CheckConstraint("status IN ('sending','accepted','failed','unknown')", name='ck_goods_mail_attempt_status'))
    op.create_index('ix_goods_delivery_attempts_purchase_id', 'goods_delivery_attempts', ['purchase_id'])


def downgrade():
    if op.get_bind().scalar(sa.text('SELECT EXISTS (SELECT 1 FROM goods_purchase_deliveries) OR EXISTS (SELECT 1 FROM goods_test_purchases WHERE gift) OR EXISTS (SELECT 1 FROM albums WHERE management_pending)')):
        raise RuntimeError('Purchase delivery history exists; refusing to discard it')
    op.drop_table('goods_delivery_attempts')
    op.drop_table('goods_purchase_deliveries')
    for name in ('claimed_at','claimed_by','gift_token_hash','gift_token','gift'):
        op.drop_column('goods_test_purchases', name)
    op.drop_column('albums', 'management_pending')
