"""Deterministic production packet. Original bytes are never drawn on or resized."""
import hashlib
import json
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
import qrcode
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

from .geometry import artwork_geometry

FONT = Path(__file__).parent/'fonts/NanumGothic-Regular.ttf'
pdfmetrics.registerFont(TTFont('MoriNanum', str(FONT)))
MM = 72/25.4


def png(image):
    out = BytesIO(); image.save(out, format='PNG'); return out.getvalue()


def packet(original, snapshot, purchase_id, upload_url, expires_at=None, nfc_url=None):
    if len(original) > 20*1024*1024:
        raise ValueError('artwork too large')
    with Image.open(BytesIO(original)) as opened:
        if opened.format != 'PNG' or opened.width*opened.height > 16_000_000 or getattr(opened, 'n_frames', 1) != 1:
            raise ValueError('invalid artwork')
        image = opened.convert('RGBA')
    placement = snapshot['placement']
    bounds, anchor = artwork_geometry(image, placement['holeX'], placement['holeY'])
    art = image.crop(bounds)
    size = snapshot.get('print_box_mm', 50)
    width_mm, height_mm = size*art.width/max(art.size), size*art.height/max(art.size)
    keyring = snapshot.get('product', 'keyring') == 'keyring'
    font = ImageFont.truetype(str(FONT), 22)
    preview = Image.new('RGB', (800, 840), '#faf9f4')
    fitted = art.copy(); fitted.thumbnail((560, 560), Image.Resampling.LANCZOS)
    left, top = (800-fitted.width)//2, 130+(560-fitted.height)//2
    preview.paste(fitted, (left, top), fitted)
    draw = ImageDraw.Draw(preview)
    draw.text((40, 35), 'Mori · 확정 배치 안내', fill='#234b3c', font=font)
    draw.text((40, 73), '키링' if keyring else '마그네틱 · 구멍 없음', fill='#234b3c', font=font)
    if keyring:
        hx, hy = left+anchor[0]*fitted.width, top+anchor[1]*fitted.height
        draw.ellipse((hx-14, hy-14, hx+14, hy+14), outline='#d04737', width=4)
        draw.line((hx-23, hy, hx+23, hy), fill='#d04737', width=2)
        draw.line((hx, hy-23, hx, hy+23), fill='#d04737', width=2)
    draw.text((40, 735), f'원화 {width_mm:.1f} × {height_mm:.1f} mm · 비율 유지', fill='#234b3c', font=font)
    draw.text((40, 780), '위치 참고용 · 원화 PNG로 인쇄하세요', fill='#555555', font=font)
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=8, border=4)
    qr.add_data(upload_url); qr.make(fit=True)
    qr_bytes = png(qr.make_image(fill_color='black', back_color='white').convert('RGB'))
    preview_bytes = png(preview)
    spec = {'schema_version': 1, 'purchase_id': purchase_id, 'mode': 'test',
            'product': snapshot.get('product', 'keyring'), 'revision_id': snapshot['revision_id'],
            'design_version': snapshot['design_version'], 'placement': placement,
            'coordinate_system': 'trimmed-artwork-normalized',
            'hole_anchor': {'x': anchor[0], 'y': anchor[1]} if keyring else None,
            'artwork_size_mm': {'width': width_mm, 'height': height_mm},
            'print_box_mm': size, 'artwork_pixels': list(image.size),
            'artwork_sha256': hashlib.sha256(original).hexdigest(),
            'upload_url': upload_url, 'link_expires_at': expires_at,
            'access_policy': 'first_explicit_registration' if '/gifts/' in upload_url else 'owner_login',
            'renderer_version': 'production-guide-v1',
            'note': '테스트 제작 자료. 비율 유지 50×50mm 내 원화 기준. 부착부/여백 포함 실물 치수·칼선은 제작 시 확인.'}
    def sheet(include_nfc):
        out = BytesIO()
        pdf = canvas.Canvas(out, pagesize=A4, invariant=1, pageCompression=1)
        pdf.setTitle('Mori - 테스트 제작 자료'); pdf.setAuthor('Mori')
        def text(value, x, y, size=10, color='#234b3c'):
            pdf.setFillColor(color); pdf.setFont('MoriNanum', size); pdf.drawString(x, y, value)
        text('Mori', 42, 790, 26); text('테스트 구매 · 제작 자료', 42, 758, 16)
        text(f'구매 {purchase_id}', 42, 734, 9)
        text(f"{'키링' if keyring else '마그네틱'} · 원화 {width_mm:.1f} × {height_mm:.1f} mm", 42, 706, 11)
        text('50×50mm 내 비율 유지 · 부착부/여백 포함 실물 크기는 제작 시 확인', 42, 686, 9)
        text('인쇄 원화 · 실제 크기', 42, 648, 12)
        pdf.drawImage(ImageReader(art), 110, 430, width=width_mm*MM, height=height_mm*MM, mask='auto')
        text('확정 배치 안내 · 위치 참고', 335, 648, 11)
        pdf.drawImage(ImageReader(preview), 335, 405, width=210, height=220.5)
        text('사진을 채우는 QR', 42, 370, 12)
        pdf.drawImage(ImageReader(BytesIO(qr_bytes)), 42, 213, width=145, height=145)
        text('로그인 후 내 앨범 등록을 확정해 주세요.' if '/gifts/' in upload_url else '앨범 관리계정으로 로그인 후 사진 추가', 210, 326, 10)
        text('감상용 NFC 주소와 다릅니다.', 210, 304, 10)
        if expires_at:
            text('개발용 주소 · 같은 Wi-Fi와 Mac 실행 필요', 210, 276, 9)
            text(f'유효기한: {expires_at[:19]} UTC', 210, 258, 8)
            text('주소 변경/만료 시 구매 화면에서 새 자료를 받으세요.', 210, 240, 8)
        # Split URLs by measured glyph width; never let a long hostname overlap margins.
        row, y = '', 188
        for char in upload_url:
            if pdfmetrics.stringWidth(row+char, 'MoriNanum', 7) > 510:
                text(row, 42, y, 7); row=''; y-=12
            row += char
        text(row, 42, y, 7)
        pdf.linkURL(upload_url, (42, 213, 187, 358), relative=0)
        text('A4 · 실제 크기 100% · 페이지 맞춤 해제', 42, 132, 10)
        pdf.setStrokeColorRGB(.14,.29,.23); pdf.line(42, 108, 42+50*MM, 108)
        for i in range(6):pdf.line(42+i*10*MM, 105, 42+i*10*MM, 111)
        text('50mm 확인 눈금', 200, 105, 9)
        if include_nfc:
            text('NFC 기록 주소: 첨부 확정 정보 JSON의 nfc_view_url을 태그에 기록하세요.',42,90,8)
        text('원화에는 고리·제품 배경을 합성하지 않았습니다. 배치 안내의 표시는 인쇄하지 마세요.', 42, 73, 8)
        text('실제 결제·제작 발주 아님. 제조 칼선 및 구멍 강도 검증 자료가 아닙니다.', 42, 55, 8)
        pdf.showPage(); pdf.save()
        return out.getvalue()
    result={'original': original, 'preview': preview_bytes, 'qr': qr_bytes, 'sheet': sheet(False),
            'spec': json.dumps(spec, ensure_ascii=False, sort_keys=True, indent=2).encode()}
    if nfc_url:
        result['operator_sheet']=sheet(True)
        result['operator_spec']=json.dumps({**spec,'nfc_view_url':nfc_url},ensure_ascii=False,sort_keys=True,indent=2).encode()
    return result


FILES = {
    'original': ('mori-print-original.png', 'image/png', 'result'),
    'preview': ('mori-placement-guide.png', 'image/png', 'transform_output'),
    'qr': ('mori-upload-qr.png', 'image/png', 'thumbnail'),
    'sheet': ('mori-production.pdf', 'application/pdf', 'normalized'),
    'spec': ('mori-production.json', 'application/json', 'source'),
}

# These two files never appear in purchaser download routes or receipt DTOs.
OPERATOR_FILES = {
    'operator_sheet': ('mori-production.pdf','application/pdf','result_thumbnail'),
    'operator_spec': ('mori-production.json','application/json','upload_thumbnail'),
}
