from uuid import UUID
from fastapi import APIRouter, Depends, Query, Request, Response
from backend.access import repository, service
from backend.access.admin_schemas import ApprovalBody
from backend.http.errors import envelope
from backend.http.security import AuthContext, require_user, require_csrf

router = APIRouter(prefix='/api/v1/admin')


@router.get('/me')
async def me(request: Request, response: Response, context: AuthContext = Depends(require_user)):
    async with request.app.state.session_factory() as session:
        await service.require_admin(session, context.user_id)
    response.headers['Cache-Control'] = 'private, no-store'
    return envelope(request, {'user_id': str(context.user_id), 'access_mode': request.app.state.settings.access_mode})


@router.get('/users')
async def users(request: Request, response: Response, q: str = Query('', max_length=100),
                cursor: str | None = Query(None, max_length=2048), limit: int = Query(20, ge=1, le=50),
                context: AuthContext = Depends(require_user)):
    async with request.app.state.session_factory() as session:
        await service.require_admin(session, context.user_id)
        data = await repository.list_admin_users(session, q=q, cursor=cursor, limit=limit)
    response.headers['Cache-Control'] = 'private, no-store'
    return envelope(request, data)


@router.put('/users/{user_id}/approval')
async def approval(user_id: UUID, body: ApprovalBody, request: Request, response: Response,
                   context: AuthContext = Depends(require_user)):
    require_csrf(request, context)
    async with request.app.state.session_factory() as session, session.begin():
        user = await service.change_approval(session, actor_id=context.user_id, target_id=user_id,
            approved=body.approved, expected_version=body.expected_version, source='web')
        data = (await repository.admin_views(session, [user]))[0]
    response.headers['Cache-Control'] = 'private, no-store'
    return envelope(request, data)
