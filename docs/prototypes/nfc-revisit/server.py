"""Isolated synthetic NFC HTTP adapter for the actual compiled frontend. No DB, keys or external APIs."""
import argparse
import json
import threading
from datetime import datetime, timezone, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit,parse_qs

TAG='11111111-1111-4111-8111-111111111111'
KEY='synthetic_demo_viewing_key_never_real_123456789'
IDS=[f'{n:08d}-2222-4222-8222-222222222222' for n in range(1,4)]
captions=['함께 나누던 이야기와 그날의 풍경.','함께 웃으며 이야기를 나누던 오후.','햇살 아래 함께 앉아 오래 나눴던 이야기.']

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True);parser.add_argument('--port',type=int,default=18214);parser.add_argument('--bind',default='127.0.0.1');args=parser.parse_args()
 root=args.root.resolve();assert (root/'index.html').is_file() and (root/'_demo-group.jpg').is_file()
 controls=(Path(__file__).parent/'controls.js').read_bytes();lock=threading.Lock();state={'revision':0,'number':0,'grants':{}}
 class Handler(SimpleHTTPRequestHandler):
  def __init__(self,*a,**kw):super().__init__(*a,directory=str(root),**kw)
  def log_message(self,*a):pass
  def reply(self,status,data,mime='application/json'):
   raw=json.dumps(data,ensure_ascii=False).encode() if mime=='application/json' else data
   self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Cache-Control','no-store');self.send_header('Referrer-Policy','no-referrer');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
  def do_GET(self):
   path=urlsplit(self.path).path;tools=parse_qs(urlsplit(self.path).query).get('tools')==['1']
   if path=='/':self.send_response(302);self.send_header('Location',f"/nfc/{TAG}{'?tools=1' if tools else ''}#key={KEY}");self.end_headers();return
   if path.startswith('/nfc/'):
    html=(root/'index.html').read_text()
    if tools:html=html.replace('</body>','<script defer src="/__demo/controls.js"></script></body>')
    self.reply(200,html.encode(),'text/html; charset=utf-8');return
   if path=='/__demo/controls.js':self.reply(200,controls,'text/javascript');return
   if path.startswith('/api/v1/nfc/media/'):
    token=self.headers.get('X-Mori-Viewer-Token','')
    with lock:expiry=state['grants'].get(token)
    if expiry is None or expiry<=datetime.now(timezone.utc):self.reply(401,{'error':{'code':'NFC_SESSION_REQUIRED'}});return
    if path.rsplit('/',1)[-1] not in IDS:self.reply(404,{});return
    self.reply(200,(root/'_demo-group.jpg').read_bytes(),'image/jpeg');return
   if path.startswith('/api/') or path.startswith('/__demo/'):self.reply(404,{});return
   super().do_GET()
  def do_POST(self):
   path=urlsplit(self.path).path
   try:
    size=int(self.headers.get('Content-Length','0'))
    if not 0<=size<=4096:self.reply(413,{});return
    body=json.loads(self.rfile.read(size) or b'{}')
   except (ValueError,TypeError):self.reply(400,{});return
   if path=='/__demo/edit':
    with lock:state['revision']+=1;revision=state['revision']
    self.reply(200,{'revision':revision});return
   if path=='/api/v1/nfc/close':
    with lock:state['grants'].pop(body.get('token'),None)
    self.reply(204,b'','text/plain');return
   if path==f'/api/v1/nfc/tags/{TAG}/enter' and body.get('token')==KEY:
    with lock:
     expiry=datetime.now(timezone.utc)+timedelta(hours=2);state['number']+=1;token='synthetic_session_'+str(state['number']).zfill(32);state['grants'][token]=expiry;revision=state['revision']
    self.reply(200,{'data':{'state':'ready','session_token':token,'expires_at':expiry.isoformat(timespec='seconds'),'album_title':'가상 추억책 체험','music_url':None,'pages':[{'id':identity,'text':captions[revision%len(captions)],'src':f'/api/v1/nfc/media/{identity}','thumb':f'/api/v1/nfc/media/{identity}'} for identity in IDS]}});return
   self.reply(404,{'error':{'code':'RESOURCE_NOT_FOUND'}})
 print(f'Synthetic-only NFC frontend demo: {args.bind}:{args.port}',flush=True)
 ThreadingHTTPServer((args.bind,args.port),Handler).serve_forever()

if __name__=='__main__':main()
