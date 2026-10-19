"""Task 1 research only. Never import this module into the upload pipeline.

Demonstrates why container validation + successful decoding is not a
sanitizer. All images and private markers are synthetic.
"""
from io import BytesIO
import hashlib
import json
import platform
import time

from PIL import Image, ImageDraw, features
import PIL

MARKER = b'SYNTHETIC_PRIVATE_PAYLOAD_location=fixture_only!!'


def encode(image, **options):
    out = BytesIO()
    image.save(out, format='WEBP', **options)
    return out.getvalue()


def chunks(data):
    """Strict OUTER container only, deliberately not a bitstream validator."""
    if data[:4] != b'RIFF' or data[8:12] != b'WEBP':
        raise ValueError('header')
    if int.from_bytes(data[4:8], 'little') + 8 != len(data):
        raise ValueError('riff size')
    result, p = [], 12
    while p < len(data):
        if p + 8 > len(data):
            raise ValueError('chunk header')
        name, n = data[p:p+4], int.from_bytes(data[p+4:p+8], 'little')
        end = p + 8 + n
        if end + (n & 1) > len(data):
            raise ValueError('chunk bounds')
        if n & 1 and data[end] != 0:
            raise ValueError('padding')
        result.append((name, data[p+8:end]))
        p = end + (n & 1)
    return result


def pack(items):
    body = b''.join(name + len(value).to_bytes(4, 'little') + value
                    + (b'\0' if len(value) & 1 else b'') for name, value in items)
    return b'RIFF' + (len(body)+4).to_bytes(4, 'little') + b'WEBP' + body


def decode(data):
    with Image.open(BytesIO(data)) as image:
        if image.width * image.height > 40_000_000:
            raise ValueError('pixels')
        if getattr(image, 'n_frames', 1) != 1:
            raise ValueError('animation')
        image.load()
        return image.convert('RGBA')


def fixture(alpha=False):
    image = Image.new('RGBA' if alpha else 'RGB', (192, 256))
    image.putdata([((x*17+y*3)%256, (x*5+y*11)%256, (x+y*7)%256,
                    (x*9+y*5)%256) if alpha else
                   ((x*17+y*3)%256, (x*5+y*11)%256, (x+y*7)%256)
                   for y in range(256) for x in range(192)])
    return image


def mutate_payload(data, name):
    items = chunks(data)
    if not any(key == name for key, _ in items):
        raise ValueError('fixture missing target chunk')
    return pack([(key, value + MARKER if key == name else value)
                 for key, value in items])


def cases():
    for label, alpha, lossless in [('rgb_lossy', False, False),
                                  ('rgb_lossless', False, True),
                                  ('rgba_lossy', True, False),
                                  ('rgba_lossless', True, True)]:
        clean = encode(fixture(alpha), quality=85, lossless=lossless)
        yield label+'/clean', clean, clean
        yield label+'/after_riff', clean, clean+MARKER
        yield label+'/unknown_chunk', clean, pack(chunks(clean)+[(b'JUNK', MARKER)])
        for name, _ in chunks(clean):
            if name in (b'VP8 ', b'VP8L', b'ALPH'):
                yield label+'/inside_'+name.decode().strip(), clean, mutate_payload(clean, name)
        yield label+'/truncated', clean, clean[:-7]
        image_chunks = [(k, v) for k, v in chunks(clean) if k in (b'VP8 ', b'VP8L')]
        yield label+'/duplicate_image', clean, pack(chunks(clean)+image_chunks)
    clean = encode(fixture(), quality=85)
    yield 'metadata/exif', clean, encode(fixture(), quality=85, exif=MARKER)
    yield 'metadata/xmp', clean, encode(fixture(), quality=85, xmp=MARKER)
    yield 'metadata/icc', clean, encode(fixture(), quality=85, icc_profile=MARKER)
    out = BytesIO()
    Image.new('RGB', (192, 256), 'red').save(out, format='WEBP', save_all=True,
        append_images=[Image.new('RGB', (192, 256), 'blue')], duration=100)
    yield 'animated', clean, out.getvalue()


def inspect_case(label, clean, candidate):
    row = {'case': label, 'bytes': len(candidate)}
    try:
        parsed = chunks(candidate)
        row['outer_valid'] = True
        row['chunks'] = [name.decode() for name, _ in parsed]
    except ValueError:
        row['outer_valid'] = False
    try:
        decoded = decode(candidate)
    except (OSError, ValueError):
        row['decoded'] = False
    else:
        row['decoded'] = True
        row['same_pixels'] = decoded.tobytes() == decode(clean).tobytes()
        row['pixel_sha256'] = hashlib.sha256(decoded.tobytes()).hexdigest()
        # Explicit pixel-only encoding, not the application's full normalizer.
        encoded = encode(decoded, quality=85, exif=b'', xmp=b'', icc_profile=b'')
        row['marker_after_pixel_reencode'] = MARKER in encoded
    row['marker_in_input'] = MARKER in candidate
    return row


def thumbnail_comparison(body, thumbnail):
    """Plan's candidate metric, not proof of identity or a security boundary."""
    from PIL import ImageChops, ImageStat
    a, b = decode(body), decode(thumbnail)
    a.thumbnail((64, 64), Image.Resampling.LANCZOS)
    b = b.resize(a.size, Image.Resampling.LANCZOS)
    errors = []
    for color in ('white', 'black'):
        bg = Image.new('RGBA', a.size, color)
        aa = Image.alpha_composite(bg, a).convert('RGB')
        bb = Image.alpha_composite(bg, b).convert('RGB')
        values = sorted(ImageChops.difference(aa, bb).tobytes())
        errors.append({'mae': sum(values)/len(values),
                       'p99': values[int((len(values)-1)*.99)]})
    alpha_error = ImageStat.Stat(ImageChops.difference(a.getchannel('A'), b.getchannel('A'))).mean[0]
    return {'backgrounds': errors, 'alpha_mae': alpha_error,
            'accepted': all(e['mae'] <= 4 and e['p99'] <= 24 for e in errors) and alpha_error <= 4}


def run():
    start = time.perf_counter()
    rows = [inspect_case(*case) for case in cases()]
    base = Image.new('RGB', (768, 1024), '#b8c3d0')
    ImageDraw.Draw(base).rectangle((100, 200, 500, 600), fill='#49768c')
    body = encode(base, quality=85)
    thumb = base.resize((360, 480), Image.Resampling.LANCZOS)
    altered = thumb.copy()
    ImageDraw.Draw(altered).rectangle((200, 300, 207, 307), fill='red')
    comparisons = {name: thumbnail_comparison(body, encode(img, quality=80))
                   for name, img in [('same', thumb), ('local_edit', altered),
                                     ('different', Image.new('RGB', thumb.size, 'green'))]}
    return {'python': platform.python_version(), 'platform': platform.platform(),
            'pillow': PIL.__version__, 'libwebp': features.version('webp'),
            'cases': rows, 'thumbnail_comparison': comparisons,
            'seconds': time.perf_counter()-start,
            'scope': 'Synthetic local research; no production reuse path; no Linux memory validation'}


if __name__ == '__main__':
    print(json.dumps(run(), indent=2))
