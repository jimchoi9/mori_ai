from backend.access import repository
from backend.http.errors import APIError

MESSAGE = '비공개 테스트 중입니다. 관리자 승인 후 이용할 수 있습니다.'

async def allowed(session, settings, user_id):
    mode = getattr(settings, 'access_mode', 'approved_only')
    if mode == 'all_authenticated':
        return True
    return await repository.approved(session, user_id)

async def require_access(session, settings, user_id):
    if not await allowed(session, settings, user_id):
        raise APIError(403, 'ACCESS_APPROVAL_REQUIRED', MESSAGE)
