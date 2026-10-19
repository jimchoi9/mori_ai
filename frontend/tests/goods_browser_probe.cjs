// Standalone local probe: real React/Canvas, mocked owner HTTP, synthetic images only.
// G3_BUNDLE points to a bundle mounting GoodsWorkspace and exporting prepareGoodsSource.
// G3_FIXTURES contains normal.jpg, boundary40mp.jpg, over48mp.jpg; G3_PREVIOUS_FIXTURES
// contains plain.png/plain.webp/highres20mp.jpg/highres20mp.png/iphone.heic.
const fs=require('node:fs'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.G3_PLAYWRIGHT);
const directory=process.env.G3_FIXTURES,previous=process.env.G3_PREVIOUS_FIXTURES;
const image=fs.readFileSync(previous+'/plain.webp');
const bundle=fs.readFileSync(process.env.G3_BUNDLE);
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?bundle:'<div id="root"></div><script type="module">import * as app from "/app.js";window.app=app;</script>');});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`,results=[];
try{for(const [name,engine] of [['chromium',chromium],['webkit',webkit]].filter(([name])=>!process.env.G3_BROWSERS||process.env.G3_BROWSERS.split(',').includes(name))){
 let browser,watchdog;const row={browser:name};results.push(row);
 try{browser=await engine.launch({headless:true,timeout:15000,...(name==='chromium'?{executablePath:process.env.G3_CHROMIUM}: process.env.G3_WEBKIT?{executablePath:process.env.G3_WEBKIT}:{})});watchdog=setTimeout(()=>{row.timeout=true;void browser.close();},60000);const page=await browser.newPage();page.setDefaultTimeout(15000);let count=0,failure=null;const calls=[];
 await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method();if(url.origin!==origin)return route.abort();
 if(path.startsWith('/api/')){calls.push({path,method});let data;
 if(path.endsWith('/catalog'))data={styles:[{id:'book',label:'책 모양',hint:'합성 검증'}]};
 else if(path==='/api/v1/goods/work'&&method==='POST')data={id:++count===1?'old':`candidate-${count}`};
 else if(method==='DELETE')return route.fulfill({status:204});
 else if(path.endsWith('/source')){if(path.includes('candidate-')&&failure){if(failure==='network')return route.abort();return route.fulfill({status:failure,contentType:'application/json',body:JSON.stringify({error:{code:'IMAGE_DECODE_FAILED'}})});}return route.fulfill({status:200,contentType:'image/webp',body:method==='PUT'?Buffer.from(''):image});}
 else data={revisions:[{id:'revision',request_key:'k',message:'original revision',style:'book',status:'ready',image_url:'/revision.webp',fake:false}]};
 return route.fulfill({contentType:'application/json',body:JSON.stringify({data})});}
 if(path.endsWith('.webp'))return route.fulfill({contentType:'image/webp',body:image});return route.continue();});
 page.on('dialog',dialog=>dialog.accept());await page.goto(origin);await page.waitForFunction(()=>window.app);
 row.preprocess=[];
 for(const [root,file,type,expected] of [[directory,'normal.jpg','image/jpeg',true],[previous,'plain.png','image/png',true],[previous,'plain.webp','image/webp',null],[previous,'highres20mp.jpg','image/jpeg',true],[previous,'highres20mp.png','image/png',false],[directory,'boundary40mp.jpg','image/jpeg',true],[directory,'over48mp.jpg','image/jpeg',false],[previous,'iphone.heic','image/heic',false],[previous,'iphone.heic','',false]]){
 const result=await page.evaluate(async({data,file,type})=>{const f=new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],file,{type});const out=await window.app.prepareGoodsSource(f,new AbortController().signal);let size=null;if(out!==f){const b=await createImageBitmap(out);size=[b.width,b.height];b.close();}return {file,type,processed:out!==f,bytes:out.size,size};},{data:fs.readFileSync(root+'/'+file).toString('base64'),file,type});
 // WebKit may legitimately fallback when createImageBitmap resize/encoding is unsupported.
 if(expected===false)assert.equal(result.processed,false);if(name==='chromium'&&expected===true)assert.equal(result.processed,true);if(result.size)assert.ok(Math.max(...result.size)<=2048);row.preprocess.push(result);
 }
 await page.getByRole('button',{name:/책 모양/}).click();await page.getByRole('button',{name:'이 모양으로 시작하기',exact:true}).click();
 await page.locator('input[type=file]').setInputFiles(directory+'/normal.jpg');await page.getByRole('button',{name:'선택한 시안',exact:true}).waitFor();
 await page.locator('#goods-request').fill('preserve draft');
 await page.waitForFunction(()=>!document.body.textContent.includes('미리보기를 만들고 있어요.'));
 const before=await page.locator('canvas').evaluate(c=>c.toDataURL());row.replacements=[];
 for(const mode of [422,401,403,500,503,'network','preprocess']){failure=mode==='preprocess'?null:mode;const start=count;
 await page.locator('input[type=file]').setInputFiles(mode==='preprocess'?{name:'oversized.jpg',mimeType:'image/jpeg',buffer:Buffer.alloc(20*1024*1024+1)}:directory+'/normal.jpg');
 await page.getByRole('alert').first().waitFor();await page.getByRole('button',{name:'사진 바꾸기',exact:true}).waitFor();
 assert.equal(await page.locator('#goods-request').inputValue(),'preserve draft');assert.equal(await page.getByRole('button',{name:'선택한 시안',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await page.locator('canvas').evaluate(c=>c.toDataURL()),before);
 assert.ok(!calls.some(c=>c.method==='DELETE'&&c.path.endsWith('/old')));
 if(mode==='preprocess')assert.equal(count,start);else {await page.waitForTimeout(50);assert.ok(calls.some(c=>c.method==='DELETE'&&c.path.endsWith(`/candidate-${count}`)));}row.replacements.push({mode,preserved:true});}
 await page.evaluate(()=>window.unmount());await page.waitForTimeout(50);assert.ok(calls.some(c=>c.method==='DELETE'&&c.path.endsWith('/old')));row.unmountDiscard=true;row.status='passed';
 }catch(error){row.status='failed';row.error=String(error.stack||error);process.exitCode=1;}finally{clearTimeout(watchdog);await browser?.close();}
 }}finally{server.close();fs.writeFileSync(process.env.G3_RESULT,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));}})();
