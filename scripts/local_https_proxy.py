"""Temporary same-Wi-Fi HTTPS bridge for local mobile QA; no credential logging.

Create a short-lived certificate separately, then pass its paths. Bind only to a
specific private LAN address. The browser must trust that local certificate.
"""
import argparse
import http.client
import ipaddress
import ssl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bind', required=True)
    parser.add_argument('--port', type=int, default=18188)
    parser.add_argument('--cert', required=True)
    parser.add_argument('--key', required=True)
    args = parser.parse_args()
    address = ipaddress.ip_address(args.bind)
    if not address.is_private or address.is_unspecified:
        parser.error('Bind to a specific private LAN address')
    public_origin = f'https://{args.bind}:{args.port}'
    upstream_origin = 'http://localhost:18187'
    hop = {'connection','transfer-encoding','keep-alive','proxy-authenticate',
           'proxy-authorization','te','trailer','upgrade','host','content-length'}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def forward(self):
            if self.headers.get('Host') != f'{args.bind}:{args.port}':
                self.send_error(400); return
            origin = self.headers.get('Origin')
            if origin and origin != public_origin:
                self.send_error(403); return
            if self.headers.get('Transfer-Encoding'):
                self.send_error(400); return
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                self.send_error(400); return
            if not 0 <= length <= 40*1024*1024:
                self.send_error(413); return
            headers = {k:v for k,v in self.headers.items() if k.lower() not in hop}
            headers['Host'] = 'localhost:18187'
            if origin:
                headers['Origin'] = upstream_origin
            headers['Content-Length'] = str(length)
            target = urlsplit(self.path)
            if target.scheme or target.netloc:
                self.send_error(400); return
            connection = http.client.HTTPConnection('127.0.0.1',18187,timeout=330)
            try:
                connection.request(self.command,self.path,self.rfile.read(length),headers)
                response=connection.getresponse(); data=response.read()
                self.send_response(response.status)
                for k,v in response.getheaders():
                    if k.lower() in hop: continue
                    if k.lower()=='location' and v.startswith(upstream_origin+'/'):
                        v=public_origin+v[len(upstream_origin):]
                    self.send_header(k,v)
                self.send_header('Content-Length',str(len(data)))
                self.end_headers()
                if self.command!='HEAD': self.wfile.write(data)
            except (OSError,http.client.HTTPException):
                self.send_error(502)
            finally:
                connection.close()
        do_GET=do_POST=do_PUT=do_DELETE=do_PATCH=do_HEAD=forward

    server=ThreadingHTTPServer((args.bind,args.port),Handler)
    context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version=ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(args.cert,args.key)
    server.socket=context.wrap_socket(server.socket,server_side=True)
    print(f'Local mobile QA: {public_origin}/goods',flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()


if __name__=='__main__': main()
