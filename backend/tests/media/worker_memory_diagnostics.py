"""Opt-in, offline-only worker memory attribution; never imported by product code.

Observe natural idle first. Only after the last workload, collect cycles and ask
glibc to release free pages, separately. Neither action is a production fix.
"""
import asyncio
from collections import Counter
import ctypes
import gc
import json
from pathlib import Path
import time
import tracemalloc


class Mallinfo(ctypes.Structure):
    _fields_ = [(name, ctypes.c_size_t) for name in (
        'arena', 'ordblks', 'smblks', 'hblks', 'hblkhd', 'usmblks',
        'fsmblks', 'uordblks', 'fordblks', 'keepcost')]


def record(root, label, **extra):
    libc = ctypes.CDLL(None)
    libc.mallinfo2.restype = Mallinfo
    mall = libc.mallinfo2()
    status = {}
    for line in Path('/proc/self/smaps_rollup').read_text().splitlines():
        parts = line.split()
        if len(parts) == 3 and parts[2] == 'kB':
            status[parts[0].rstrip(':')] = int(parts[1]) * 1024
    current, peak = tracemalloc.get_traced_memory()
    def type_name(o):
        cls = type(o)
        module, name = cls.__module__, cls.__name__
        # Some extension/metaclass types expose descriptors here, not strings.
        return (module if isinstance(module, str) else '<descriptor>') + '.' + name
    objects = Counter(type_name(o) for o in gc.get_objects())
    types = {k: v for k, v in objects.items() if k.startswith((
        'httpx.', 'httpcore.', 'openai.', 'PIL.', '_asyncio.',
        'sqlalchemy.orm.session.', 'sqlalchemy.orm.state.'))}
    snapshot = tracemalloc.take_snapshot()
    top = [{'location': str(s.traceback), 'bytes': s.size, 'count': s.count}
           for s in snapshot.statistics('lineno')[:25]]
    del snapshot
    row = dict(label=label, timestamp=time.time(), smaps=status,
               traced_current=current, traced_peak=peak,
               tracer_bytes=tracemalloc.get_tracemalloc_memory(),
               mallinfo={name: getattr(mall, name) for name, _ in Mallinfo._fields_},
               gc_stats=gc.get_stats(), gc_count=gc.get_count(),
               object_count=sum(objects.values()), selected_types=types,
               asyncio_tasks=len(asyncio.all_tasks()), allocations_top=top, **extra)
    with (root / 'worker-memory.jsonl').open('a') as f:
        f.write(json.dumps(row) + '\n')


async def observe(root):
    seen = set()
    while True:
        phase = (root / 'phase').read_text() if (root / 'phase').exists() else ''
        if phase.startswith('idle-') and phase not in seen:
            await asyncio.sleep(1)
            record(root, phase)
            seen.add(phase)
        elif phase == 'complete':
            record(root, 'before_gc')
            collected = gc.collect()
            record(root, 'after_gc', collected=collected)
            libc = ctypes.CDLL(None)
            libc.malloc_trim.argtypes = [ctypes.c_size_t]
            libc.malloc_trim.restype = ctypes.c_int
            trimmed = libc.malloc_trim(0)
            record(root, 'after_trim', trim_result=trimmed)
            await asyncio.sleep(2)
            record(root, 'after_trim_idle')
            (root / 'memory-diagnostics-complete').write_text('done')
            return
        await asyncio.sleep(.2)
