"""WebP container validation, not a compressed-bitstream complete-consumption proof."""
import hashlib
import struct
from .contracts import MediaValidationError

# Actual Chromium Canvas profile, audited with LittleCMS and pixel comparisons.
# Names/descriptions (including 'sRGB') are deliberately not trust signals.
KNOWN_SRGB = {'12afb4d9953adee0607d347daee5b78b18d6b3cab2d572b88970703f5edb37bc'}


def known_srgb(profile):
    return not profile or hashlib.sha256(profile).hexdigest() in KNOWN_SRGB


def inspect(source):
    def invalid(): raise MediaValidationError('IMAGE_DECODE_FAILED')
    if len(source)<20 or source[:4]!=b'RIFF' or source[8:12]!=b'WEBP': invalid()
    end=struct.unpack_from('<I',source,4)[0]+8
    if end>len(source) or end<20: invalid()
    chunks=[]; offset=12
    while offset<end:
        if offset+8>end: invalid()
        tag=source[offset:offset+4];size=struct.unpack_from('<I',source,offset+4)[0]
        stop=offset+8+size; padded=stop+(size&1)
        if padded>end or (size&1 and source[stop]!=0): invalid()
        chunks.append((tag,source[offset+8:stop]));offset=padded
    tags=[tag for tag,_ in chunks]
    for tag in (b'VP8X',b'VP8 ',b'VP8L',b'ALPH',b'ICCP',b'EXIF',b'XMP ',b'ANIM'):
        if tags.count(tag)>1: invalid()
    extended=chunks[0][1] if tags[0]==b'VP8X' else None
    if b'VP8X' in tags and extended is None: invalid()
    if extended is not None:
        if len(extended)!=10 or extended[0]&0xc1 or extended[1:4]!=bytes(3): invalid()
        flags=extended[0]
        for tag,bit in ((b'ICCP',32),(b'EXIF',8),(b'XMP ',4),(b'ANIM',2)):
            if bool(flags&bit)!=(tag in tags): invalid()
        if flags&2:
            if b'ANMF' not in tags: invalid()
            return None  # Existing first-frame normalization, never reuse animation.
    elif any(t in tags for t in (b'ALPH',b'ICCP',b'EXIF',b'XMP ',b'ANIM',b'ANMF')):
        invalid()
    if tags.count(b'VP8 ')+tags.count(b'VP8L')!=1 or b'ANMF' in tags: invalid()
    if b'ALPH' in tags and (b'VP8L' in tags or tags.index(b'ALPH')+1!=tags.index(b'VP8 ')): invalid()
    return chunks


def sanitize(source,chunks,size,has_alpha):
    extended=next((p for t,p in chunks if t==b'VP8X'),None)
    if extended is not None:
        dimensions=(int.from_bytes(extended[4:7],'little')+1,int.from_bytes(extended[7:10],'little')+1)
        if dimensions!=size or bool(extended[0]&16)!=has_alpha:
            raise MediaValidationError('IMAGE_DECODE_FAILED')
    kept=[]
    for tag,payload in chunks:
        if tag==b'VP8X':
            payload=bytes([payload[0]&16])+payload[1:]
        elif tag not in {b'VP8 ',b'VP8L',b'ALPH'}:
            continue
        kept.append(tag+struct.pack('<I',len(payload))+payload+(b'\0' if len(payload)&1 else b''))
    data=b'WEBP'+b''.join(kept)
    result=b'RIFF'+struct.pack('<I',len(data))+data
    inspect(result)  # Re-check reconstructed boundaries and metadata flags.
    return result
