"""Owner album admission, independent of goods purchase. Callers check ownership."""
from backend.http.errors import APIError


async def require_album_access(session, album):
    # Gift albums stay unavailable until their explicit management registration.
    if album.management_pending:
        raise APIError(404, 'RESOURCE_NOT_FOUND')
