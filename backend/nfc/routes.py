"""Anonymous read-only NFC HTTP boundary; capabilities are not account credentials."""
import asyncio
import json
from uuid import UUID
from fastapi import APIRouter,Request,Header
from fastapi.responses import Response,FileResponse
from pydantic import StrictStr,Field
from backend.http.security import require_origin
from backend.http.schemas import StrictBody
from backend.http.errors import APIError,envelope
from backend.albums.music import BGM_PATH
from . import service

router=APIRouter(prefix='/api/v1/nfc')
PRIVATE={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}


class TokenBody(StrictBody):
    token:StrictStr=Field(min_length=32,max_length=100,pattern=r'^[A-Za-z0-9_-]+$')


def no_query(request):
    if request.query_params:raise APIError(422,'VALIDATION_ERROR')


@router.post('/tags/{tag_id}/enter')
async def enter(request:Request,tag_id:UUID,body:TokenBody):
    require_origin(request);no_query(request)
    async with request.app.state.session_factory() as session,session.begin():
        data=await service.enter(session,tag_id,body.token)
    response=Response(json.dumps(envelope(request,data)),media_type='application/json',headers=PRIVATE)
    return response


@router.get('/media/{asset_id}')
async def media(request:Request,asset_id:UUID,x_mori_viewer_token:str|None=Header(default=None)):
    no_query(request)
    async with request.app.state.session_factory() as session:
        key,mime=await service.media(session,x_mori_viewer_token,asset_id)
    data=await asyncio.to_thread(request.app.state.media_storage.read_bytes,key)
    return Response(data,media_type=mime,headers=PRIVATE)


@router.get('/music')
async def music(request:Request,x_mori_viewer_token:str|None=Header(default=None)):
    no_query(request)
    async with request.app.state.session_factory() as session:await service.context(session,x_mori_viewer_token)
    if not BGM_PATH.is_file():raise APIError(404,'RESOURCE_NOT_FOUND')
    return FileResponse(BGM_PATH,media_type='audio/mpeg',headers=PRIVATE)


@router.post('/close')
async def close(request:Request,body:TokenBody):
    require_origin(request);no_query(request)
    async with request.app.state.session_factory() as session,session.begin():await service.close(session,body.token)
    return Response(status_code=204,headers=PRIVATE)
