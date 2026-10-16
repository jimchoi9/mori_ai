"""Workflow foundation only. Public/authentication schema is a later migration."""
from datetime import datetime
from uuid import UUID, uuid4
from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Identity:
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)


class Created:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text('now()'))


class User(Identity, Created, Base):
    __tablename__ = 'users'
    display_name: Mapped[str] = mapped_column(String(100), default='test')
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Album(Identity, Created, Base):
    __tablename__ = 'albums'
    owner_id: Mapped[UUID] = mapped_column(ForeignKey('users.id'))
    title: Mapped[str] = mapped_column(Text, default='나의 사진첩')
    status: Mapped[str] = mapped_column(String(30), default='draft')
    version: Mapped[int] = mapped_column(default=1)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Page(Identity, Base):
    __tablename__ = 'album_pages'
    album_id: Mapped[UUID] = mapped_column(ForeignKey('albums.id'))
    position: Mapped[int] = mapped_column(default=1)
    selection_index: Mapped[int] = mapped_column(default=1)
    version: Mapped[int] = mapped_column(default=1)
    result_asset_id: Mapped[UUID | None] = mapped_column(ForeignKey('media_assets.id', use_alter=True, name='fk_page_result'))
    caption_text: Mapped[str | None] = mapped_column(Text)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (Index('uq_page_position', 'album_id', 'position', unique=True, postgresql_where=text('removed_at IS NULL')), UniqueConstraint('album_id', 'selection_index'))


class MediaAsset(Identity, Created, Base):
    __tablename__ = 'media_assets'
    owner_id: Mapped[UUID] = mapped_column(ForeignKey('users.id'))
    album_id: Mapped[UUID] = mapped_column(ForeignKey('albums.id'))
    page_id: Mapped[UUID] = mapped_column(ForeignKey('album_pages.id'))
    role: Mapped[str] = mapped_column(String(30))
    storage_key: Mapped[str] = mapped_column(Text, unique=True)
    mime: Mapped[str] = mapped_column(String(100))
    bytes: Mapped[int | None] = mapped_column(BigInteger)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    sha256: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(30), default='pending')
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Upload(Identity, Created, Base):
    __tablename__ = 'upload_sessions'
    album_id: Mapped[UUID] = mapped_column(ForeignKey('albums.id'))
    page_id: Mapped[UUID] = mapped_column(ForeignKey('album_pages.id'))
    asset_id: Mapped[UUID] = mapped_column(ForeignKey('media_assets.id'))
    batch_id: Mapped[UUID]
    client_file_id: Mapped[UUID]
    status: Mapped[str] = mapped_column(String(30), default='reserved')
    declared_bytes: Mapped[int] = mapped_column(BigInteger)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    error_code: Mapped[str | None] = mapped_column(String(100))
    __table_args__ = (UniqueConstraint('batch_id', 'client_file_id'),)


class Run(Identity, Created, Base):
    __tablename__ = 'generation_runs'
    album_id: Mapped[UUID] = mapped_column(ForeignKey('albums.id'))
    status: Mapped[str] = mapped_column(String(30), default='queued')
    input_version: Mapped[int] = mapped_column(default=1)
    input_snapshot: Mapped[list] = mapped_column(JSONB, default=list)
    config_snapshot: Mapped[dict] = mapped_column(JSONB, default=dict)
    __table_args__ = (Index('uq_active_run', 'album_id', unique=True, postgresql_where=text("status IN ('queued','running','action_required')")),)


class Task(Identity, Base):
    __tablename__ = 'generation_tasks'
    run_id: Mapped[UUID] = mapped_column(ForeignKey('generation_runs.id'))
    page_id: Mapped[UUID] = mapped_column(ForeignKey('album_pages.id'))
    stage: Mapped[str] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(30), default='queued')
    output_asset_id: Mapped[UUID | None] = mapped_column(ForeignKey('media_assets.id'))
    output_caption: Mapped[str | None] = mapped_column(Text)
    completion_kind: Mapped[str | None] = mapped_column(String(30))
    attempt_count: Mapped[int] = mapped_column(default=0)
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fence_version: Mapped[int] = mapped_column(default=0)
    error_code: Mapped[str | None] = mapped_column(String(100))
    safe_to_retry: Mapped[bool] = mapped_column(Boolean, default=False)
    requires_ai_call: Mapped[bool] = mapped_column(Boolean, default=True)
    has_persisted_input: Mapped[bool] = mapped_column(Boolean, default=False)
    __table_args__ = (UniqueConstraint('run_id', 'page_id', 'stage'), CheckConstraint("stage IN ('caption','image_transform','optimize')"))


class Attempt(Identity, Created, Base):
    __tablename__ = 'task_attempts'
    task_id: Mapped[UUID] = mapped_column(ForeignKey('generation_tasks.id'))
    attempt_no: Mapped[int]
    fence_version: Mapped[int]
    provider_request_id: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default='prepared')
    dispatch_state: Mapped[str] = mapped_column(String(30), default='not_sent')
    output_asset_id: Mapped[UUID | None] = mapped_column(ForeignKey('media_assets.id'))
    output_caption: Mapped[str | None] = mapped_column(Text)
    result_key: Mapped[str | None] = mapped_column(Text)
    result_sha256: Mapped[str | None] = mapped_column(String(64))
    usage: Mapped[dict | None] = mapped_column(JSONB)
    estimated_cost: Mapped[dict | None] = mapped_column(JSONB)
    error_code: Mapped[str | None] = mapped_column(String(100))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (UniqueConstraint('task_id', 'attempt_no'),)


class Outbox(Identity, Created, Base):
    __tablename__ = 'outbox_events'
    event_type: Mapped[str] = mapped_column(String(30))
    entity_id: Mapped[UUID]
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Job(Identity, Created, Base):
    __tablename__ = 'background_jobs'
    kind: Mapped[str] = mapped_column(String(30))
    target_id: Mapped[UUID]
    status: Mapped[str] = mapped_column(String(30), default='queued')
    attempt_count: Mapped[int] = mapped_column(default=0)
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fence_version: Mapped[int] = mapped_column(default=0)
    error_code: Mapped[str | None] = mapped_column(String(100))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (UniqueConstraint('kind', 'target_id'),)
