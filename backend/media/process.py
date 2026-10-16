"""Async subprocess boundary: await this function from the worker event loop."""
import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile
from dataclasses import asdict
from .contracts import MediaValidationError, NormalizedImage

CHILD_RSS_LIMIT = 512 * 1024 * 1024
MEDIA_ENV_KEYS = frozenset({
    'NORMALIZED_WEBP_LOSSLESS', 'NORMALIZED_MAX_EDGE', 'NORMALIZED_MAX_BYTES',
    'THUMBNAIL_WEBP_QUALITY', 'THUMBNAIL_MAX_EDGE', 'RESULT_WEBP_QUALITY',
})


def _rss(pid):
    try:
        for line in Path(f'/proc/{pid}/status').read_text().splitlines():
            if line.startswith('VmRSS:'):
                return int(line.split()[1]) * 1024
    except (OSError, ValueError):
        pass
    return 0


async def _run_child(command, timeout_seconds, *, env=None):
    child = await asyncio.create_subprocess_exec(*command,
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL, env=env)
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    try:
        while child.returncode is None:
            if _rss(child.pid) > CHILD_RSS_LIMIT:
                raise MediaValidationError('IMAGE_PROCESS_MEMORY_LIMIT')
            if asyncio.get_running_loop().time() >= deadline:
                raise MediaValidationError('IMAGE_PROCESS_TIMEOUT')
            await asyncio.sleep(.02)
        if child.returncode != 0:
            raise MediaValidationError('IMAGE_NORMALIZATION_FAILED')
    finally:
        if child.returncode is None:
            child.kill()
        await child.wait()


async def normalize_in_process(source_path: Path, filename: str,
                               timeout_seconds: int = 120, *,
                               config: dict[str, int | bool] | None = None) -> NormalizedImage:
    # Reservation snapshots affect only this child; concurrent jobs must never
    # change the parent environment or arbitrary process configuration.
    environment = None
    if config is not None:
        if (not isinstance(config, dict) or set(config) - MEDIA_ENV_KEYS
                or any(type(value) not in {int, bool} for value in config.values())):
            raise MediaValidationError('IMAGE_NORMALIZATION_FAILED')
        environment = os.environ.copy()
        environment.update({key: str(value).lower() for key, value in config.items()})
    if source_path.stat().st_size > 20 * 1024 * 1024:
        raise MediaValidationError('IMAGE_SIZE_LIMIT_EXCEEDED')
    with tempfile.TemporaryDirectory(prefix='mori-media-') as directory:
        await _run_child([sys.executable, '-m', 'backend.media.process',
                         str(source_path.resolve()), filename, directory], timeout_seconds,
                         env=environment)
        root = Path(directory)
        metadata = json.loads((root / 'result.json').read_text())
        if 'error' in metadata:
            raise MediaValidationError(metadata['error'])
        return NormalizedImage(webp_bytes=(root / 'normalized.webp').read_bytes(),
            thumbnail_bytes=(root / 'thumbnail.webp').read_bytes(), **metadata)


def _main():
    from .normalize import normalize
    source, filename, destination = sys.argv[1:]
    root = Path(destination)
    try:
        with open(source, 'rb') as stream:
            data = stream.read(20 * 1024 * 1024 + 1)
        result = normalize(data, filename)
        metadata = asdict(result)
        (root / 'normalized.webp').write_bytes(metadata.pop('webp_bytes'))
        (root / 'thumbnail.webp').write_bytes(metadata.pop('thumbnail_bytes'))
    except MediaValidationError as error:
        metadata = {'error': error.code}
    (root / 'result.json').write_text(json.dumps(metadata))


if __name__ == '__main__':
    _main()
