"""Preserve existing titles; only application-created new albums opt in."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision='0020_album_titles'
down_revision='0019_photo_gps'
branch_labels=depends_on=None

def upgrade():
    op.add_column('albums',sa.Column('title_source',sa.String(12),nullable=False,server_default='legacy'))
    op.add_column('albums',sa.Column('title_seed',JSONB()))
    op.create_table('album_title_jobs',
        sa.Column('id',sa.UUID(),primary_key=True),
        sa.Column('created_at',sa.DateTime(timezone=True),nullable=False,server_default=sa.text('now()')),
        sa.Column('album_id',sa.UUID(),sa.ForeignKey('albums.id'),nullable=False,unique=True),
        sa.Column('config_snapshot',JSONB(),nullable=False),sa.Column('captions',JSONB(),nullable=False),
        sa.Column('status',sa.String(20),nullable=False),sa.Column('dispatch_state',sa.String(20),nullable=False),
        sa.Column('lease_until',sa.DateTime(timezone=True)),sa.Column('error_code',sa.String(50)),
        sa.CheckConstraint("status IN ('queued','running','succeeded','failed','unknown','cancelled')"))
    op.create_index('ix_album_title_jobs_status','album_title_jobs',['status'])

def downgrade():
    if op.get_bind().scalar(sa.text("SELECT EXISTS(SELECT 1 FROM albums WHERE title_source != 'legacy')")):
        raise RuntimeError('Album title provenance exists; refusing to discard it')
    op.drop_table('album_title_jobs')
    op.drop_column('albums','title_seed');op.drop_column('albums','title_source')
