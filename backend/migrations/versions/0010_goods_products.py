"""Preserve the selected product on completed goods designs."""
from alembic import op
import sqlalchemy as sa

revision = '0010_goods_products'
down_revision = '0009_goods_guests'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('goods_designs', sa.Column('product', sa.String(20), nullable=False, server_default='keyring'))
    op.create_check_constraint('ck_goods_design_product', 'goods_designs', "product IN ('keyring', 'magnet')")


def downgrade():
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT EXISTS (SELECT 1 FROM goods_designs WHERE product='magnet')")):
        raise RuntimeError('Magnet designs must be retired before removing product support')
    op.drop_constraint('ck_goods_design_product', 'goods_designs', type_='check')
    op.drop_column('goods_designs', 'product')
