"""Synthetic interaction model only. Never imports product models, storage or settings."""
from copy import deepcopy
from dataclasses import dataclass,field
import secrets
import time
from uuid import uuid4

SCENARIOS={
 'ready':'첫 공유', 'existing':'이미 만든 링크', 'empty':'사진이 없는 앨범',
 'pending':'사진 저장 중', 'caption_missing':'글귀 한 개 미완료',
 'create_failure':'발급 실패 후 재시도', 'lost_reply':'발급 후 응답 끊김',
 'copy_failure':'복사 실패', 'save_failure':'수정 내용 저장 실패', 'slow':'느린 발급 중 닫기',
 'long_title':'긴 앨범 이름', 'paused':'공유 일시 중지',
}

class DemoError(Exception):
 def __init__(self,code,status=400):self.code,self.status=code,status

@dataclass
class Album:
 variant:str
 scenario:str
 id:str=field(default_factory=lambda:str(uuid4()))
 title:str='함께한 여름 · 체험용 앨범'
 revision:int=1
 tag:str|None=None
 key:str|None=None
 active:bool=False
 issues:int=0
 attempts:int=0
 prepares:int=0
 saved:bool=True
 pending:bool=False
 photos:list=field(default_factory=list)

class DemoModel:
 def __init__(self):
  self.variants={};self.tags={};self.grants={}
  for mode in 'abc':self.setup(mode,'ready')
 def setup(self,mode,scenario):
  if mode not in ('a','b','c') or not isinstance(scenario,str) or scenario not in SCENARIOS:raise DemoError('INVALID_SCENARIO')
  album=Album(mode,scenario)
  if scenario=='long_title':album.title='오랜만에 함께 모여 천천히 걸으며 남긴 우리 가족의 아주 긴 여름 이야기'
  count=0 if scenario=='empty' else 48 if scenario=='caption_missing' else 3
  album.photos=[{'id':f'{album.id}-{i+1}','asset':f'photo-{i%3+1}.svg','text':'' if scenario=='caption_missing' and i==23 else ['해 질 무렵, 함께 걷던 길.','바람이 부는 바다 앞에서.','오랜만에 모여 남긴 사진.'][i%3]} for i in range(count)]
  album.pending=scenario=='pending';album.saved=scenario!='save_failure'
  self.variants[mode]=album
  if scenario in ('existing','paused'):
   self._mint(album);album.active=scenario!='paused'
  return self.summary(mode)
 def _mint(self,a):
  if a.tag:return
  a.tag=str(uuid4());a.key=secrets.token_urlsafe(32);a.active=True;a.issues+=1;self.tags[a.tag]=a
 def summary(self,mode):
  a=self.variants.get(mode)
  if a is None:raise DemoError('INVALID_VARIANT')
  return {'variant':mode,'scenario':a.scenario,'album_id':a.id,'title':a.title,'revision':a.revision,
   'count':len(a.photos),'photos':deepcopy(a.photos),'pending':a.pending,'saved':a.saved,
   'link':f'/nfc/{a.tag}#key={a.key}' if a.tag else None,'active':a.active,'issues':a.issues,'attempts':a.attempts}
 def prepare(self,mode):
  a=self.variants[mode];a.prepares+=1
  if not a.saved:
   if a.prepares==1:raise DemoError('SAVE_FAILED',503)
   a.saved=True;a.revision+=1
   if a.photos:a.photos[0]['text']='수정한 글귀도 저장한 뒤 함께 나눴다.'
  return self.summary(mode)
 def issue(self,mode):
  a=self.variants[mode]
  if not a.saved:raise DemoError('SAVE_REQUIRED',409)
  a.attempts+=1
  if a.scenario=='create_failure' and a.attempts==1:raise DemoError('ISSUE_FAILED',503)
  self._mint(a)
  if a.scenario=='lost_reply' and a.attempts==1:raise DemoError('REPLY_LOST',503)
  return self.summary(mode)
 def active(self,mode,value):
  a=self.variants[mode]
  if not a.tag:raise DemoError('NO_LINK',409)
  a.active=value
  return self.summary(mode)
 def update(self,mode):
  a=self.variants[mode];a.pending=False;a.saved=True;a.revision+=1
  if not a.photos:a.photos=[{'id':f'{a.id}-1','asset':'photo-1.svg','text':'새로 담은 첫 기억.'}]
  else:a.photos[0]['text']=f'새로 저장한 {a.revision}번째 기억.'
  return self.summary(mode)
 def enter(self,tag,key):
  a=self.tags.get(tag) if isinstance(tag,str) else None
  if a is None or not isinstance(key,str) or not key.isascii() or not secrets.compare_digest(a.key,key):raise DemoError('NOT_FOUND',404)
  if not a.active:return {'state':'paused'}
  return self.read_book(a)
 def read_book(self,a,owner=False):
  if not a.photos or a.pending:return {'state':'preparing'}
  token=secrets.token_urlsafe(32);pages=deepcopy(a.photos)
  self.grants[token]={'album':a,'expires':time.time()+7200,'pages':pages,'owner':owner}
  return {'state':'ready','album_title':a.title,'revision':a.revision,'session_token':token,
   'pages':[{'id':p['id'],'text':p['text'],'src':'/demo/media/'+p['id']} for p in pages]}
 def media(self,token,identity):
  grant=self.grants.get(token)
  if not grant or grant['expires']<=time.time() or (not grant['owner'] and not grant['album'].active):raise DemoError('VIEWER_REQUIRED',401)
  row=next((p for p in grant['pages'] if p['id']==identity),None)
  if row is None:raise DemoError('NOT_FOUND',404)
  return row['asset']
