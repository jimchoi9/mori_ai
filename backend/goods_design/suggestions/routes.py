"""HTTP boundary only; permission, CSRF and a bounded request contract."""
from uuid import UUID

from fastapi import APIRouter, Depends, Request

from backend.http.errors import envelope
from backend.http.security import AuthContext, require_approved_goods_actor, require_csrf
from .policy import SuggestRequest

router = APIRouter(prefix='/api/v1/goods')


@router.post('/work/{id}/suggestions')
async def suggestions(request: Request, id: UUID, body: SuggestRequest,
                      context: AuthContext = Depends(require_approved_goods_actor)):
    require_csrf(request, context)
    data = await request.app.state.goods_suggestions.suggest(context.user_id, id, body)
    return envelope(request, data)
