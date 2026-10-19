"""Small offline allocation attribution; each arm runs in a fresh process.

Pass an existing synthetic land.webp. No image/DB/network writes occur. The
bounded arm executes LocalStorage.read_bytes unchanged, overriding only path
resolution to use that fixture. The sized arm is a diagnostic control, not a
proposed replacement for production validation. Run only outside other loads.
"""
import argparse
import concurrent.futures
import ctypes
import gc
import json
from pathlib import Path
import subprocess
import sys
import threading
import tracemalloc

from PIL import Image
from io import BytesIO
from backend.storage.local import LocalStorage


class FixtureStorage(LocalStorage):
    def __init__(self, fixture):
        self.fixture = fixture

    def path(self, key, create=False):
        return self.fixture


class Mallinfo(ctypes.Structure):
    _fields_ = [(key, ctypes.c_size_t) for key in (
        'arena', 'ordblks', 'smblks', 'hblks', 'hblkhd', 'usmblks',
        'fsmblks', 'uordblks', 'fordblks', 'keepcost')]


def measure(arm, threads, phase):
    # Gather native values before JSON formatting allocations. Thread RSS cannot
    # be added per TID: all threads share the same process address space.
    libc = ctypes.CDLL(None)
    libc.mallinfo2.restype = Mallinfo
    native = libc.mallinfo2()
    smaps = {}
    for line in Path('/proc/self/smaps_rollup').read_text().splitlines():
        parts = line.split()
        if len(parts) == 3 and parts[2] == 'kB':
            smaps[parts[0].rstrip(':')] = int(parts[1]) * 1024
    current, peak = tracemalloc.get_traced_memory()
    print(json.dumps({
        'arm': arm, 'threads': threads, 'phase': phase,
        'smaps': smaps, 'traced_current': current, 'traced_peak': peak,
        'tracer_bytes': tracemalloc.get_tracemalloc_memory(),
        'mallinfo': {key: getattr(native, key) for key, _ in Mallinfo._fields_},
        'os_thread_count': len(list(Path('/proc/self/task').iterdir())),
    }), flush=True)


def run_arm(args):
    fixture = args.fixture.resolve(strict=True)
    size = fixture.stat().st_size
    if not 0 < size <= 20 * 1024 * 1024:
        raise ValueError('fixture must be nonempty and <=20 MiB')
    store = FixtureStorage(fixture)
    # Decode arm isolates native codec allocation from repeated file-read
    # allocation; its immutable compressed bytes are loaded before tracing.
    encoded = fixture.read_bytes() if args.arm == 'decode' else None
    if encoded is not None:
        with Image.open(BytesIO(encoded)) as image:
            if image.format != 'WEBP' or image.width * image.height > 12_000_000:
                raise ValueError('decode fixture must be WebP <=12MP')
    tracemalloc.start(1)
    measure(args.arm, args.threads, 'baseline')
    barrier = threading.Barrier(args.threads)

    def operation(_):
        barrier.wait(timeout=30)
        if args.arm == 'bounded_read':
            data = store.read_bytes('synthetic-fixture')
            return len(data)
        if args.arm == 'sized_read':
            with fixture.open('rb') as stream:
                data = stream.read(size + 1)
            return len(data)
        with Image.open(BytesIO(encoded)) as image:
            image.load()
            return image.width * image.height

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.threads) as pool:
        for iteration in range(args.rounds):
            values = list(pool.map(operation, range(args.threads)))
            if args.arm != 'decode' and any(value != size for value in values):
                raise RuntimeError('fixture changed during probe')
            measure(args.arm, args.threads, f'idle-{iteration}')
        # Keep pool threads alive while measuring idle/GC/trim. Pool shutdown
        # would otherwise confound native arena lifetime with object lifetime.
        gc.collect()
        measure(args.arm, args.threads, 'after_gc_pool_alive')
        libc = ctypes.CDLL(None)
        libc.malloc_trim.argtypes = [ctypes.c_size_t]
        libc.malloc_trim.restype = ctypes.c_int
        libc.malloc_trim(0)
        measure(args.arm, args.threads, 'after_trim_pool_alive')
    measure(args.arm, args.threads, 'after_pool_shutdown')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', type=Path, required=True)
    parser.add_argument('--arm', choices=('all', 'bounded_read', 'sized_read', 'decode'), default='all')
    parser.add_argument('--threads', type=int, choices=(4, 8), default=4)
    parser.add_argument('--rounds', type=int, default=8)
    args = parser.parse_args()
    if sys.platform != 'linux' or not 1 <= args.rounds <= 32:
        parser.error('requires Linux/glibc and 1..32 rounds')
    if args.arm != 'all':
        run_arm(args)
        return
    for threads in (4, 8):
        for arm in ('bounded_read', 'sized_read', 'decode'):
            subprocess.run([
                sys.executable, '-m', 'backend.tests.media.allocation_path_probe',
                '--fixture', str(args.fixture.resolve()), '--arm', arm,
                '--threads', str(threads), '--rounds', str(args.rounds),
            ], check=True, timeout=180)


if __name__ == '__main__':
    main()
