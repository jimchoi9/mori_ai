"""Album use entitlement; ownership must be checked by the caller first."""
from backend.albums.repository import has_purchase_access
from backend.http.errors import APIError


async def require_album_access(session, album):
    # Only the migration grants this compatibility exception to pre-existing albums.
    # HTTP bodies and checkout cannot request it; newly inserted rows default false.
    if album.management_pending:
        raise APIError(404, 'RESOURCE_NOT_FOUND')
    if album.legacy_access or await has_purchase_access(session, album):
        return
    raise APIError(403, 'PURCHASE_REQUIRED', '굿즈 구매로 연결된 사진첩에서 이용할 수 있습니다.')
