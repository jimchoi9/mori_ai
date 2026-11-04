"""Actual frontend, synthetic management API. No real accounts, DB, uploads or AI."""
import argparse
import copy
import json
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ALBUM='11111111-3333-4333-8333-333333333333'
BASE=f'/api/v1/albums/{ALBUM}'

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True);parser.add_argument('--port',type=int,default=18216);parser.add_argument('--bind',default='127.0.0.1');args=parser.parse_args();root=args.root.resolve()
 assert (root/'index.html').is_file()
 art=json.loads((root/'_demo-art.json').read_text());lock=threading.Lock()
 pages=[{'id':f'{i+1:08d}-4444-4444-8444-444444444444','position':i,'version':1,'upload_status':'ready','caption_status':'succeeded','caption_edited':False,'caption_text':['햇살 아래 느긋하게 걸었던 하루.','잠시 멈춰 바라본 푸른 풍경.','따뜻한 차 한 잔과 함께한 오후.'][i%3]+('\n다음에도 함께 오고 싶은 곳.' if i%4==2 else ''),'source':{'asset_id':str(i),'mime':'image/svg+xml','width':600,'height':400},'thumbnail':None,'result':None,'sort_date':'2026-10-25T00:00:00Z','sort_date_source':'exif'} for i in range(20)]
 state={'version':1,'pages':pages,'mode':'manual','manual':[p['id'] for p in pages],'fail':False,'delay':.8,'writes':0}
 def detail():
  with lock:
   return {'detail':{'album':{'id':ALBUM,'title':'순서 변경 체험용 앨범','content_enabled':True,'content_ready':True,'status':'draft','version':state['version'],'page_count':len(state['pages']),'cover':None,'created_at':'2026-10-25T00:00:00Z','updated_at':'2026-10-25T00:00:00Z','published_at':None},'pages':copy.deepcopy(state['pages']),'order_mode':state['mode'],'active_run_id':None,'generation_mode':'local_fake'},'media_access':[{'asset_id':str(i),'url':src,'expires_at':'2099-01-01T00:00:00Z'} for i,src in enumerate(art)]}
 class Handler(SimpleHTTPRequestHandler):
  def __init__(self,*a,**kw):super().__init__(*a,directory=str(root),**kw)
  def log_message(self,*a):pass
  def reply(self,status,data,mime='application/json'):
   raw=json.dumps(data,ensure_ascii=False).encode() if mime=='application/json' else data
   self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
  def ok(self,data):self.reply(200,{'data':data})
  def do_GET(self):
   path=urlsplit(self.path).path
   if path=='/':self.send_response(302);self.send_header('Location',f'/albums/{ALBUM}/manage');self.end_headers();return
   if path.startswith('/albums'):self.reply(200,(root/'index.html').read_bytes(),'text/html; charset=utf-8');return
   if path==BASE:self.ok(detail());return
   if path=='/api/v1/me':self.ok({'user':{'id':'synthetic-owner','display_name':'체험 계정'},'csrf_token':'synthetic-only','consent':{'required':False,'policy_version':'demo','notice':''},'access':{'allowed':True,'mode':'all_authenticated'}});return
   if path=='/api/dev/config':self.ok({'dev_auth_enabled':False,'dev_ai_enabled':False,'generation_enabled':False,'generation_mode':'local_fake'});return
   if path=='/api/v1/client-config':self.ok({'album_content_enabled':True,'auth_providers':[],'easy_upload':{'enabled':True,'max_photos':50},'album_max_photos':50,'upload_allowed_extensions':[],'upload_allowed_mimes':[],'upload_max_file_bytes':20000000,'upload_max_album_bytes':300000000});return
   if path.startswith('/api/v1/goods/purchases/by-album/'):self.ok({'purchase_id':None});return
   if path=='/__demo/state':self.reply(200,{'ids':[p['id'] for p in detail()['detail']['pages']],'writes':state['writes']});return
   if path.startswith('/api/') or path.startswith('/__demo/'):self.reply(404,{});return
   super().do_GET()
  def body(self):
   size=int(self.headers.get('Content-Length','0'))
   if not 0<=size<=20000:raise ValueError()
   return json.loads(self.rfile.read(size) or b'{}')
  def write(self):
   path=urlsplit(self.path).path
   try:body=self.body()
   except (ValueError,TypeError):self.reply(400,{});return
   if path=='/__demo/fail':
    with lock:state['fail']=True
    self.reply(200,{});return
   if path.startswith(BASE):
    time.sleep(state['delay'])
    with lock:
     if state['fail']:state['fail']=False;self.reply(409,{'error':{'code':'ALBUM_VERSION_CONFLICT'}});return
     if path==BASE+'/page-order' and self.command=='PUT':
      ids=body.get('page_ids',[]);old={p['id']:p for p in state['pages']}
      if body.get('expected_version')!=state['version'] or len(ids)!=len(old) or set(ids)!=set(old):self.reply(409,{});return
      state['pages']=[old[id] for id in ids];state['manual']=ids;state['mode']='manual';state['writes']+=1;state['version']+=1
     elif path in [BASE+'/date-order',BASE+'/manual-order'] and self.command=='POST':
      if body.get('expected_version')!=state['version']:self.reply(409,{});return
      ids=sorted(p['id'] for p in state['pages']) if path.endswith('/date-order') else state['manual'];old={p['id']:p for p in state['pages']};state['pages']=[old[id] for id in ids];state['mode']='date' if path.endswith('/date-order') else 'manual';state['version']+=1
     elif '/caption' in path and self.command=='PATCH':
      page=next((p for p in state['pages'] if p['id']==path.split('/')[-2]),None)
      if not page or page['version']!=body.get('expected_version'):self.reply(409,{});return
      page.update(caption_text=body.get('caption_text',''),caption_edited=True,version=page['version']+1);state['version']+=1
     else:self.reply(422,{'error':{'code':'DEMO_ONLY'}});return
     for index,page in enumerate(state['pages']):page['position']=index
    if self.command=='PATCH':self.ok({'page':copy.deepcopy(page)});return
    self.ok(detail());return
   self.reply(422,{'error':{'code':'DEMO_ONLY'}})
  do_POST=write;do_PUT=write;do_PATCH=write
 print(f'Synthetic actual management frontend: {args.bind}:{args.port}',flush=True)
 ThreadingHTTPServer((args.bind,args.port),Handler).serve_forever()
if __name__=='__main__':main()
