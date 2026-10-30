import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import {rm} from 'node:fs/promises';
await build({entryPoints:['src/features/auth/oauth.ts'],bundle:true,platform:'node',format:'esm',outfile:'admin-oauth-check.mjs'});
const oauth=await import(pathToFileURL(`${process.cwd()}/admin-oauth-check.mjs`));
test('admin login returns to exact private route only',()=>{
 assert.match(oauth.oauthLoginUrl('google','/admin'),/return_to=%2Fadmin$/);
 for(const path of ['/administrator','/admin/','//evil.test','https://evil.test','/admin?x=1'])assert.match(oauth.oauthLoginUrl('google',path),/return_to=%2Fgoods$/);
});
test('admin route precedes product side effects and has no menu link',async()=>{
 const app=await readFile('src/App.tsx','utf8');
 assert.ok(app.indexOf("location.pathname==='/admin'")<app.indexOf('return <><GiftTokenCapture'));
 assert.doesNotMatch(app,/<Link[^>]+to=["']\/admin/);
 const gate=await readFile('src/features/admin/AdminGate.tsx','utf8');
 assert.doesNotMatch(gate,/goods\/claim|goods\/guest-session|\/consents/);
});
test.after(()=>rm('admin-oauth-check.mjs',{force:true}));
