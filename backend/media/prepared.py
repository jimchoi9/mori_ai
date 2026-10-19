"""Version 3: verify pixels once and reuse eligible compressed WebP payloads."""
from dataclasses import asdict
from io import BytesIO
import hashlib
import os
from PIL import Image, ImageChops
from . import normalize_v2 as legacy
from .contracts import PreparedMediaResult, MediaValidationError
from .webp_inspection import inspect, sanitize, known_srgb


def _comparison(body,thumb):
    w,h=body.size;tw,th=thumb.size
    if tw>w or th>h or max((tw-.5)/w,(th-.5)/h)>=min((tw+.5)/w,(th+.5)/h,1.000001):
        return False
    size=legacy._size(w,h,64,False)
    a=body.convert('RGBA');b=thumb.convert('RGBA')
    try:
        a.thumbnail(size,Image.Resampling.LANCZOS)
        b=b.resize(a.size,Image.Resampling.LANCZOS)
        def acceptable(left,right):
            errors=list(ImageChops.difference(left,right).tobytes());errors.sort()
            return sum(errors)/len(errors)<=4 and errors[min(len(errors)-1,int(len(errors)*.99))]<=24
        if not acceptable(a.getchannel('A'),b.getchannel('A')):return False
        for value in (0,255):
            bg=Image.new('RGBA',a.size,(value,value,value,255))
            if not acceptable(Image.alpha_composite(bg,a).convert('RGB'),Image.alpha_composite(bg,b).convert('RGB')):return False
        return True
    finally:
        a.close();b.close()


def _hdr(info):
    xmp=str(info.get('xmp',b'')).lower()
    return any(token in xmp for token in ('hdr-gain-map','hdrgm:','hdrgainmap','gainmap','gain_map'))


def _thumbnail(body,data):
    if data and len(data)<=200000:
        try:
            chunks=inspect(data)
            with Image.open(BytesIO(data)) as image:
                if (not _hdr(image.info) and chunks is not None and image.format=='WEBP' and max(image.size)<=480
                    and image.getexif().get(274,1)==1 and known_srgb(image.info.get('icc_profile'))):
                    image.load()
                    clean=sanitize(data,chunks,image.size,'A' in image.getbands())
                    if _comparison(body,image):
                        return clean,image.size,'reuse' if clean==data else 'sanitize_then_reuse'
        except (MediaValidationError,OSError,ValueError,SyntaxError,Image.DecompressionBombError):
            pass
    size=legacy._size(*body.size,min(480,legacy._setting('THUMBNAIL_MAX_EDGE',480)),body.width*4==body.height*3)
    thumb=body.resize(size,Image.Resampling.LANCZOS)
    try:return legacy._encode(thumb,quality=legacy._setting('THUMBNAIL_WEBP_QUALITY',80)),size,'normalize'
    finally:thumb.close()


def validate_prepared(source,thumbnail=None):
    if len(source)>legacy.MAX_INPUT_BYTES:raise MediaValidationError('IMAGE_SIZE_LIMIT_EXCEEDED')
    # Only v3 defaults. The preserved legacy implementation and explicit v1/v2
    # child snapshots never read these defaults.
    for key,value in {'NORMALIZED_MAX_EDGE':'2048','NORMALIZED_MAX_BYTES':'1000000','NORMALIZED_WEBP_QUALITY':'85'}.items():
        os.environ.setdefault(key,value)
    try:
        with Image.open(BytesIO(source)) as image:
            if image.width*image.height>legacy.MAX_PIXELS:raise MediaValidationError('IMAGE_PIXEL_LIMIT_EXCEEDED')
            exif=image.getexif();width,height=image.size
            if exif.get(274,1) in {5,6,7,8}:width,height=height,width
            chunks=inspect(source) if image.format=='WEBP' else None
            reuse=(not _hdr(image.info) and chunks is not None and exif.get(274,1)==1
                and known_srgb(image.info.get('icc_profile'))
                and max(image.size)<=legacy._setting('NORMALIZED_MAX_EDGE',2048)
                and len(source)<=legacy._setting('NORMALIZED_MAX_BYTES',1000000))
            if reuse:
                image.load()
                clean=sanitize(source,chunks,image.size,'A' in image.getbands())
                nested=exif.get_ifd(0x8769) if 0x8769 in exif else {}
                captured=nested.get(36867,exif.get(36867));timezone=nested.get(36881,exif.get(36881))
                thumb,ts,action=_thumbnail(image,thumbnail)
                return PreparedMediaResult(clean,thumb,*image.size,width*4==height*3,
                    str(captured) if captured else None,str(timezone) if timezone else None,
                    hashlib.sha256(source).hexdigest(),width,height,hashlib.sha256(clean).hexdigest(),
                    'reuse' if clean==source else 'sanitize_then_reuse',action,*ts)
        # Header inspection did not decode pixels; legacy now decodes once and
        # generates both derivatives from that same image. Its HDR/color checks
        # and decoder reductions are retained.
        result=legacy.normalize(source,'source')
        with Image.open(BytesIO(result.thumbnail_bytes)) as thumb:ts=thumb.size
        return PreparedMediaResult(**asdict(result),original_width=width,original_height=height,
            output_sha256=hashlib.sha256(result.webp_bytes).hexdigest(),body_action='normalize',
            thumbnail_action='normalize',thumbnail_width=ts[0],thumbnail_height=ts[1])
    except MediaValidationError:raise
    except (OSError,ValueError,SyntaxError,Image.DecompressionBombError) as error:
        raise MediaValidationError('IMAGE_DECODE_FAILED') from error
