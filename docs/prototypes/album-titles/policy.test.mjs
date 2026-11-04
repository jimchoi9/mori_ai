import test from 'node:test';import assert from 'node:assert/strict';import {initialTitle,acceptAuto,rename,capturePeriod} from './policy.mjs';
test('no title entry is required; dates are kept outside the title',()=>{assert.equal(initialTitle({}).title,'새 앨범');assert.equal(capturePeriod({capture_period:['2026-10-11','2026-10-12']}),'2026.10.11 – 2026.10.12');});
test('user rename wins over delayed automatic response',()=>{const initial=initialTitle({}),edited=rename(initial,'나의 기장');assert.strictEqual(acceptAuto(edited,'기장 여행',1),edited);});
test('new photos do not overwrite an accepted automatic title',()=>{const named=acceptAuto(initialTitle({}),'기장 여행');assert.strictEqual(acceptAuto({...named,revision:2},'다른 제목',2).title,'기장 여행');});
test('stale photo revision cannot name newer content',()=>{const next={...initialTitle({}),revision:2};assert.strictEqual(acceptAuto(next,'오래된 사진 제목',1),next);});
test('preexisting user title is preserved before and after automatic processing',()=>{const named=initialTitle({manual_title:'우리의 여름'});assert.strictEqual(acceptAuto(named,'기장 여행'),named);});
test('file modified time is never displayed as capture time',()=>{assert.equal(capturePeriod({file_modified:'2026-11-03'}),'');});
test('same short titles remain distinguishable using separate capture periods',()=>{const a={capture_period:['2026-10-11','2026-10-11']},b={capture_period:['2026-11-01','2026-11-02']};assert.notEqual(capturePeriod(a),capturePeriod(b));});
test('rename cancellation can keep original; invalid save cannot erase it',()=>{const named=acceptAuto(initialTitle({}),'기장 여행');assert.throws(()=>rename(named,'  '));assert.equal(named.title,'기장 여행');});
