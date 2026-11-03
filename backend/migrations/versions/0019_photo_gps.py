"""Private capture coordinates, independent of capture time and rendered media."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0019_photo_gps'
down_revision = '0018_manual_order'
branch_labels = depends_on = None


def upgrade():
    op.add_column('album_pages', sa.Column('photo_gps', postgresql.JSONB(), nullable=True))


def downgrade():
    if op.get_bind().scalar(sa.text('SELECT EXISTS (SELECT 1 FROM album_pages WHERE photo_gps IS NOT NULL)')):
        raise RuntimeError('Photo location hints exist; downgrade would discard them.')
    op.drop_column('album_pages', 'photo_gps')
