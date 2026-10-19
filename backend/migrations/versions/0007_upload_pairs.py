"""Add optional paired upload fields; existing rows/snapshots are unchanged."""
from alembic import op
import sqlalchemy as sa
revision = '0007_upload_pairs'
down_revision = '0006_test_access'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('album_pages', sa.Column('input_width', sa.Integer(), nullable=True))
    op.add_column('album_pages', sa.Column('input_height', sa.Integer(), nullable=True))
    op.add_column('upload_sessions', sa.Column('thumbnail_asset_id', sa.UUID(), nullable=True))
    op.add_column('upload_sessions', sa.Column('thumbnail_declared_bytes', sa.BigInteger(), nullable=True))
    op.create_foreign_key('fk_upload_thumbnail', 'upload_sessions', 'media_assets', ['thumbnail_asset_id'], ['id'])

def downgrade():
    op.drop_constraint('fk_upload_thumbnail', 'upload_sessions', type_='foreignkey')
    op.drop_column('upload_sessions', 'thumbnail_declared_bytes')
    op.drop_column('upload_sessions', 'thumbnail_asset_id')
    op.drop_column('album_pages', 'input_height')
    op.drop_column('album_pages', 'input_width')
