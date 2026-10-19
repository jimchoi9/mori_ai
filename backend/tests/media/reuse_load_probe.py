"""Offline synthetic codec comparison; NOT a DB/web/concurrency benchmark.

Outputs are synthetic fixtures and derivative WebPs suitable for visual review.
Every profile uses the same input; pixel equality applies ONLY to reuse.
Linux /proc RSS is sampled using the production child guard (20 ms interval).
Use --require-cgroup only inside a fresh 1 GiB/no-swap Docker container.
"""
import argparse
import asyncio
import hashlib
import json
from io import BytesIO
import platform
from pathlib import Path
import random
import resource
import subprocess
import sys
import time

from PIL import Image, ImageDraw
from backend.media import process

PROFILES = {
    'old_4096_90': (4096, 90, 20 * 1024 * 1024),
    'new_2048_85_uncapped': (2048, 85, 20 * 1024 * 1024),
    'new_2048_85_1mb': (2048, 85, 1_000_000),
}
REUSE_CONFIG = {'NORMALIZATION_VERSION': 3, 'WEBP_REUSE_VERSION': 1,
                'NORMALIZED_MAX_EDGE': 2048, 'NORMALIZED_WEBP_QUALITY': 85,
                'NORMALIZED_MAX_BYTES': 1_000_000}


def require(condition, message):
    # Do not disable acceptance checks under python -O.
    if not condition:
        raise RuntimeError(message)


def fingerprint(data):
    with Image.open(BytesIO(data)) as image:
        image.load()
        rgba = image.convert('RGBA')
        pixels = hashlib.sha256(rgba.tobytes()).hexdigest()
        alpha = rgba.getchannel('A').getextrema()
        return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                'pixel_sha256_rgba': pixels, 'dimensions': list(image.size),
                'alpha_extrema': list(alpha), 'metadata_clean': not any(
                    image.info.get(k) for k in ('exif', 'xmp', 'icc_profile'))}


def check_reuse(before, after, action):
    require(action in {'reuse', 'sanitize_then_reuse'}, 'unexpected body fallback: ' + action)
    left, right = fingerprint(before), fingerprint(after)
    require(left['dimensions'] == right['dimensions'], 'reuse dimensions changed')
    require(left['pixel_sha256_rgba'] == right['pixel_sha256_rgba'], 'reuse pixels changed')
    if action == 'reuse':
        require(before == after, 'reuse bytes changed')
    require(right['metadata_clean'], 'output metadata remains')


