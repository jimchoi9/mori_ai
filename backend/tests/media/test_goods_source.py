from io import BytesIO
import pytest
from PIL import Image
from backend.http.errors import APIError


def picture(fmt='PNG', size=(40, 30), **kwargs):
    out = BytesIO()
    with Image.new('RGB', size, 'red') as im:
        im.save(out, format=fmt, **kwargs)
    return out.getvalue()


@pytest.mark.asyncio
@pytest.mark.parametrize('fmt', ['JPEG', 'PNG', 'WEBP'])
async def test_goods_large_sources_resize_in_bounded_child(fmt):
    from backend.goods_design.media import normalize_goods_source
    result = await normalize_goods_source(picture(fmt, (4200, 4000)))
    with Image.open(BytesIO(result)) as im:
        assert im.format == 'WEBP'
        assert im.size == (2048, 1950)
        assert not im.getexif()


@pytest.mark.asyncio
@pytest.mark.parametrize('data,code,status', [
    (b'broken', 'IMAGE_DECODE_FAILED', 422),
    (picture('GIF'), 'UNSUPPORTED_MEDIA', 415),
    (b'x' * (20 * 1024 * 1024 + 1), 'IMAGE_SIZE_LIMIT_EXCEEDED', 413),
    (picture('PNG', (6400, 6400)), 'IMAGE_PIXEL_LIMIT_EXCEEDED', 422),
], ids=['corrupt', 'gif', 'bytes', 'pixels'])
async def test_goods_source_rejections_are_specific(data, code, status):
    from backend.goods_design.media import normalize_goods_source
    with pytest.raises(APIError) as err:
        await normalize_goods_source(data)
    assert (err.value.code, err.value.status) == (code, status)


@pytest.mark.asyncio
async def test_goods_animation_rejected():
    from backend.goods_design.media import normalize_goods_source
    out = BytesIO()
    first = Image.new('RGB', (32, 32), 'red')
    second = Image.new('RGB', (32, 32), 'blue')
    first.save(out, format='WEBP', save_all=True, append_images=[second], duration=100, loop=0)
    with pytest.raises(APIError) as err:
        await normalize_goods_source(out.getvalue())
    assert err.value.code == 'UNSUPPORTED_MEDIA'


@pytest.mark.asyncio
async def test_goods_heif_orientation_and_hdr_policy():
    import pillow_heif
    from backend.goods_design.media import normalize_goods_source
    pillow_heif.register_heif_opener()
    exif = Image.Exif(); exif[274] = 6
    result = await normalize_goods_source(picture('HEIF', (80, 40), exif=exif.tobytes()))
    with Image.open(BytesIO(result)) as im:
        assert im.size == (40, 80)
    out = BytesIO(); Image.new('I;16', (40, 30)).save(out, format='PNG')
    with pytest.raises(APIError) as err:
        await normalize_goods_source(out.getvalue())
    assert err.value.code == 'IMAGE_NORMALIZATION_FAILED'

@pytest.mark.asyncio
async def test_goods_gate_bounds_waiters_and_cancellation_cleans_temp(monkeypatch, tmp_path):
    import asyncio
    from backend.goods_design import media
    started = asyncio.Event()
    paths = []
    async def blocked(source, filename, **kwargs):
        paths.append(source)
        started.set()
        await asyncio.Event().wait()
    monkeypatch.setattr(media, 'normalize_in_process', blocked)
    data = picture()
    running = asyncio.create_task(media.normalize_goods_source(data))
    await asyncio.wait_for(started.wait(), 5)
    waiting = [asyncio.create_task(media.normalize_goods_source(data)) for _ in range(2)]
    await asyncio.sleep(.01)
    with pytest.raises(APIError) as err:
        await media.normalize_goods_source(data)
    assert (err.value.status, err.value.retryable) == (503, True)
    consumed = False
    async def incoming():
        nonlocal consumed
        consumed = True
        yield data
    with pytest.raises(APIError):
        await media.normalize_goods_upload(incoming())
    assert not consumed
    for task in [running, *waiting]: task.cancel()
    await asyncio.gather(running, *waiting, return_exceptions=True)
    assert paths and all(not p.exists() for p in paths)
    # Released admission survives cancellations; another call reaches codec.
    started.clear()
    task = asyncio.create_task(media.normalize_goods_source(data))
    await asyncio.wait_for(started.wait(), 5)
    task.cancel(); await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
