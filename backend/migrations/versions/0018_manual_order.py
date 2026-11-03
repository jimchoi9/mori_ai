"""Keep the last explicit arrangement independently of the active sort mode."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
revision = '0018_manual_order'
down_revision = '0017_admin_access'
branch_labels = depends_on = None

def upgrade():
    op.add_column('albums', sa.Column('manual_page_order', postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")))

def downgrade():
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM albums WHERE manual_page_order <> '[]'::jsonb)")):
        raise RuntimeError('Saved manual arrangements exist; downgrade would discard them.')
    op.drop_column('albums', 'manual_page_order')
