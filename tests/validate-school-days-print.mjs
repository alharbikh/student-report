import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const importer=fs.readFileSync('index.html','utf8');
const template=fs.readFileSync('قالب_مرصد_غياب_الطلاب.html','utf8');
const section=(source,start,end)=>{
 const i=source.indexOf(start),j=source.indexOf(end,i+start.length);
 assert.ok(i>=0&&j>i, 'Missing expected source: '+start);
 return source.slice(i,j);
};
assert.match(importer,/const data=keepSchoolDaysOnly\(parsed\);showPreview\(data,file\.name\)/);
assert.doesNotMatch(importer,/value="weekend"/);
const normalizeSource=section(importer,'function keepSchoolDaysOnly(data){','function previewQuality(data){');
const normalize=vm.runInNewContext(
 "const isSchoolDay=iso=>{const d=new Date(iso+'T12:00:00Z').getUTCDay();return d<5};\n"+normalizeSource+"\nkeepSchoolDaysOnly",
 {Date,Set,Map,Error});
const input={
 school:'مدرسة اختبار',
 students:[['1','طالب ألف','اول 2',1],['2','طالب باء','ثاني 1',2]],
 dates:['2026-11-05','2026-11-06','2026-11-07','2026-11-08','2026-11-09'],
 events:[[0,0],[0,1],[1,2],[0,3],[1,4]],
 meta:{sourceRows:5,dateMin:'2026-11-05',dateMax:'2026-11-09'},
};
const normalized=normalize(input);
assert.deepEqual(Array.from(normalized.dates),['2026-11-05','2026-11-08','2026-11-09']);
assert.equal(normalized.events.length,3);
assert.equal(normalized.meta.sourceRows,3);
assert.equal(normalized.students.length,2);
assert.ok(normalized.events.every(([,i])=>new Date(normalized.dates[i]+'T12:00:00Z').getUTCDay()<5));

const refreshSource=section(template,'function refreshPeriodOptions(){','function refreshWeekOptions(){');
const fields=new Map([['startDate',{}],['endDate',{}]]);
const holidays=new Set(['2026-11-08']);
const preferredPeriod={start:'2026-11-08',end:'2026-11-09'};
const state={...preferredPeriod};
const context={
 DB:{meta:{dateMin:'2026-11-05',dateMax:'2026-11-09'}},
 preferredPeriod,state,holidays,Date,
 isSchoolDay:iso=>new Date(iso+'T12:00:00Z').getUTCDay()<5&&!holidays.has(iso),
 dayOffset:(iso,d)=>new Date(Date.parse(iso+'T00:00:00Z')+d*86400000).toISOString().slice(0,10),
 d:id=>fields.get(id),esc:x=>x,fullDate:x=>x,
};
const refresh=vm.runInNewContext(refreshSource+'\nrefreshPeriodOptions',context);
refresh();
assert.equal(state.start,'2026-11-09');
assert.ok(!fields.get('startDate').innerHTML.includes('2026-11-08'));
assert.ok(!fields.get('startDate').innerHTML.includes('2026-11-06'));
assert.ok(!fields.get('startDate').innerHTML.includes('2026-11-07'));
holidays.clear();refresh();
assert.equal(state.start,'2026-11-08');
assert.ok(fields.get('startDate').innerHTML.includes('2026-11-08'));

const comparatorSource=section(template,'function compareGradeClassName(a,b){','function absenceLevel(days){');
const DB={students:[
 ['1','زيد','اول 2',1],['2','أحمد','اول 1',1],['3','بدر','ثاني 1',2],['4','خالد','اول 1',1],
]};
const compare=vm.runInNewContext(comparatorSource+'\ncompareGradeClassName',{DB});
assert.deepEqual([0,1,2,3].map(pi=>({pi})).sort(compare).map(x=>x.pi),[1,3,0,2]);

const selectionSource=section(template,'function printSelectedSections(){','function pt(v){');
const selectionContext={
 state:{tab:'students'},
 reportSections:[['overview','عام'],['students','طلاب'],['calendar','إجازات']],
 scope:'all',
 document:{querySelector:()=>({value:selectionContext.scope})},
};
const getSections=vm.runInNewContext(selectionSource+'\nprintSelectedSections',selectionContext);
selectionContext.scope='all';assert.deepEqual(Array.from(getSections()),['overview','students','calendar']);
selectionContext.scope='current';assert.deepEqual(Array.from(getSections()),['students']);
selectionContext.scope='withoutStudents';assert.deepEqual(Array.from(getSections()),['overview','calendar']);
selectionContext.scope='studentsPortrait';assert.deepEqual(Array.from(getSections()),['students']);
assert.match(template,/@page studentPortrait\{size:A4 portrait/);
assert.match(template,/\.sheet\[data-report="students"\]\{page:studentPortrait;width:210mm;height:297mm\}/);
assert.match(template,/chunkRows\(rows,pageRows\)/);
assert.match(template,/\.pt-table tbody tr\.abs-high td\{background:/);
assert.match(template,/const pageRows=27/);
console.log('PASS: weekends hidden, holidays reversible, students sorted and printing modes configured');
