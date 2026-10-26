"""Owner-serialized admission and private cache; never hold locks across an LLM call."""
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from uuid import UUID

from sqlalchemy import func, select

from backend.albums.repository import lock_owner
from backend.goods_design.history import Revision, design_context
from backend.goods_design.service import work
from backend.http.errors import APIError
from backend.http.idempotency import request_hash
from backend.models import GoodsRevision, GoodsSuggestionBatch
from .policy import DAILY_CALL_LIMIT, VERSION, SuggestionContext, SuggestRequest


@dataclass(frozen=True)
class Admission:
    id: UUID | None
    response: dict | None
    context: SuggestionContext | None = None


def response(row):
    return {'items': row.items or [], 'source': 'ai' if row.status == 'ready' else row.status,
            'batch': row.batch}


async def prepare(session, owner, work_id, body: SuggestRequest) -> Admission:
    actor = await lock_owner(session, owner)
    current = await work(session, owner, work_id)
    if actor.is_guest and body.batch > 3:
        raise APIError(429, 'SUGGESTIONS_BATCH_LIMIT')
    revisions = (await session.scalars(select(GoodsRevision).where(
        GoodsRevision.work_id == work_id))).all()
    parent = next((r for r in revisions if r.id == body.parent_id), None)
    if body.parent_id and (parent is None or parent.status != 'ready' or not parent.result_key):
        raise APIError(422, 'VALIDATION_ERROR')
    image_key = parent.result_key if parent else current.source_key
    if not image_key:
        raise APIError(422, 'UPLOAD_NOT_READY')
    image_ref = f'revision:{parent.id}' if parent else f'source:{current.source_hash}'
    ancestry = design_context([Revision(str(r.id), str(work_id),
        str(r.parent_id) if r.parent_id else None, r.message) for r in revisions],
        str(parent.id) if parent else None, str(work_id))
    history = tuple(text[-400:] for text in ancestry[-4:])
    hashed = request_hash({'version': VERSION, 'work_id': str(work_id), 'image': image_ref,
        'style': body.style, 'product': body.product, 'history': history})
    old = await session.scalar(select(GoodsSuggestionBatch).where(
        GoodsSuggestionBatch.owner_id == owner, GoodsSuggestionBatch.context_hash == hashed,
        GoodsSuggestionBatch.batch == body.batch))
    if old:
        return Admission(None, response(old))
    day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    used = await session.scalar(select(func.count()).select_from(GoodsSuggestionBatch).where(
        GoodsSuggestionBatch.owner_id == owner, GoodsSuggestionBatch.created_at >= day_start))
    if actor.is_guest and used >= DAILY_CALL_LIMIT:
        raise APIError(429, 'SUGGESTIONS_DAILY_LIMIT', '오늘의 AI 추천 요청 한도에 도달했습니다.',
            details={'limit': DAILY_CALL_LIMIT, 'retry_at': (day_start + timedelta(days=1)).isoformat()})
    cached = (await session.scalars(select(GoodsSuggestionBatch).where(
        GoodsSuggestionBatch.owner_id == owner, GoodsSuggestionBatch.work_id == work_id,
        GoodsSuggestionBatch.status == 'ready').order_by(GoodsSuggestionBatch.created_at.desc()))).all()
    summary = next((r.visual_summary for r in cached if r.image_ref == image_ref), None)
    excluded = tuple(i['prompt'] for r in cached if r.context_hash == hashed
                     for i in r.items or [])[:36]
    row = GoodsSuggestionBatch(owner_id=owner, work_id=work_id, context_hash=hashed,
                               image_ref=image_ref, batch=body.batch, status='pending')
    session.add(row)
    await session.flush()
    context = SuggestionContext(owner, work_id, image_key, image_ref, hashed, body.style,
        body.product, parent is not None, history, summary, excluded)
    return Admission(row.id, None, context)


async def finish(session, owner, work_id, batch_id, items=None, summary=None):
    # Revalidate after dispatch: a concurrent discard/claim must not disclose old-owner data.
    await work(session, owner, work_id)
    row = await session.get(GoodsSuggestionBatch, batch_id, with_for_update=True)
    if row is None or row.owner_id != owner:
        raise APIError(404, 'RESOURCE_NOT_FOUND')
    row.status = 'ready' if items else 'fallback'
    row.items, row.visual_summary = items, summary
    return response(row)
