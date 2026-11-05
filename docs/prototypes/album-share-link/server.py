"""Local UI comparison, synthetic albums only. No product APIs, DB, AI or mail."""
import argparse
import json
import secrets
import ssl
import threading
import time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from model import DemoModel,DemoError

ASSETS={name:('text/css' if name.endswith('.css') else 'text/javascript' if name.endswith(('.js','.mjs')) else 'image/svg+xml' if name.endswith('.svg') else 'text/plain') for name in (
 'app.css','preview.css','preview.js','visitor.js','bookPhotos.mjs','bookEnding.mjs',
 'page-flip.js','book.js','page-flip-LICENSE.txt','nfc.css','bookEnding.css',
 'photo-1.svg','photo-2.svg','photo-3.svg')}

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True);parser.add_argument('--lan',required=True)
 parser.add_argument('--port',type=int,default=18230);parser.add_argument('--https-port',type=int,default=18231)
 parser.add_argument('--cert',type=Path);parser.add_argument('--key',type=Path)
 args=parser.parse_args();root=args.root.resolve()
 source=Path(__file__).resolve().parent
 def asset(name):return (root/'assets'/name).read_bytes(),ASSETS[name]+'; charset=utf-8'
 html=(source/'index.html').read_bytes();public=(source/'viewer.html').read_bytes()
 access=root/'access.json'
 if access.exists():owner=json.loads(access.read_text())['owner']
 else:
  owner=secrets.token_urlsafe(24)
  with access.open('x') as f:access.chmod(0o600);json.dump({'owner':owner},f)
 prefix='/review/'+owner+'/'
 model=DemoModel();lock=threading.RLock()
 allowed_hosts={f'{ip}:{port}' for ip in (args.lan,'127.0.0.1','localhost') for port in (args.port,args.https_port)}
 class Handler(BaseHTTPRequestHandler):
  def log_message(self,*_):pass
  def reply(self,status,body,mime='application/json; charset=utf-8'):
   if not isinstance(body,bytes):body=json.dumps(body,ensure_ascii=False).encode()
   self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(body)))
   self.send_header('Cache-Control','no-store');self.send_header('Referrer-Policy','no-referrer');self.send_header('X-Content-Type-Options','nosniff')
   self.send_header('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
   self.end_headers()
   if self.command!='HEAD':self.wfile.write(body)
  def owner_ok(self):return secrets.compare_digest(self.headers.get('X-Prototype-Owner',''),owner)
  def do_GET(self):
   url=urlsplit(self.path);path=url.path
   if self.headers.get('Host') not in allowed_hosts:return self.reply(400,{'error':'HOST_REQUIRED'})
   if path==prefix and not url.query:return self.reply(200,html,'text/html; charset=utf-8')
   if path.startswith('/assets/'):
    name=path.removeprefix('/assets/')
    return self.reply(200,*asset(name)) if name in ASSETS else self.reply(404,{})
   if path.startswith('/nfc/') and len(path.split('/'))==3:return self.reply(200,public,'text/html; charset=utf-8')
   if path=='/albums':return self.reply(200,public,'text/html; charset=utf-8')
   if path=='/demo/owner/state':
    if not self.owner_ok():return self.reply(401,{'error':'OWNER_REQUIRED'})
    with lock:return self.reply(200,{mode:model.summary(mode) for mode in 'abc'})
   if path.startswith('/demo/media/'):
    try:
     with lock:name=model.media(self.headers.get('X-Demo-Viewer',''),path.removeprefix('/demo/media/'))
     return self.reply(200,*asset(name))
    except DemoError as e:return self.reply(e.status,{'error':e.code})
   self.reply(404,{})
  def do_POST(self):
   path=urlsplit(self.path).path;host=self.headers.get('Host')
   scheme='https' if isinstance(self.connection,ssl.SSLSocket) else 'http'
   if host not in allowed_hosts or self.headers.get('Origin')!=f'{scheme}://{host}':return self.reply(403,{'error':'ORIGIN_REQUIRED'})
   try:
    length=int(self.headers.get('Content-Length','0'))
    if not 0<=length<=4096:return self.reply(413,{})
    body=json.loads(self.rfile.read(length) or b'{}')
    if not isinstance(body,dict):raise ValueError()
   except (ValueError,TypeError):return self.reply(400,{})
   try:
    if path=='/demo/enter':
     with lock:result=model.enter(body.get('id'),body.get('key'))
     return self.reply(200,result)
    if not path.startswith('/demo/owner/') or not self.owner_ok():return self.reply(401,{'error':'OWNER_REQUIRED'})
    mode=body.get('mode')
    if mode not in ('a','b','c'):raise DemoError('INVALID_VARIANT')
    if path.endswith('/issue') and model.variants[mode].scenario=='slow':time.sleep(.9)
    with lock:
     action=path.removeprefix('/demo/owner/')
     if action=='setup':result=model.setup(mode,body.get('scenario'))
     elif action=='prepare':result=model.prepare(mode)
     elif action=='preview':result=model.read_book(model.variants[mode],owner=True)
     elif action=='issue':result=model.issue(mode)
     elif action=='active':
      if type(body.get('active')) is not bool:raise DemoError('INVALID_STATE')
      result=model.active(mode,body['active'])
     elif action=='update':result=model.update(mode)
     else:raise DemoError('NOT_FOUND',404)
    return self.reply(200,result)
   except DemoError as e:self.reply(e.status,{'error':e.code})
 servers=[]
 for bind in dict.fromkeys((args.lan,'127.0.0.1')):
  server=ThreadingHTTPServer((bind,args.port),Handler);servers.append(server)
  if args.cert and args.key:
   secure=ThreadingHTTPServer((bind,args.https_port),Handler)
   context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(args.cert,args.key)
   secure.socket=context.wrap_socket(secure.socket,server_side=True);servers.append(secure)
 for server in servers:threading.Thread(target=server.serve_forever,daemon=True).start()
 (root/'access.json').write_text(json.dumps({'owner':owner,'path':prefix,'http':f'http://{args.lan}:{args.port}{prefix}','https':f'https://{args.lan}:{args.https_port}{prefix}' if args.cert else None},indent=2))
 access.chmod(0o600)
 print('Synthetic share comparison ready. Private launch URLs are in access.json.',flush=True)
 try:threading.Event().wait()
 except KeyboardInterrupt:
  for server in servers:server.shutdown()

if __name__=='__main__':main()
