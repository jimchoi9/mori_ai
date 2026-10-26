"""Allow authenticated members to request further recommendation batches."""
from alembic import op
import sqlalchemy as sa

revision = '0012_member_suggestions'
down_revision = '0011_goods_suggestions'
branch_labels = None
depends_on = None


def upgrade():
    checks = sa.inspect(op.get_bind()).get_check_constraints('goods_suggestion_batches')
    for check in checks:
        if 'batch' in check['sqltext'] and '<=' in check['sqltext']:
            op.drop_constraint(check['name'], 'goods_suggestion_batches', type_='check')
    op.create_check_constraint('ck_goods_suggestions_batch_nonnegative', 'goods_suggestion_batches', 'batch >= 0')


def downgrade():
    if op.get_bind().scalar(sa.text('SELECT EXISTS (SELECT 1 FROM goods_suggestion_batches WHERE batch > 3)')):
        raise RuntimeError('Extended member batches exist; cannot restore the guest-only batch constraint')
    op.drop_constraint('ck_goods_suggestions_batch_nonnegative', 'goods_suggestion_batches', type_='check')
    op.create_check_constraint('goods_suggestion_batches_batch_check', 'goods_suggestion_batches', 'batch >= 0 AND batch <= 3')
