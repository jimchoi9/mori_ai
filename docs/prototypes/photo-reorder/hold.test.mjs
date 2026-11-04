import test from 'node:test';
import assert from 'node:assert/strict';
import {createHold,HOLD_MS} from './hold.mjs';
function clock(){let now=0,serial=0;const tasks=new Map();return {setTimer(f,delay){tasks.set(++serial,{f,at:now+delay});return serial;},clearTimer(id){tasks.delete(id);},advance(ms){now+=ms;for(const [id,task] of [...tasks])if(task.at<=now){tasks.delete(id);task.f();}}};}
test('a new press activates at300ms, not before',()=>{
 const time=clock();let calls=0;createHold({blocked:()=>false,activate:()=>calls++,...time});assert.equal(HOLD_MS,300);time.advance(299);assert.equal(calls,0);time.advance(1);assert.equal(calls,1);
});
test('a press that began during saving resumes immediately after unlock',()=>{
 const time=clock();let busy=true,calls=0;const hold=createHold({blocked:()=>busy,activate:()=>calls++,...time});time.advance(300);assert.equal(calls,0);busy=false;hold.resume();assert.equal(calls,1);hold.resume();assert.equal(calls,1);
});
test('finishing a save before300ms does not shorten the required press',()=>{
 const time=clock();let busy=true,calls=0;const hold=createHold({blocked:()=>busy,activate:()=>calls++,...time});time.advance(100);busy=false;hold.resume();assert.equal(calls,0);time.advance(199);assert.equal(calls,0);time.advance(1);assert.equal(calls,1);
});
test('release or scroll cancellation while saving never activates later',()=>{
 const time=clock();let busy=true,calls=0;const hold=createHold({blocked:()=>busy,activate:()=>calls++,...time});time.advance(300);hold.cancel();busy=false;hold.resume();time.advance(1000);assert.equal(calls,0);
});
