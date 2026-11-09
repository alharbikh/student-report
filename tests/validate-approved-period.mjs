import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const dashboard=fs.readFileSync('قالب_مرصد_غياب_الطلاب.html','utf8');
const unlock=fs.readFileSync('reports/unlock.js','utf8');
new vm.Script(unlock,{filename:'reports/unlock.js'});
const section=(start,end)=>{
 const i=dashboard.indexOf(start),j=dashboard.indexOf(end,i+start.length);
 assert.ok(i>=0&&j>i,'Missing source '+start);
 return dashboard.slice(i,j);
};
const db={school:'مدرسة تجريبية',source:'test.xlsx',students:[
 ['1','الطالب أ','اول 1',1],['2','الطالب ب','ثاني 1',2]],
 dates:['2026-11-05','2026-11-08','2026-11-09','2026-11-10'],
 events:[[0,0],[0,1],[0,2],[1,3]]};
const state={start:'2026-11-05',end:'2026-11-10',grade:'all',cls:'all',threshold:15,skipAnomaly:false};
const mockCalc={allowed:[0,1],activeDates:['2026-11-05','2026-11-08','2026-11-10'],
 filtered:[[0,0],[0,1],[1,3]],schoolDayCount:3,manuallyExcludedEvents:1};
const source=section('function makeApprovedSnapshot(){','function snapshotMessage(');
const create=vm.runInNewContext(source+'\nmakeApprovedSnapshot',{
 IS_APPROVED_REPORT:false,state,DB:db,calculate:()=>mockCalc,Set,Map,Object,Date,
 holidayDates:()=>['2026-11-09'],isWeekday:iso=>new Date(iso+'T00:00:00Z').getUTCDay()<5,
 savedHolidays:{'2026-11-09':'إجازة مدرسية'},Error});
const obj=create();
assert.equal(obj.events.length,3);
assert.equal(obj.students.length,2);
assert.deepEqual(Array.from(obj.dates),['2026-11-05','2026-11-08','2026-11-10']);
assert.ok(obj.dates.every(x=>x!=='2026-11-09'));
assert.equal(obj.approved.counts.excludedHolidayEvents,1);
assert.equal(obj.approved.holidays['2026-11-09'],'إجازة مدرسية');
assert.equal(obj.approved.from,'2026-11-05');
assert.equal(obj.approved.to,'2026-11-10');
assert.equal(obj.schema,'student-absence-report/v1');

const pickSource=section('function printSelectedSections(){','function pt(v){');
const printCtx={reportSections:[['overview','عام'],['students','الطلاب'],['daily','اليومي'],['quality','الجودة']],
 state:{tab:'daily'},dailyState:{date:''},last:{activeDates:['2026-11-08']},scope:'all'};
printCtx.document={querySelector:()=>({value:printCtx.scope})};
const pick=vm.runInNewContext(pickSource+'\nprintSelectedSections',printCtx);
assert.deepEqual(Array.from(pick()),['overview','students','quality']);
printCtx.scope='withoutStudents';
assert.deepEqual(Array.from(pick()),['overview','quality']);
printCtx.scope='current';
assert.deepEqual(Array.from(pick()),[]);
printCtx.dailyState.date='2026-11-08';
printCtx.scope='all';
assert.deepEqual(Array.from(pick()),['overview','students','daily','quality']);
printCtx.scope='current';
assert.deepEqual(Array.from(pick()),['daily']);
assert.match(dashboard,/<option value="">اختر اليوم<\/option>/);

const wrapSource=section('function wrappedEncryptedPage(data){','async function downloadEncryptedPeriod(){');
const wrap=vm.runInNewContext(wrapSource+'\nwrappedEncryptedPage',{JSON,esc:x=>x});
const payload={version:1,algorithm:'AES-256-GCM',iterations:360000,
 salt:'AAAAAAAAAAAAAAAAAAAAAA==',iv:'AAAAAAAAAAAAAAAA',ciphertext:'ABCDEF012345',
 period:{from:'2026-11-05',to:'2026-11-10'}};
const wrapped=wrap(payload);
assert.ok(wrapped.includes('window.REPORT_ENCRYPTED='));
assert.ok(wrapped.includes('src="./unlock.js"'));
assert.ok(!wrapped.includes('الطالب أ'));
assert.ok(!wrapped.includes('const DB='));

const files=fs.readdirSync('reports');
for(const name of files){
 if(name==='unlock.js'||name==='.gitkeep')continue;
 assert.match(name,/^period-\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}\.html$/,'Only encrypted period HTML is publishable');
 const html=fs.readFileSync('reports/'+name,'utf8');
 assert.ok(html.startsWith('<!doctype html>'),'Page header missing');
 assert.ok(html.includes('window.REPORT_ENCRYPTED='),'Missing encryption payload');
 assert.ok(html.includes('src="./unlock.js"'),'Missing unlock script');
 assert.ok(!html.includes('const DB='),'Plaintext student database must not appear');
 assert.ok(!html.includes('"students"'),'Plaintext students object must not appear');
 const match=html.match(/window\.REPORT_ENCRYPTED=(\{[^\n]*\});<\/script>/);
 assert.ok(match,'Bad encrypted payload format');
 const blob=JSON.parse(match[1]);
 assert.equal(blob.algorithm,'AES-256-GCM');
 assert.ok(blob.iterations>=300000);
 assert.match(blob.salt,/^[A-Za-z0-9+/=]+$/);
 assert.match(blob.iv,/^[A-Za-z0-9+/=]+$/);
 assert.ok(blob.ciphertext.length>200);
 assert.equal(name,'period-'+blob.period.from+'_to_'+blob.period.to+'.html');
}
console.log('PASS: approved range, holiday exclusions, explicit daily printing, and encrypted report validation');
