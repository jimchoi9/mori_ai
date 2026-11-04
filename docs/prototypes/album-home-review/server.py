"""Private local design comparison; no product API, uploads or AI calls."""
import argparse
import json
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ASSETS = {
    '': ('index.html', 'text/html; charset=utf-8'),
    'app.css': ('app.css', 'text/css; charset=utf-8'),
    'preview.css': ('preview.css', 'text/css; charset=utf-8'),
    'preview.js': ('preview.js', 'text/javascript; charset=utf-8'),
    'bookPhotos.mjs': ('bookPhotos.mjs', 'text/javascript; charset=utf-8'),
    **{f'photos/photo-{n}.webp': (f'photos/photo-{n}.webp', 'image/webp') for n in range(1, 4)},
    **{f'nfc-assets/{name}': (f'nfc-assets/{name}', 'text/javascript; charset=utf-8')
       for name in ('page-flip.js', 'book.js')},
    'nfc-assets/page-flip-LICENSE.txt': ('nfc-assets/page-flip-LICENSE.txt', 'text/plain; charset=utf-8'),
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--lan', required=True)
    parser.add_argument('--port', type=int, default=18221)
    args = parser.parse_args()
    assert args.root.is_dir()
    assets = {key: ((args.root / file).read_bytes(), mime) for key, (file, mime) in ASSETS.items()}
    access = args.root / 'access.json'
    if access.exists():
        token = json.loads(access.read_text())['token']
    else:
        token = secrets.token_urlsafe(24)
        with access.open('x') as stream:
            access.chmod(0o600)
            json.dump({'token': token}, stream)
    prefix = '/review/' + token + '/'

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            path = urlsplit(self.path).path
            key = path[len(prefix):] if path.startswith(prefix) else None
            if key not in assets:
                self.send_error(404)
                return
            body, mime = assets[key]
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('X-Content-Type-Options', 'nosniff')
            # The existing page-flip library injects its own layout stylesheet.
            self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(body)

    print(f'http://{args.lan}:{args.port}{prefix}', flush=True)
    ThreadingHTTPServer((args.lan, args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
