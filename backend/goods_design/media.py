"""Goods input boundary: bounded admission and the frozen album v2 codec.

Header inspection also runs in a limited child. HEIF primary/auxiliary selection
belongs to v2; animated PNG/WebP remain unsupported for goods. The shared codec
currently produces an unused thumbnail, a deliberate cost of sharing its limits.
"""
import asyncio
from dataclasses import dataclass, field
from contextlib import asynccontextmanager
import json
from pathlib import Path
import sys
import tempfile
from weakref import WeakKeyDictionary

from backend.http.errors import APIError
from backend.media.contracts import MediaValidationError
from backend.media.process import normalize_in_process, _run_child

MAX_INPUT_BYTES = 20 * 1024 * 1024
WAIT_SECONDS = 5
TIMEOUT_SECONDS = 120
GOODS_CONFIG = {
    'NORMALIZATION_VERSION': 2,
    'NORMALIZED_MAX_EDGE': 2048,
    'NORMALIZED_WEBP_QUALITY': 85,
    'NORMALIZED_WEBP_LOSSLESS': False,
    'NORMALIZED_MAX_BYTES': 20 * 1024 * 1024,
    'THUMBNAIL_MAX_EDGE': 480,
    'THUMBNAIL_WEBP_QUALITY': 80,
}


@dataclass
class _Admission:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    admitted: int = 0


# ASGI serves one loop per process. Separate loop keys also avoid carrying locks
# across test/app lifetimes. At most one active and two waiting inputs per loop.
_admissions = WeakKeyDictionary()


def _error(code):
    status = {'IMAGE_SIZE_LIMIT_EXCEEDED': 413, 'UNSUPPORTED_MEDIA': 415,
              'IMAGE_PROCESS_TIMEOUT': 503, 'IMAGE_PROCESS_MEMORY_LIMIT': 503,
              'IMAGE_PROCESS_BUSY': 503}.get(code, 422)
    return APIError(status, code, retryable=status == 503)


@asynccontextmanager
async def _slot():
    admission = _admissions.setdefault(asyncio.get_running_loop(), _Admission())
    if admission.admitted >= 3:
        raise _error('IMAGE_PROCESS_BUSY')
    admission.admitted += 1
    acquired = False
    try:
        try:
            await asyncio.wait_for(admission.lock.acquire(), WAIT_SECONDS)
            acquired = True
        except TimeoutError:
            raise _error('IMAGE_PROCESS_BUSY') from None
        yield
    finally:
        if acquired:
            admission.lock.release()
        admission.admitted -= 1


async def normalize_goods_upload(stream) -> bytes:
    # Admit before consuming the HTTP body: queued uploads do not retain 20MiB
    # buffers. Reject excess demand without reading it.
    async with _slot():
        data = bytearray()
        async for chunk in stream:
            if len(data) + len(chunk) > MAX_INPUT_BYTES:
                raise _error('IMAGE_SIZE_LIMIT_EXCEEDED')
            data.extend(chunk)
        return await _normalize(data)


async def normalize_goods_source(data: bytes) -> bytes:
    if len(data) > MAX_INPUT_BYTES:
        raise _error('IMAGE_SIZE_LIMIT_EXCEEDED')
    async with _slot():
        return await _normalize(data)


async def _normalize(data) -> bytes:
    try:
        with tempfile.TemporaryDirectory(prefix='mori-goods-') as directory:
            root = Path(directory)
            source = root / 'source'
            source.write_bytes(data)
            await _run_child([sys.executable, '-m', 'backend.goods_design.media',
                              str(source), str(root / 'inspection.json')], TIMEOUT_SECONDS)
            inspection = json.loads((root / 'inspection.json').read_text())
            if inspection.get('error'):
                raise MediaValidationError(inspection['error'])
            result = await normalize_in_process(source, 'source',
                timeout_seconds=TIMEOUT_SECONDS, config=GOODS_CONFIG)
            return result.webp_bytes
    except MediaValidationError as error:
        raise _error(error.code) from None
    except (OSError, ValueError, KeyError, TypeError):
        raise APIError(500, 'INTERNAL_ERROR', retryable=True) from None


def _inspect(source):
    from PIL import Image, UnidentifiedImageError
    import pillow_heif
    pillow_heif.register_heif_opener(thumbnails=False)
    try:
        with Image.open(source) as image:
            if image.format not in {'JPEG', 'MPO', 'PNG', 'WEBP', 'HEIF'}:
                return {'error': 'UNSUPPORTED_MEDIA'}
            if image.width * image.height > 40_000_000:
                return {'error': 'IMAGE_PIXEL_LIMIT_EXCEEDED'}
            # MPO/HEIF containers use only their primary image in the shared
            # codec; secondary images are not animations or decoded here.
            # The codec still enforces the primary image's HDR restrictions.
            if image.format not in {'HEIF', 'MPO'} and getattr(image, 'n_frames', 1) != 1:
                return {'error': 'UNSUPPORTED_MEDIA'}
        return {}
    except Image.DecompressionBombError:
        return {'error': 'IMAGE_PIXEL_LIMIT_EXCEEDED'}
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError):
        return {'error': 'IMAGE_DECODE_FAILED'}


if __name__ == '__main__':
    Path(sys.argv[2]).write_text(json.dumps(_inspect(sys.argv[1])))
