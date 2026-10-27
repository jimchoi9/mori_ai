"""Close independent album admission while preserving existing album access."""
from alembic import op
import sqlalchemy as sa

revision = '0014_album_purchase_access'
down_revision = '0013_purchase_delivery'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('albums', sa.Column('legacy_access', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    # This one-time exception preserves pre-existing independent albums, not future rows.
    # Purchase albums keep deriving their grant from the receipt, including gift claims.
    op.execute('''UPDATE albums SET legacy_access = true
                  WHERE NOT EXISTS (SELECT 1 FROM goods_test_purchases p WHERE p.album_id = albums.id)''')


def downgrade():
    # An old app would allow free creation again. Do not silently erase live policy data.
    if op.get_bind().scalar(sa.text('SELECT EXISTS (SELECT 1 FROM albums)')):
        raise RuntimeError('Album access policy exists; refusing to discard it')
    op.drop_column('albums', 'legacy_access')
