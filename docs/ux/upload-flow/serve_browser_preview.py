"""Serve only the synthetic UX comparison on an explicit local/LAN interface.

No application imports, credentials, file uploads, directory listing or CDN.
python3 docs/ux/upload-flow/serve_browser_preview.py --bind <LAN-IP>
"""
import argparse
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
from pathlib import Path


SOURCE = Path(__file__).with_name('three-upload-flows.html')
POLICY = (
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
    "img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; "
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
)
STYLE = """
:root{color-scheme:light dark;--background:#fff;--foreground:#283329;--muted-foreground:#606a5c}
@media(prefers-color-scheme:dark){:root{--background:#20251f;--foreground:#e6eadf;--muted-foreground:#b9c2b0}}
*{box-sizing:border-box}body{margin:0;background:var(--background);color:var(--foreground);font:16px/1.5 -apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif}
.browser-header{position:sticky;top:0;z-index:10;background:var(--background);padding:12px max(12px,env(safe-area-inset-left));border-bottom:1px solid #8885}
.browser-header>div{max-width:760px;margin:auto}.browser-title{font-size:14px;margin-bottom:8px}
.browser-nav{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.browser-nav button{min-height:46px;border:1px solid #8888;border-radius:10px;padding:7px 5px;background:transparent;color:inherit;font:inherit;font-size:14px}
.browser-nav button[aria-pressed=true]{background:#46613d;color:#fffef9;border-color:#46613d}
main{max-width:760px;margin:auto;padding:12px}
.viz-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:end}
.form-label{display:grid;gap:6px;min-width:0;font-size:13px}
.form-select{width:100%;min-width:0;min-height:44px;font:inherit;font-size:16px;padding:8px;border:1px solid #8888;border-radius:8px;color:inherit;background:var(--background)}
.btn{min-height:44px;padding:8px 12px;border:1px solid #8888;border-radius:8px;color:inherit;background:var(--background);font:inherit;font-size:14px}
.btn-ghost{border-color:transparent;text-decoration:underline}
.text-small{font-size:12px}.text-muted{color:var(--muted-foreground)}
.viz-carousel>[hidden]{display:none!important}
button:focus-visible,select:focus-visible{outline:3px solid #819b55;outline-offset:3px}
:is(#mori-upload-three-ways,#mori-upload-refined,#mori-upload-balanced) .mori-demo{min-height:0;padding-bottom:16px}
@supports not (color:light-dark(white,black)){
 :is(#mori-upload-three-ways,#mori-upload-refined,#mori-upload-balanced) .mori-phone{--m-bg:#faf9f6;--m-ink:#293b2c;--m-muted:#647060;--m-surface:#efefe7;--m-line:#d7ddcd;--m-green:#46613d;--m-on-green:#fffef9;--m-fail:#963b28}
}
@media(max-width:350px){.viz-controls{grid-template-columns:1fr}.browser-nav button{font-size:13px}}
"""
NAVIGATION = """
(() => {
 const panels=Array.from(document.querySelectorAll('.viz-carousel > [data-variant]'));
 const buttons=Array.from(document.querySelectorAll('.browser-nav button'));
 for(const button of buttons){button.addEventListener('click',()=>{
   const target=Number(button.dataset.variantIndex);
   panels.forEach((panel,index)=>{panel.hidden=index!==target;});
   buttons.forEach((item,index)=>{item.setAttribute('aria-pressed',String(index===target));});
 });}
})();
"""


def build_document(source=SOURCE, labels=None):
    fragment = source.read_text(encoding='utf-8')
    buttons = ''.join(
        f'<button type="button" data-variant-index="{i}" aria-pressed="{str(i == 0).lower()}">{escape(label)}</button>'
        for i, label in enumerate(labels or ['보내기 있음', '바로 전송', '카카오톡식'])
    )
    # The shared fragment retains its guarded optional host hooks; no host is required.
    # Styles follow the fragment so the native browser fallback can override its frame.
    return (
        '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="referrer" content="no-referrer"><title>Mori 업로드 UX 세 가지 비교</title>'
        '</head><body><header class="browser-header"><div>'
        '<div class="browser-title">Mori 업로드 UX 비교 · 실제 사진 전송 없음</div>'
        '<nav class="browser-nav" aria-label="비교할 업로드 방식">' + buttons + '</nav>'
        '</div></header><main>' + fragment + '</main>'
        '<style>' + STYLE + '</style><script>' + NAVIGATION + '</script></body></html>'
    ).encode('utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bind', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=18192)
    args = parser.parse_args()
    address = ipaddress.ip_address(args.bind)
    if not address.is_private or address.is_unspecified or address.is_multicast:
        parser.error('Use a specific private LAN or loopback IP')
    if not 1024 <= args.port <= 65535:
        parser.error('Use a nonprivileged port')
    expected_host = f'{args.bind}:{args.port}'

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            if self.headers.get('Host') != expected_host:
                self.send_error(400)
                return
            if self.path not in ('/', '/index.html', '/refined', '/balanced', '/management', '/editing'):
                self.send_error(404)
                return
            if self.path == '/editing':
                body = SOURCE.parent.parent.joinpath('album-management/editing.html').read_bytes()
            elif self.path == '/management':
                body = SOURCE.parent.parent.joinpath('album-management/comparison.html').read_bytes()
            elif self.path == '/balanced':
                body = build_document(SOURCE.with_name('balanced-upload-flows.html'),
                                      ['중간안', '이전 카톡식', '최소 문구안'])
            elif self.path == '/refined':
                body = build_document(SOURCE.with_name('refined-upload-flows.html'),
                                      ['간결한 카톡식', '바로 전송', '이전 카톡식'])
            else:
                body = build_document()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Security-Policy', POLICY)
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer((args.bind, args.port), Handler)
    print(f'http://{expected_host}/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