def make_fixture(path, kind, smoke=False):
    """Deterministic synthetic inputs; no real photographs or external downloads."""
    size = (360, 240) if smoke else (3000, 2000)
    if kind == '12mp':
        size = (4000, 3000)
    elif kind == '40mp':
        size = (8000, 5000)
    elif kind == '48mp_reject':
        size = (8000, 6000)
    if kind == 'noise':
        # A seeded gray noise plane keeps fixture input below the 20 MiB cap.
        image = Image.frombytes('L', size, random.Random(20261019).randbytes(size[0]*size[1])).convert('RGB')
    else:
        image = Image.new('RGBA' if kind == 'alpha' else 'RGB', size,
                          (30, 80, 140, 100) if kind == 'alpha' else (30, 80, 140))
        draw = ImageDraw.Draw(image)
        for x in range(0, size[0], 29):
            draw.line((x, 0, size[0]-1-x, size[1]-1), fill=(230, 180, 40), width=3)
        draw.rectangle((0, 0, size[0]//4, size[1]//4), fill=(240, 30, 50))
        draw.text((12, 12), 'MORI synthetic fine text 0123456789', fill='white')
    exif = Image.Exif()
    exif[274] = int(kind[-1]) if kind.startswith('orientation') else 1
    exif[36867] = '2026:10:19 12:00:00'
    if kind == 'heif':
        import pillow_heif
        pillow_heif.register_heif_opener()
        image.save(path, format='HEIF', quality=85, exif=exif)
    elif kind == 'alpha' or kind.endswith('reject'):
        image.save(path, format='PNG', exif=exif)
    else:
        image.save(path, format='JPEG', quality=85, exif=exif)
    image.close()


async def measured(call):
    peak = 0
    original = process._rss
    def sample(pid):
        nonlocal peak
        value = original(pid)
        peak = max(peak, value)
        return value
    process._rss = sample
    started = time.monotonic()
    try:
        result = await call()
    finally:
        process._rss = original
    if sys.platform == 'linux':
        require(peak > 0, 'Linux child RSS sample unavailable')
    return result, {'seconds': time.monotonic()-started,
                    'codec_child_sampled_peak_bytes': peak or None}


def cgroup_snapshot(root=Path('/sys/fs/cgroup')):
    return {'peak_bytes': int((root/'memory.peak').read_text()),
            'limit_bytes': int((root/'memory.max').read_text()),
            'swap_limit_bytes': int((root/'memory.swap.max').read_text()),
            'events': {k: int(v) for k, v in
                       (line.split() for line in (root/'memory.events').read_text().splitlines())}}


def check_cgroup(snapshot):
    require(snapshot['limit_bytes'] == 1024**3, 'requires exactly 1 GiB container memory limit')
    require(snapshot['swap_limit_bytes'] == 0, 'swap must be disabled')
    require(snapshot['peak_bytes'] <= int(1024**3 * .8), 'worker peak exceeded 80% headroom threshold')
    require(all(snapshot['events'].get(k, -1) == 0 for k in ('oom', 'oom_kill', 'max')),
            'cgroup memory pressure/limit event or missing counters')


async def run(args):
    root = args.output.resolve()
    root.mkdir(parents=True, exist_ok=False)
    cases = ['orientation1', 'orientation6', 'alpha', 'noise'] if args.smoke else [
        *(f'orientation{i}' for i in range(1, 9)), 'alpha', 'noise', 'heif', '12mp', '40mp', '48mp_reject']
    if args.require_cgroup:
        initial = cgroup_snapshot()
        check_cgroup(initial)
    records = []
    with (root/'metrics.jsonl').open('w') as log:
        def emit(record):
            records.append(record)
            line = json.dumps(record, sort_keys=True)
            log.write(line+'\n'); log.flush()
            print(line, flush=True)
        emit({'scope': 'sequential_codec_only', 'platform': platform.platform(),
              'machine': platform.machine(), 'fixture_seed': 20261019,
              'cpu_count': __import__('os').cpu_count(),
              'unmeasured': ['browser_canvas', 'DB/web/proxy', 'AI network', 'storage operations',
                             'encode/decode counts', '50-photo concurrency', 'idle RSS drift',
                             'portrait/hair/foliage photographic quality']})
        try:
            for kind in cases:
                source = root/(kind+'.input')
                command = [sys.executable, '-m', __spec__.name, '--fixture', str(source), '--kind', kind]
                if args.smoke:
                    command.append('--smoke')
                subprocess.run(command, check=True, timeout=180)
                require(source.stat().st_size <= 20*1024*1024, 'fixture exceeds input byte limit')
                for name, (edge, quality, cap) in PROFILES.items():
                    config = {'NORMALIZATION_VERSION': 2, 'NORMALIZED_MAX_EDGE': edge,
                              'NORMALIZED_WEBP_QUALITY': quality, 'NORMALIZED_MAX_BYTES': cap,
                              'NORMALIZED_WEBP_LOSSLESS': False,
                              'THUMBNAIL_MAX_EDGE': 480, 'THUMBNAIL_WEBP_QUALITY': 80}
                    if kind == '48mp_reject':
                        from backend.media.contracts import MediaValidationError
                        try:
                            await process.normalize_in_process(source, source.name, config=config)
                        except MediaValidationError as exc:
                            require(exc.code == 'IMAGE_PIXEL_LIMIT_EXCEEDED', 'wrong 48MP rejection: '+exc.code)
                            emit({'case': kind, 'profile': name, 'expected_rejection': exc.code})
                            continue
                        raise RuntimeError('48MP fixture unexpectedly accepted')
                    result, timing = await measured(lambda: process.normalize_in_process(source, source.name, config=config))
                    body = root/(kind+'.'+name+'.webp')
                    thumb = root/(kind+'.'+name+'.thumb.webp')
                    body.write_bytes(result.webp_bytes); thumb.write_bytes(result.thumbnail_bytes)
                    info = fingerprint(result.webp_bytes)
                    require(max(info['dimensions']) <= edge and info['bytes'] <= cap, 'profile limits violated')
                    require(info['metadata_clean'], 'normalizer left metadata')
                    require((result.width < result.height) == (kind in {'orientation5', 'orientation6', 'orientation7', 'orientation8'}), 'orientation dimensions mismatch')
                    if kind == 'alpha':
                        require(info['alpha_extrema'][0] < 255, 'alpha lost')
                    emit({'case': kind, 'profile': name, 'input_bytes': source.stat().st_size,
                          'input_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                          'body': info, 'thumbnail': fingerprint(result.thumbnail_bytes), **timing})
                    if name == 'new_2048_85_1mb':
                        reused, reuse_time = await measured(lambda: process.validate_prepared_in_process(body, thumb, config=REUSE_CONFIG))
                        check_reuse(result.webp_bytes, reused.webp_bytes, reused.body_action)
                        if reused.thumbnail_action in {'reuse', 'sanitize_then_reuse'}:
                            check_reuse(result.thumbnail_bytes, reused.thumbnail_bytes, reused.thumbnail_action)
                        emit({'case': kind, 'stage': 'prepared_pair_validation', 'body_action': reused.body_action,
                              'thumbnail_action': reused.thumbnail_action, 'body': fingerprint(reused.webp_bytes), **reuse_time})
            if args.require_cgroup:
                snapshot = cgroup_snapshot()
                emit({'cgroup': snapshot}); check_cgroup(snapshot)
            # RUSAGE_SELF excludes codec children; macOS reports bytes, Linux KiB.
            self_peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            emit({'status': 'passed', 'parent_peak_rss_bytes': self_peak if sys.platform == 'darwin' else self_peak*1024,
                  'full_environment_status': 'not_implemented'})
        except Exception as exc:
            emit({'status': 'failed', 'error_type': type(exc).__name__, 'error': str(exc)})
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--smoke', action='store_true')
    parser.add_argument('--require-cgroup', action='store_true')
    parser.add_argument('--fixture', type=Path, help=argparse.SUPPRESS)
    parser.add_argument('--kind', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.fixture:
        make_fixture(args.fixture, args.kind, args.smoke)
    elif args.output is None:
        parser.error('--output must name a NEW directory')
    else:
        asyncio.run(run(args))


if __name__ == '__main__':
    main()
