from backend.access import repository
from backend.http.errors import APIError

MESSAGE = '비공개 테스트 중입니다. 관리자 승인 후 이용할 수 있습니다.'

async def allowed(session, settings, user_id):
    from backend.models import User
    from datetime import datetime, timezone, timedelta
    user = await session.get(User, user_id)
    if user is not None and user.is_guest:
        return bool(settings.goods_guest_enabled and user.created_at > datetime.now(timezone.utc)-timedelta(hours=24))
    mode = getattr(settings, 'access_mode', 'approved_only')
    if mode == 'all_authenticated':
        return True
    return await repository.approved(session, user_id)

async def require_access(session, settings, user_id):
    if not await allowed(session, settings, user_id):
        raise APIError(403, 'ACCESS_APPROVAL_REQUIRED', MESSAGE)
