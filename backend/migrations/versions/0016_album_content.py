"""Incremental captions and immutable NFC session snapshots; no historical backfill."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision='0016_album_content'
down_revision='0015_nfc_viewing'
branch_labels=depends_on=None

def upgrade():
    op.add_column('albums',sa.Column('content_enabled',sa.Boolean(),nullable=False,server_default=sa.text('false')))
    op.add_column('albums',sa.Column('content_manifest',JSONB(),nullable=False,server_default=sa.text("'[]'::jsonb")))
    op.add_column('upload_sessions',sa.Column('replaces_page_id',sa.UUID(),sa.ForeignKey('album_pages.id')))
    op.add_column('nfc_viewing_sessions',sa.Column('pinned',sa.Boolean(),nullable=False,server_default=sa.text('false')))
    op.create_table('album_caption_jobs',
        sa.Column('id',sa.UUID(),primary_key=True),sa.Column('created_at',sa.DateTime(timezone=True),nullable=False,server_default=sa.text('now()')),
        sa.Column('album_id',sa.UUID(),sa.ForeignKey('albums.id'),nullable=False),
        sa.Column('page_id',sa.UUID(),sa.ForeignKey('album_pages.id'),nullable=False,unique=True),
        sa.Column('normalized_asset_id',sa.UUID(),sa.ForeignKey('media_assets.id'),nullable=False),
        sa.Column('input_sha256',sa.String(64),nullable=False),sa.Column('config_snapshot',JSONB(),nullable=False),
        sa.Column('status',sa.String(20),nullable=False),sa.Column('dispatch_state',sa.String(20),nullable=False),
        sa.Column('attempt_id',sa.UUID()),sa.Column('attempt_count',sa.Integer(),nullable=False),sa.Column('attempts',JSONB(),nullable=False),
        sa.Column('fence_version',sa.Integer(),nullable=False),sa.Column('lease_until',sa.DateTime(timezone=True)),
        sa.Column('next_retry_at',sa.DateTime(timezone=True)),sa.Column('error_code',sa.String(50)),
        sa.CheckConstraint("status IN ('queued','running','succeeded','failed','unknown','cancelled')"))
    op.create_index('ix_album_caption_jobs_album_id','album_caption_jobs',['album_id'])
    op.create_index('ix_album_caption_jobs_status','album_caption_jobs',['status'])

def downgrade():
    if op.get_bind().scalar(sa.text('SELECT EXISTS(SELECT 1 FROM albums WHERE content_enabled)')):
        raise RuntimeError('Managed content exists; refusing to discard its publication state')
    op.drop_table('album_caption_jobs')
    op.drop_column('nfc_viewing_sessions','pinned')
    op.drop_column('upload_sessions','replaces_page_id')
    op.drop_column('albums','content_manifest');op.drop_column('albums','content_enabled')
