"""Guest-only goods principals; members retain exclusive album/save permissions."""
import secrets
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, func
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from uuid import UUID

from backend.auth import repository as auth
from backend.auth.service import NOTICE, consent as agree_consent
from backend.http.errors import APIError, envelope
from backend.http.schemas import StrictBody, ConsentBody
from backend.http.security import (AuthContext, GUEST_COOKIE_NAME, token_hash, csrf_token,
    require_origin, require_csrf, require_goods_actor, require_approved_user)
from backend.models import User, GoodsWork
from backend.goods_design.guest_service import quota_used, claim_work, GUEST_GENERATION_LIMIT

router = APIRouter(prefix='/api/v1/goods')


@router.post('/guest-session')
async def guest_session(request: Request):
    require_origin(request)
    settings = request.app.state.settings
    if not settings.goods_guest_enabled:
        raise APIError(503, 'TEMPORARILY_UNAVAILABLE')
    raw = request.cookies.get(GUEST_COOKIE_NAME, '')
    created = False
    async with request.app.state.session_factory() as session, session.begin():
        row = await auth.find_session(session, token_hash(raw)) if raw and len(raw) <= 512 else None
        user = await session.get(User, row.user_id) if row else None
        if user is None or not user.is_guest:
            raw = secrets.token_urlsafe(32)
            user = User(display_name='방문자', is_guest=True)
            session.add(user)
            await session.flush()
            row = await auth.save_session(session, user.id, token_hash(raw),
                datetime.now(timezone.utc)+timedelta(hours=24))
            created = True
        consent = await auth.get_consent(session, user.id, settings.consent_policy_version)
        work_id = await session.scalar(select(GoodsWork.id).where(
            GoodsWork.owner_id == user.id, GoodsWork.status == 'active',
            GoodsWork.expires_at > func.now()).order_by(GoodsWork.created_at.desc()).limit(1))
        data = {'user': {'id': str(user.id), 'display_name': user.display_name},
            'access': {'mode': settings.access_mode, 'allowed': True},
            'csrf_token': csrf_token(raw),
            'consent': {'required': consent is None, 'policy_version': settings.consent_policy_version, 'notice': NOTICE},
            'guest': {'remaining': max(0, GUEST_GENERATION_LIMIT-await quota_used(session,user.id)),
                      'work_id': str(work_id) if work_id else None}}
    response = JSONResponse(envelope(request, data))
    if created:
        response.set_cookie(GUEST_COOKIE_NAME, raw, max_age=86400, path='/',
                            httponly=True, secure=settings.session_cookie_secure, samesite='lax')
    return response


@router.post('/consents')
async def consent(request: Request, body: ConsentBody, context: AuthContext = Depends(require_goods_actor)):
    require_csrf(request, context)
    data, created = await agree_consent(request.app.state.session_factory,
        request.app.state.settings, context, body)
    return JSONResponse(envelope(request, data), status_code=201 if created else 200)


class Claim(StrictBody):
    work_id: UUID


@router.post('/claim')
async def claim(request: Request, body: Claim, context: AuthContext = Depends(require_approved_user)):
    require_csrf(request, context)
    async with request.app.state.session_factory() as session, session.begin():
        raw = request.cookies.get(GUEST_COOKIE_NAME, '')
        guest_session = await auth.find_session(session, token_hash(raw)) if raw and len(raw) <= 512 else None
        guest = await session.get(User, guest_session.user_id) if guest_session else None
        work_id = await claim_work(session, context.user_id, guest, body.work_id)
        return envelope(request, {'work_id': str(work_id)})
