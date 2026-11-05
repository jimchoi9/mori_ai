"""Ordinary albums opt into the existing anonymous viewer without fake purchases."""
from alembic import op
import sqlalchemy as sa

revision = '0021_album_viewing_links'
down_revision = '0020_album_titles'
branch_labels = depends_on = None


def upgrade():
    op.add_column('goods_nfc_tags', sa.Column('album_id', sa.UUID(), nullable=True))
    op.create_foreign_key('fk_goods_nfc_tags_album', 'goods_nfc_tags', 'albums', ['album_id'], ['id'])
    op.create_unique_constraint('uq_goods_nfc_tags_album_id', 'goods_nfc_tags', ['album_id'])
    op.alter_column('goods_nfc_tags', 'purchase_id', existing_type=sa.UUID(), nullable=True)
    op.create_check_constraint('ck_viewing_tag_target', 'goods_nfc_tags', '(purchase_id IS NULL) <> (album_id IS NULL)')


def downgrade():
    if op.get_bind().scalar(sa.text('SELECT EXISTS (SELECT 1 FROM goods_nfc_tags WHERE album_id IS NOT NULL)')):
        raise RuntimeError('Album viewing links exist; refusing to discard live links')
    op.drop_constraint('ck_viewing_tag_target', 'goods_nfc_tags', type_='check')
    op.alter_column('goods_nfc_tags', 'purchase_id', existing_type=sa.UUID(), nullable=False)
    op.drop_constraint('uq_goods_nfc_tags_album_id', 'goods_nfc_tags', type_='unique')
    op.drop_constraint('fk_goods_nfc_tags_album', 'goods_nfc_tags', type_='foreignkey')
    op.drop_column('goods_nfc_tags', 'album_id')
