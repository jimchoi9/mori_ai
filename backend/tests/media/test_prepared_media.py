from io import BytesIO
import hashlib
import pytest
from PIL import Image
from backend.media import process
from backend.media.contracts import MediaValidationError


def webp(size=(120,160), color='blue', **kwargs):
    out=BytesIO(); Image.new('RGB',size,color).save(out,'WEBP',quality=85,**kwargs)
    return out.getvalue()


async def prepared(tmp_path, body, thumb=None):
    assert hasattr(process,'validate_prepared_in_process'), 'v3 prepared validation is missing'
    path=tmp_path/'body';path.write_bytes(body)
    tp=tmp_path/'thumb'
    if thumb is not None: tp.write_bytes(thumb)
    return await process.validate_prepared_in_process(path,tp if thumb is not None else None,
        config={'NORMALIZATION_VERSION':3,'WEBP_REUSE_VERSION':1})


@pytest.mark.asyncio
async def test_clean_pair_reuses_bytes(tmp_path):
    body,thumb=webp(),webp((60,80))
    result=await prepared(tmp_path,body,thumb)
    assert result.webp_bytes==body and result.thumbnail_bytes==thumb
    assert (result.body_action,result.thumbnail_action)==('reuse','reuse')
    assert result.original_width==120 and result.original_height==160


@pytest.mark.asyncio
@pytest.mark.parametrize('thumb',[b'broken',webp((60,80),'red'),webp((80,60))])
async def test_bad_thumbnail_only_regenerates(tmp_path,thumb):
    body=webp(); result=await prepared(tmp_path,body,thumb)
    assert result.webp_bytes==body and result.thumbnail_bytes!=thumb
    assert result.body_action=='reuse' and result.thumbnail_action=='normalize'


@pytest.mark.asyncio
async def test_exif_gps_xmp_sanitized(tmp_path):
    exif=Image.Exif();exif[36867]='2026:10:19 01:02:03'
    body=webp(exif=exif,xmp=b'private')
    result=await prepared(tmp_path,body)
    assert result.body_action=='sanitize_then_reuse'
    assert result.captured_at_raw=='2026:10:19 01:02:03'
    assert result.sha256==hashlib.sha256(body).hexdigest()
    assert result.output_sha256==hashlib.sha256(result.webp_bytes).hexdigest()!=result.sha256
    image=Image.open(BytesIO(result.webp_bytes))
    assert not image.getexif() and not image.info.get('xmp')
    assert image.tobytes()==Image.open(BytesIO(body)).tobytes()


@pytest.mark.asyncio
async def test_malformed_container_rejected(tmp_path):
    body=bytearray(webp());body[4:8]=(len(body)+300).to_bytes(4,'little')
    with pytest.raises(MediaValidationError): await prepared(tmp_path,bytes(body))


@pytest.mark.asyncio
async def test_orientation_normalizes_original_dimensions(tmp_path):
    exif=Image.Exif();exif[274]=6
    result=await prepared(tmp_path,webp((160,120),exif=exif))
    assert (result.original_width,result.original_height)==(120,160)
    assert (result.width,result.height)==(120,160)
    assert result.body_action=='normalize'


@pytest.mark.asyncio
async def test_retry_reproduces_same_bytes(tmp_path):
    body=webp(xmp=b'private')
    first=await prepared(tmp_path,body);second=await prepared(tmp_path,body)
    assert first==second


def test_clean_pair_has_zero_encodes(monkeypatch):
    from backend.media.prepared import validate_prepared
    from backend.media import normalize_v2
    body,thumb=webp(),webp((60,80))
    def forbidden(*args,**kwargs):raise AssertionError('unexpected pixel encode')
    monkeypatch.setattr(normalize_v2,'_encode',forbidden)
    result=validate_prepared(body,thumb)
    assert result.webp_bytes==body and result.thumbnail_bytes==thumb


@pytest.mark.asyncio
async def test_internal_payload_is_not_a_rejection_condition(tmp_path):
    from backend.tests.media.webp_reuse_probe import mutate_payload, MARKER
    body=mutate_payload(webp(),b'VP8 ')
    result=await prepared(tmp_path,body)
    assert result.webp_bytes==body and MARKER in result.webp_bytes


@pytest.mark.asyncio
async def test_unknown_icc_normalizes(tmp_path):
    from PIL import ImageCms
    profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
    result=await prepared(tmp_path,webp(icc_profile=profile))
    assert result.body_action=='normalize'
    assert not Image.open(BytesIO(result.webp_bytes)).info.get('icc_profile')


