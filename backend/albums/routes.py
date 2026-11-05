"""Thin authenticated public album HTTP boundary."""
from uuid import UUID
from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import JSONResponse
from backend.albums import service
from backend.http.errors import APIError, envelope
from backend.http.idempotency import require_key, request_hash
from backend.http.schemas import EmptyBody, StrictBody
from pydantic import Field, StrictInt, StrictStr
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
        status, data = await service.create_album(session, context.user_id, key, request_hash(body.model_dump()), request.app.state.settings)
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


class PublishBody(StrictBody):
    expected_version: StrictInt = Field(ge=1)


class CaptionBody(PublishBody):
    caption_text: StrictStr


@router.patch('/{album_id}/pages/{page_id}/caption')
async def caption(request:Request,album_id:UUID,page_id:UUID,body:CaptionBody,context:AuthContext=Depends(require_user)):
    require_csrf(request,context);validate_query(request,())
    from backend.albums.editing import save_caption
    async with request.app.state.session_factory() as session,session.begin():
        data=await save_caption(session,context.user_id,album_id,page_id,body.expected_version,body.caption_text)
    return envelope(request,data)


@router.post('/{album_id}/publish')
async def publish(request:Request,album_id:UUID,body:PublishBody,context:AuthContext=Depends(require_user)):
    require_csrf(request,context);validate_query(request,())
    from backend.albums.editing import publish_album
    async with request.app.state.session_factory() as session,session.begin():
        data=await publish_album(session,context.user_id,album_id,body.expected_version)
    return envelope(request,data)


@router.get('/{album_id}/viewer')
async def viewer(request:Request,album_id:UUID,context:AuthContext=Depends(require_user)):
    validate_query(request,())
    from backend.albums.viewer import get_viewer
    async with request.app.state.session_factory() as session,session.begin():
        data=await get_viewer(session,context.user_id,album_id)
    return envelope(request,data)


@router.post('/{album_id}/viewing-link')
async def viewing_link(request:Request,album_id:UUID,body:EmptyBody,context:AuthContext=Depends(require_user)):
    require_csrf(request,context);validate_query(request,())
    from backend.nfc.sharing import viewing_link as issue
    async with request.app.state.session_factory() as session,session.begin():
        data=await issue(session,context.user_id,album_id,request.app.state.settings.app_origin)
    return JSONResponse(envelope(request,data),headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'})


@router.post('/{album_id}/content')
async def content(request:Request,album_id:UUID,body:EmptyBody,context:AuthContext=Depends(require_user)):
    require_csrf(request,context);validate_query(request,())
    from backend.album_content.service import enable
    async with request.app.state.session_factory() as session,session.begin():
        await enable(session,context.user_id,album_id,request.app.state.settings)
        data=await service.get_album_detail(session,context.user_id,album_id)
    return envelope(request,data)


class TitleBody(PublishBody):
    title: StrictStr = Field(min_length=1,max_length=200)


@router.patch('/{album_id}/title')
async def title(request:Request,album_id:UUID,body:TitleBody,context:AuthContext=Depends(require_user)):
    require_csrf(request,context);validate_query(request,())
    from backend.album_titles.service import rename_album
    async with request.app.state.session_factory() as session,session.begin():
        data=await rename_album(session,context.user_id,album_id,body.expected_version,body.title)
    return envelope(request,data)


class TitleSelectionBody(StrictBody):
    selection_id: UUID


@router.post('/{album_id}/title-selection/complete')
async def title_selection_complete(request:Request,album_id:UUID,body:TitleSelectionBody,context:AuthContext=Depends(require_user)):
    require_csrf(request,context);validate_query(request,())
    from backend.album_titles.service import complete_selection
    async with request.app.state.session_factory() as session,session.begin():
        data=await complete_selection(session,context.user_id,album_id,body.selection_id)
    return envelope(request,data)
