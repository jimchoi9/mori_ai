"""Match mockup/geometry.ts charm-v1 alpha bounds and nearest external anchor.

Derived from Mori's existing pilot adaptation; source attribution remains in
frontend/public/goods/PROVENANCE.md. No renderer background enters print artwork.
"""
from collections import deque
from math import floor, hypot


def artwork_geometry(image, x, y):
    width, height = image.size
    alpha = image.getchannel('A')
    bounds = alpha.point(lambda a: 255 if a > 48 else 0).getbbox()
    if not bounds:
        raise ValueError('empty artwork')
    left, top, right, bottom = bounds
    ew, eh = right-left, bottom-top
    scale = min(1, 256/max(width, height))
    sw, sh = max(1, floor(width*scale+.5)), max(1, floor(height*scale+.5))
    stride = sw+2
    solid = set()
    for sy in range(sh):
        for sx in range(sw):
            px, py = min(width-1, floor((sx+.5)*width/sw)), min(height-1, floor((sy+.5)*height/sh))
            if alpha.getpixel((px, py)) > 48:
                solid.add((sy+1)*stride+sx+1)
    remaining, largest = set(solid), set()
    steps = (-1, 1, -stride, stride)
    for seed in sorted(solid):
        if seed not in remaining:
            continue
        component, queue = {seed}, deque([seed])
        remaining.remove(seed)
        while queue:
            p = queue.popleft()
            for d in steps:
                n = p+d
                if n in remaining:
                    remaining.remove(n); component.add(n); queue.append(n)
        if len(component) > len(largest):
            largest = component
    air, queue, total = {0}, deque([0]), stride*(sh+2)
    while queue:
        p = queue.popleft()
        for d in steps:
            if d == -1 and p % stride == 0 or d == 1 and p % stride == stride-1:
                continue
            n = p+d
            if 0 <= n < total and n not in solid and n not in air:
                air.add(n); queue.append(n)
    anchors = []
    for p in sorted(largest):
        if not any(p+d in air for d in steps):
            continue
        sx, sy = p % stride-1, p//stride-1
        dx, dy = int(p+1 in air)-int(p-1 in air), int(p+stride in air)-int(p-stride in air)
        length = hypot(dx, dy) or 1
        anchors.append((max(0, min(1, ((sx+.5+dx/length*.5)/sw*width-left)/ew)),
                        max(0, min(1, ((sy+.5+dy/length*.5)/sh*height-top)/eh))))
    if not anchors:
        raise ValueError('no outline')
    anchor = min(anchors, key=lambda p: (p[0]-x)**2+((p[1]-y)*eh/ew)**2)
    return bounds, anchor
