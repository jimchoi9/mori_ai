"""Thin authenticated public album HTTP boundary."""
from uuid import UUID
from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import JSONResponse
from backend.albums import service
from backend.http.errors import APIError, envelope
from backend.http.idempotency import require_key, request_hash
from backend.http.schemas import EmptyBody
from backend.http.security import AuthContext, require_csrf, require_user

router = APIRouter(prefix='/api/v1/albums')


def validate_query(request, allowed):
    if set(request.query_params) - set(allowed):
        raise APIError(422, 'VALIDATION_ERROR')


@router.post('')
async def create(request: Request, body: EmptyBody, context: AuthContext = Depends(require_user),
                 idempotency_key: str | None = Header(default=None)):
    require_csrf(request, context)
    validate_query(request, ())
    key = require_key(idempotency_key)
    async with request.app.state.session_factory() as session, session.begin():
        status, data = await service.create_album(session, context.user_id, key, request_hash(body.model_dump()))
    return JSONResponse(envelope(request, data), status_code=status)


@router.get('')
async def list_albums(request: Request, context: AuthContext = Depends(require_user),
                      cursor: str | None = None, limit: int = Query(default=20, ge=1, le=50)):
    validate_query(request, ('cursor', 'limit'))
    async with request.app.state.session_factory() as session, session.begin():
        data = await service.get_albums(session, context.user_id, cursor, limit)
    return envelope(request, data)


@router.get('/{album_id}')
async def detail(request: Request, album_id: UUID, context: AuthContext = Depends(require_user)):
    validate_query(request, ())
    async with request.app.state.session_factory() as session, session.begin():
        data = await service.get_album_detail(session, context.user_id, album_id)
    return envelope(request, data)


@router.delete('/{album_id}', status_code=202)
async def delete(request: Request, album_id: UUID, expected_version: int = Query(ge=1),
                 context: AuthContext = Depends(require_user)):
    require_csrf(request, context)
    validate_query(request, ('expected_version',))
    async with request.app.state.session_factory() as session, session.begin():
        data = await service.delete_album(session, context.user_id, album_id, expected_version)
    return envelope(request, data)
