from io import BytesIO
import asyncio
import pytest
from PIL import Image


@pytest.mark.asyncio
async def test_fake_canvas_contains_all_pixels_and_exact_ratio(tmp_path):
    from backend.media.fake_transform import fake_transform
    image=Image.new('RGB',(60,20),'red')
    image.putpixel((0,0),(0,255,0)); image.putpixel((59,19),(0,0,255))
    path=tmp_path/'normalized.webp';image.save(path,format='WEBP',lossless=True)
    original=path.read_bytes()
    output=await fake_transform(path)
    with Image.open(BytesIO(output)) as result:
        assert result.format=='WEBP' and result.size==(60,80)
        assert result.getpixel((0,0))==(234,216,187)
        assert result.getpixel((0,30))==(0,255,0) and result.getpixel((59,49))==(0,0,255)
    assert path.read_bytes()==original


@pytest.mark.asyncio
async def test_fake_canvas_bounds_edge_and_event_loop_keeps_ticking(tmp_path):
    from backend.media.fake_transform import fake_transform
    path=tmp_path/'wide.webp';Image.new('RGB',(600,200),'red').save(path,format='WEBP',lossless=True)
    ticks=[]
    async def tick():
        while True: ticks.append(1);await asyncio.sleep(.005)
    task=asyncio.create_task(tick())
    try: output=await fake_transform(path,max_edge=120)
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):await task
    with Image.open(BytesIO(output)) as result:
        assert result.size==(90,120)
    assert len(ticks)>1


@pytest.mark.asyncio
async def test_tiny_input_is_never_enlarged(tmp_path):
    from backend.media.fake_transform import fake_transform
    path=tmp_path/'tiny.webp';Image.new('RGB',(1,1),'red').save(path,format='WEBP',lossless=True)
    data=await fake_transform(path)
    with Image.open(BytesIO(data)) as image:
        assert sum(pixel==(255,0,0) for pixel in image.get_flattened_data())==1

@pytest.mark.asyncio
async def test_new_policy_reuses_eligible_webp_bytes(tmp_path):
    from backend.media.fake_transform import optimize_in_process
    path=tmp_path/'eligible.webp';Image.new('RGB',(300,400),'red').save(path,format='WEBP',lossless=True)
    original=path.read_bytes()
    result,thumb,meta=await optimize_in_process(path,{'result_policy':'reuse_normalized_v1','normalized_max_edge':2048,'normalized_max_bytes':1000000})
    assert result==original and thumb

@pytest.mark.asyncio
async def test_new_policy_bounds_bytes_without_changing_old_run(tmp_path):
    from backend.media.fake_transform import optimize_in_process
    import random
    path=tmp_path/'noise.webp'
    Image.frombytes('RGB',(900,1200),random.Random(7).randbytes(900*1200*3)).save(path,format='WEBP',lossless=True)
    assert len(path.read_bytes())>1000000
    config={'result_policy':'reuse_normalized_v1','normalized_max_edge':2048,'normalized_max_bytes':1000000,'result_webp_quality':85}
    result,_,_=await optimize_in_process(path,config)
    assert len(result)<=1000000
    old,_,_=await optimize_in_process(path,{})
    assert old==path.read_bytes()
