"""Separate tag-writing capabilities from short-lived anonymous viewing sessions."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision = '0015_nfc_viewing'
down_revision = '0014_album_purchase_access'
branch_labels = depends_on = None


def upgrade():
    op.create_table('goods_nfc_tags',
        sa.Column('id',sa.UUID(),primary_key=True),
        sa.Column('created_at',sa.DateTime(timezone=True),nullable=False,server_default=sa.text('now()')),
        sa.Column('purchase_id',sa.UUID(),sa.ForeignKey('goods_test_purchases.id'),nullable=False,unique=True),
        sa.Column('write_token',sa.String(80),nullable=False),
        sa.Column('token_hash',sa.String(64),nullable=False,unique=True),
        sa.Column('active',sa.Boolean(),nullable=False,server_default=sa.text('true')))
    op.create_table('nfc_viewing_sessions',
        sa.Column('token_hash',sa.String(64),primary_key=True),
        sa.Column('created_at',sa.DateTime(timezone=True),nullable=False,server_default=sa.text('now()')),
        sa.Column('tag_id',sa.UUID(),sa.ForeignKey('goods_nfc_tags.id'),nullable=False),
        sa.Column('album_version',sa.Integer(),nullable=False),
        sa.Column('asset_ids',JSONB(),nullable=False),
        sa.Column('expires_at',sa.DateTime(timezone=True),nullable=False),
        sa.Column('revoked',sa.Boolean(),nullable=False,server_default=sa.text('false')))

    op.create_index('ix_nfc_viewing_sessions_expires_at','nfc_viewing_sessions',['expires_at'])


def downgrade():
    if op.get_bind().scalar(sa.text('SELECT EXISTS (SELECT 1 FROM goods_nfc_tags)')):
        raise RuntimeError('NFC writing capabilities exist; refusing to discard live tags')
    op.drop_table('nfc_viewing_sessions')
    op.drop_table('goods_nfc_tags')
