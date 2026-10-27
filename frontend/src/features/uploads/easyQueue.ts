import type {PreparedFile} from './preprocess';

export type SendState='selected'|'preparing'|'waiting'|'sending'|'checking'|'saved'|'failed';
export interface SendItem {id:string;file:File;state:SendState;error?:string;prepared?:PreparedFile;pageId?:string;transferred?:boolean}
export interface QueueSteps<T extends SendItem> {
 prepare:(item:T,signal:AbortSignal)=>Promise<PreparedFile>;
 transfer:(item:T,signal:AbortSignal)=>Promise<void>;
 verify?:(item:T,signal:AbortSignal)=>Promise<void>;
 changed:()=>void;
}
/** One preparation ahead of one transfer. Failed photos never stop the remaining queue. */
export async function sendPhotos<T extends SendItem>(items:T[],signal:AbortSignal,steps:QueueSteps<T>) {
 const pending=items.filter(item=>item.state!=='saved');
 async function prepare(item:T){
  try{
   signal.throwIfAborted();item.error=undefined;
   if(!item.prepared){item.state='preparing';steps.changed();item.prepared=await steps.prepare(item,signal);}
   signal.throwIfAborted();item.state='waiting';steps.changed();return true;
  }catch(error){if(!signal.aborted){item.state='failed';item.error=error instanceof Error?error.message:'사진을 준비하지 못했어요.';steps.changed();}return false;}
 }
 let next=pending.length?prepare(pending[0]):Promise.resolve(false);
 const confirmations=[Promise.resolve(),Promise.resolve()];let confirmationIndex=0;
 async function confirm(item:T){
  try{signal.throwIfAborted();if(steps.verify)await steps.verify(item,signal);signal.throwIfAborted();item.state='saved';item.prepared=undefined;}
  catch(error){if(!signal.aborted){item.state='failed';item.error=error instanceof Error?error.message:'사진 저장을 확인하지 못했어요.';}}
  steps.changed();
 }
 try{
  for(let index=0;index<pending.length;index++){
   const ready=await next;signal.throwIfAborted();
   // No unhandled speculative rejection, and at most one next decoded image.
   next=index+1<pending.length?prepare(pending[index+1]):Promise.resolve(false);
   if(!ready)continue;
   const item=pending[index];item.state='sending';steps.changed();
   try{await steps.transfer(item,signal);signal.throwIfAborted();item.state='checking';steps.changed();
    const lane=confirmationIndex++%2;confirmations[lane]=confirmations[lane].then(()=>confirm(item));}
   catch(error){if(signal.aborted)throw error;item.state='failed';item.error=error instanceof Error?error.message:'연결을 확인하고 다시 보내 주세요.';steps.changed();}
  }
 }finally{
  await next;await Promise.all(confirmations);
  if(signal.aborted)for(const item of pending)if(!['saved','failed'].includes(item.state))item.state='waiting';
  steps.changed();
 }
}
