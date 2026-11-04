"""Temporary local comparison of paid results; private files stay outside static root."""
import argparse
import html
import json
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


def resources(directory):
    report = json.loads((directory / 'results.json').read_text())
    assert report['completed'] and report['rows_preserved']
    results = report['results']
    assert len(results) == 6 and all(row['state'] == 'responded' for row in results)
    cards = []
    for sample in range(1, 4):
        pair = {row['arm']: row for row in results if row['sample'] == sample}
        before, after = (html.escape(pair[arm]['caption']) for arm in ('before', 'after'))
        gps = 'GPS 있음' if pair['after']['gps_present'] else 'GPS 없음'
        cards.append(f'''<article><div class="meta">사진 {sample} · {gps}</div>
            <img src="photo-{sample}.webp" alt="비교에 사용한 사진 {sample}">
            <div class="before"><small>수정 전</small><p>{before}</p></div>
            <div class="after"><small>수정 후</small><p>{after}</p></div></article>''')
    body = '''<!doctype html><html lang="ko"><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Mori · 글귀 비교</title><link rel="stylesheet" href="style.css"></head>
        <body><main><header><small>Mori · 실제 AI 결과</small><h1>장소를 모를 때도 자연스럽게</h1>
        <p>같은 사진으로 생성한 수정 전후 글귀입니다.<br>앨범에 저장된 글은 바꾸지 않았어요.</p></header>
        ''' + ''.join(cards) + '''<footer>각 문구는 한 번씩 생성한 결과입니다. 이번 사진 3장에는 GPS가 없으며,
        GPS가 있는 경우와 다른 사진의 장소 인식 품질까지 확인한 결과는 아닙니다.</footer></main></body></html>'''
    style = '''*{box-sizing:border-box}body{margin:0;background:#faf9f5;color:#293b32;font-family:system-ui,-apple-system,sans-serif}
        main{max-width:600px;margin:auto;padding:28px 18px 48px}header{padding:8px 0 24px}h1{font-size:25px;line-height:1.4;margin:10px 0}
        header p,footer{font-size:14px;line-height:1.8;color:#667468}small{font-size:12px;color:#667468}
        article{background:white;border:1px solid #dbe1d5;border-radius:20px;overflow:hidden;margin-bottom:24px}
        .meta{padding:16px 18px;font-size:13px;color:#667468}img{display:block;width:100%;height:auto}
        .before,.after{padding:18px}.before{border-bottom:1px solid #edf0e8}.after{background:#edf2e8}
        .after small{color:#3e6049}article p{font-size:18px;line-height:1.6;margin:7px 0 0;overflow-wrap:anywhere}
        .before p{color:#788075}.after p{color:#293b32}footer{padding:0 3px}'''
    files = {'': (body.encode(), 'text/html; charset=utf-8'),
             'style.css': (style.encode(), 'text/css; charset=utf-8')}
    for sample in range(1, 4):
        files[f'photo-{sample}.webp'] = ((directory / f'photo-{sample}.webp').read_bytes(), 'image/webp')
    return files


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--private-dir', type=Path, required=True)
    parser.add_argument('--host', default='0.0.0.0')
    parser.add_argument('--port', type=int, default=18219)
    parser.add_argument('--lan', required=True)
    args = parser.parse_args()
    files = resources(args.private_dir)
    access_path = args.private_dir / 'review-access.json'
    if access_path.exists():
        token = json.loads(access_path.read_text())['token']
    else:
        token = secrets.token_urlsafe(24)
        with access_path.open('x') as out:
            access_path.chmod(0o600)
            json.dump({'token': token}, out)
    prefix = '/review/' + token + '/'

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            path = urlsplit(self.path).path
            key = path[len(prefix):] if path.startswith(prefix) else None
            if key not in files:
                self.send_error(404)
                return
            content, mime = files[key]
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(content)

    print(f'http://{args.lan}:{args.port}{prefix}', flush=True)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
