import asyncio
from io import BytesIO
import pytest
from PIL import Image
from scripts.benchmark_caption_parallel import bounded, stored_equivalent


@pytest.mark.asyncio
@pytest.mark.parametrize('lanes', [1, 2, 4])
async def test_bounded_requests_preserve_mapping_and_never_exceed_limit(lanes):
    active = peak = 0
    async def operation(index, value):
        nonlocal active, peak
        active += 1; peak = max(active, peak)
        await asyncio.sleep(.005)
        active -= 1
        return (index, value)
    assert await bounded(list('abcdefghij'), lanes, operation, asyncio.Event()) == list(enumerate('abcdefghij'))
    assert peak == lanes and active == 0


@pytest.mark.asyncio
async def test_failure_drains_inflight_but_never_sends_queued_or_retries():
    sent = []; finished = []
    async def operation(index, value):
        sent.append(index)
        if index == 0:
            await asyncio.sleep(.005)
            raise RuntimeError('unknown')
        await asyncio.sleep(.02)
        finished.append(index)
    with pytest.raises(RuntimeError):
        await bounded(range(10), 2, operation, asyncio.Event())
    assert sent == [0, 1] and finished == [1]


def test_research_preprocessing_preserves_aspect_and_strips_metadata():
    source = BytesIO()
    Image.new('RGB', (2400,1800), 'blue').save(source, 'JPEG', exif=Image.Exif())
    original = source.getvalue()
    with Image.open(BytesIO(stored_equivalent(original))) as result:
        assert result.size == (2048,1536) and result.format == 'WEBP'
        assert not result.getexif()
    assert source.getvalue() == original
