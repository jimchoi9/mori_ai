"""Authenticated purchase resources; no mail send endpoint exposed to purchasers."""
from uuid import UUID
from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from backend.http.security import AuthContext, require_user, require_csrf
from backend.http.schemas import StrictBody
from pydantic import Field, StrictStr
from backend.http.errors import APIError, envelope
from . import service

router = APIRouter(prefix='/api/v1/goods/purchases')


@router.get('/by-album/{album_id}')
async def by_album(request: Request, album_id: UUID, context: AuthContext = Depends(require_user)):
    from sqlalchemy import select
    from backend.models import GoodsTestPurchase, Album
    async with request.app.state.session_factory() as session:
        identity = await session.scalar(select(GoodsTestPurchase.id).join(Album, Album.id == GoodsTestPurchase.album_id)
            .where(Album.id == album_id, Album.owner_id == context.user_id, Album.management_pending.is_(False)))
        purchase = await session.get(GoodsTestPurchase, identity) if identity else None
    return envelope(request, {'purchase_id': str(identity) if identity else None,
        'return_path': f'/purchases/{identity}' if purchase and purchase.owner_id == context.user_id else f'/gifts/{identity}' if identity else None})


@router.get('/{id}')
async def detail(request: Request, id: UUID, context: AuthContext = Depends(require_user)):
    data = await service.receipt(request.app.state.session_factory, context.user_id, id, request.app.state.settings)
    return envelope(request, data)


@router.get('/{id}/files/{name}')
async def file(request: Request, id: UUID, name: str, context: AuthContext = Depends(require_user)):
    try:
        content, filename, mime = await service.file_content(request.app.state.session_factory,
            request.app.state.media_storage, request.app.state.settings, context.user_id, id, name)
    except FileNotFoundError:
        raise APIError(404, 'RESOURCE_NOT_FOUND') from None
    except (OSError, ValueError):
        raise APIError(503, 'STORAGE_UNAVAILABLE', retryable=True) from None
    return Response(content, media_type=mime, headers={'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Disposition': f'inline; filename="{filename}"'})


class GiftToken(StrictBody):
    token: StrictStr | None = Field(default=None, max_length=100)


@router.post('/{id}/gift/inspect')
async def gift_inspect(request: Request, id: UUID, body: GiftToken, context: AuthContext = Depends(require_user)):
    require_csrf(request, context)
    from .gifts import inspect
    async with request.app.state.session_factory() as session:
        data = await inspect(session, context.user_id, id, body.token)
    return envelope(request, data)


@router.post('/{id}/gift/claim')
async def gift_claim(request: Request, id: UUID, body: GiftToken, context: AuthContext = Depends(require_user)):
    require_csrf(request, context)
    from .gifts import inspect
    async with request.app.state.session_factory() as session, session.begin():
        data = await inspect(session, context.user_id, id, body.token, claim=True, settings=request.app.state.settings)
    return envelope(request, data)
