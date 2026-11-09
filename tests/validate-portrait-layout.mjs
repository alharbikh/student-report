import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src=fs.readFileSync('قالب_مرصد_غياب_الطلاب.html','utf8');
const take=(start,end)=>{
  const a=src.indexOf(start),b=src.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'Missing source boundary: '+start);
  return src.slice(a,b);
};
const student=take('<section class="section" id="sec-students">','<section class="section" id="sec-daily">');
const daily=take('<section class="section" id="sec-daily">','<section class="section" id="sec-repeat">');
for(const [label,fragment] of [['students',student],['daily',daily]]){
  assert.match(fragment,/class="portrait-preview"/,'Portrait screen wrapper '+label);
  assert.match(fragment,/class="datatable/,'Accessible data table '+label);
  assert.match(fragment,/<div class="tablewrap">/,'Scrollable fallback '+label);
  assert.match(fragment,/<\/table><\/div><\/div>/,'Portrait wrapper closure '+label);
}
assert.match(student,/id="studentPortraitMeta"/);
assert.match(daily,/id="dailyPortraitMeta"/);
assert.match(src,/#sec-students \.portrait-preview,#sec-daily \.portrait-preview\{[\s\S]*?width:min\(210mm,100%\)/);
assert.match(src,/#sec-students \.portrait-preview \.datatable,#sec-daily \.portrait-preview \.datatable\{[\s\S]*?min-width:0/);
assert.match(src,/@page dailyPortrait\{size:A4 portrait;margin:0\}/);
assert.match(src,/\.sheet\[data-report="daily"\]\{page:dailyPortrait;width:210mm;height:297mm\}/);
assert.match(src,/@page studentPortrait\{size:A4 portrait;margin:0\}/);
assert.match(src,/\.sheet\[data-report="students"\]\{page:studentPortrait;width:210mm;height:297mm\}/);
assert.match(src,/@media print\{html,body\{width:auto;min-width:0/);

const studentRows=Array.from({length:53},(_,i)=>({pi:i,days:i%24,longest:i%5}));
const students=studentRows.map((r,i)=>[String(i+100),'طالب تجريبي '+i,'اول 1',1]);
const ctx={
  last:{schoolDayCount:20}, state:{start:'2026-09-27',end:'2026-11-09',grade:'all',cls:'all',threshold:15},
  DB:{students,school:'مدرسة اختبار'},dailyState:{date:'2026-11-08'},
  dailyVisible:studentRows,getStudents:()=>studentRows,
  compareGradeClassName:(a,b)=>a.pi-b.pi,absenceLevel:d=>d>=20?'abs-high':'abs-low',
  fmt:(n)=>String(n),readable:iso=>iso,esc:x=>String(x),pt:x=>String(x),
  chunkRows:(rows,n)=>{const result=[];for(let i=0;i<rows.length;i+=n)result.push(rows.slice(i,i+n));return result.length?result:[[]]},
  printableTable:(headers,rows,widths,classes)=>'<table><tbody>'+rows.map((r,i)=>'<tr class="'+classes[i]+'"><td>'+r.join('</td><td>')+'</td></tr>').join('')+'</tbody></table>',
  absenceLegend:()=>'<div class="absence-legend">مستويات الغياب</div>',
  GRADE_NAMES:{1:'الأول الثانوي'},reportSections:[['students','متابعة الطلاب'],['daily','اليومي']],
  Date,Map,Math,Array,Number,
};
const fn=vm.runInNewContext(take('function makePrintReport(sectionKeys){','function makePrintBlob(){')+'\nmakePrintReport',ctx);
const studentHTML=fn(['students']);
assert.equal((studentHTML.match(/<section class="sheet" data-report="students">/g)||[]).length,3,'53 students should print across 3 portrait sheets (27 per sheet)');
assert.match(studentHTML,/@page\{size:A4 portrait;margin:0\}/);
const dailyHTML=fn(['daily']);
assert.equal((dailyHTML.match(/<section class="sheet" data-report="daily">/g)||[]).length,3,'53 daily students should print across 3 portrait sheets (25 per sheet)');
assert.match(dailyHTML,/@page\{size:A4 portrait;margin:0\}/);
const mixed=fn(['students','daily']);
assert.equal((mixed.match(/<section class="sheet" data-report=/g)||[]).length,6);
assert.match(mixed,/@page\{size:A4 landscape;margin:0\}/);
assert.match(mixed,/page:studentPortrait;width:210mm;height:297mm/);
assert.match(mixed,/page:dailyPortrait;width:210mm;height:297mm/);
assert.ok(!studentHTML.includes('الجمعة'));
console.log('PASS: responsive portrait views, 53-row pagination and portrait/mixed printing');