@pytest.mark.parametrize('code,status,retryable', [
    ('IMAGE_PROCESS_TIMEOUT',503,True), ('IMAGE_PROCESS_MEMORY_LIMIT',503,True),
    ('IMAGE_NORMALIZATION_FAILED',422,False),
])
async def test_goods_codec_errors_preserve_reason(monkeypatch, code, status, retryable):
    from backend.goods_design import media
    from backend.media.contracts import MediaValidationError
    async def fail(*args, **kwargs): raise MediaValidationError(code)
    monkeypatch.setattr(media, 'normalize_in_process', fail)
    with pytest.raises(APIError) as err: await media.normalize_goods_source(picture())
    assert (err.value.code, err.value.status, err.value.retryable) == (code,status,retryable)

@pytest.mark.asyncio
async def test_goods_stream_overflow_and_wait_timeout_release_admission(monkeypatch):
    import asyncio
    from backend.goods_design import media
    async def oversized():
        yield b'x' * (20 * 1024 * 1024)
        yield b'x'
    with pytest.raises(APIError) as err: await media.normalize_goods_upload(oversized())
    assert err.value.code == 'IMAGE_SIZE_LIMIT_EXCEEDED'
    started = asyncio.Event()
    async def stalled():
        started.set()
        await asyncio.Event().wait()
        yield b''
    task = asyncio.create_task(media.normalize_goods_upload(stalled()))
    await started.wait()
    monkeypatch.setattr(media, 'WAIT_SECONDS', .01)
    with pytest.raises(APIError) as err: await media.normalize_goods_source(picture())
    assert err.value.code == 'IMAGE_PROCESS_BUSY'
    task.cancel(); await asyncio.gather(task, return_exceptions=True)
    # An input can be processed after both a timeout and a cancelled stream.
    assert (await media.normalize_goods_source(picture()))[:4] == b'RIFF'


@pytest.mark.asyncio
@pytest.mark.parametrize('transfer', [16, 18])
async def test_goods_heif_hdr_is_codec_rejection_not_corruption(transfer):
    import pillow_heif
    from backend.goods_design.media import normalize_goods_source
    pillow_heif.register_heif_opener()
    data = picture('HEIF', nclx_profile={'color_primaries': 9,
        'transfer_characteristics': transfer, 'matrix_coefficients': 9, 'full_range_flag': 1})
    with pytest.raises(APIError) as err: await normalize_goods_source(data)
    assert err.value.code == 'IMAGE_NORMALIZATION_FAILED'

@pytest.mark.asyncio
async def test_goods_heif_ten_bit_rejected():
    import pillow_heif
    from backend.goods_design.media import normalize_goods_source
    image = pillow_heif.from_bytes('RGB;16', (40, 30), b'\x00\x80' * 40 * 30 * 3)
    out = BytesIO(); image.save(out, quality=-1, bit_depth=10)
    with pytest.raises(APIError) as err: await normalize_goods_source(out.getvalue())
    assert err.value.code == 'IMAGE_NORMALIZATION_FAILED'

@pytest.mark.asyncio
async def test_goods_exact_40mp_jpeg_boundary_and_48mp_rejection():
    from backend.goods_design.media import normalize_goods_source
    result = await normalize_goods_source(picture('JPEG', (8000, 5000)))
    with Image.open(BytesIO(result)) as im:
        assert im.size == (2048, 1280)
        assert im.format == 'WEBP'
    with pytest.raises(APIError) as err:
        await normalize_goods_source(picture('JPEG', (8000, 6000)))
    assert (err.value.code, err.value.status) == ('IMAGE_PIXEL_LIMIT_EXCEEDED', 422)