@pytest.mark.asyncio
async def test_webp_hdr_metadata_not_silently_removed(tmp_path):
    with pytest.raises(MediaValidationError):
        await prepared(tmp_path,webp(xmp=b'hdrgm:Version=1'))


# Chromium Canvas sRGB profile from the synthetic 2026-10-19 browser audit.
CHROMIUM_SRGB = 'AAAByAAAAAAEMAAAbW50clJHQiBYWVogB+AAAQABAAAAAAAAYWNzcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAPbWAAEAAAAA0y0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJZGVzYwAAAPAAAAAkclhZWgAAARQAAAAUZ1hZWgAAASgAAAAUYlhZWgAAATwAAAAUd3RwdAAAAVAAAAAUclRSQwAAAWQAAAAoZ1RSQwAAAWQAAAAoYlRSQwAAAWQAAAAoY3BydAAAAYwAAAA8bWx1YwAAAAAAAAABAAAADGVuVVMAAAAIAAAAHABzAFIARwBCWFlaIAAAAAAAAG+iAAA49QAAA5BYWVogAAAAAAAAYpkAALeFAAAY2lhZWiAAAAAAAAAkoAAAD4QAALbPWFlaIAAAAAAAAPbWAAEAAAAA0y1wYXJhAAAAAAAEAAAAAmZmAADypwAADVkAABPQAAAKWwAAAAAAAAAAbWx1YwAAAAAAAAABAAAADGVuVVMAAAAgAAAAHABHAG8AbwBnAGwAZQAgAEkAbgBjAC4AIAAyADAAMQA2'


@pytest.mark.asyncio
async def test_known_srgb_profile_can_reuse(tmp_path):
    import base64
    body=webp(icc_profile=base64.b64decode(CHROMIUM_SRGB))
    result=await prepared(tmp_path,body)
    assert result.body_action=='sanitize_then_reuse'
    assert Image.open(BytesIO(body)).tobytes()==Image.open(BytesIO(result.webp_bytes)).tobytes()


@pytest.mark.asyncio
async def test_duplicate_image_chunk_is_rejected(tmp_path):
    body=webp();data=body+body[12:]
    data=data[:4]+(len(data)-8).to_bytes(4,'little')+data[8:]
    with pytest.raises(MediaValidationError):await prepared(tmp_path,data)


@pytest.mark.asyncio
@pytest.mark.parametrize('placement',['unknown_chunk','trailing'])
async def test_external_private_bytes_are_sanitized(tmp_path,placement):
    body=webp();data=body+b'JUNK'+(6).to_bytes(4,'little')+b'secret'
    if placement=='unknown_chunk':data=data[:4]+(len(data)-8).to_bytes(4,'little')+data[8:]
    result=await prepared(tmp_path,data)
    assert result.webp_bytes==body and result.body_action=='sanitize_then_reuse'


@pytest.mark.asyncio
async def test_animation_retains_legacy_first_frame_policy(tmp_path):
    out=BytesIO();Image.new('RGB',(120,160),'red').save(out,'WEBP',save_all=True,
        append_images=[Image.new('RGB',(120,160),'blue')],duration=100)
    result=await prepared(tmp_path,out.getvalue())
    image=Image.open(BytesIO(result.webp_bytes))
    assert result.body_action=='normalize' and image.n_frames==1
    assert image.getpixel((40,40))[0]>240


@pytest.mark.asyncio
async def test_unknown_format_is_not_accepted_as_webp(tmp_path):
    out=BytesIO();Image.new('RGB',(120,160),'red').save(out,'BMP')
    with pytest.raises(MediaValidationError):await prepared(tmp_path,out.getvalue())


@pytest.mark.asyncio
async def test_v3_resizes_oversized_webp_preserving_original_dimensions(tmp_path):
    result=await prepared(tmp_path,webp((2100,100)))
    assert (result.original_width,result.original_height)==(2100,100)
    assert (result.width,result.height)==(2048,98)
    assert result.body_action=='normalize'


def test_thumbnail_decompression_bomb_only_regenerates_thumbnail(monkeypatch):
    from backend.media.prepared import validate_prepared
    body,thumbnail=webp((10,10)),webp((40,40))
    # Exercise Pillow's actual header guard with a small fixture: body is
    # below the threshold; thumbnail exceeds twice the pixel limit.
    monkeypatch.setattr(Image,'MAX_IMAGE_PIXELS',500)
    result=validate_prepared(body,thumbnail)
    assert result.webp_bytes==body and result.body_action=='reuse'
    assert result.thumbnail_action=='normalize'
    assert Image.open(BytesIO(result.thumbnail_bytes)).size==(10,10)
