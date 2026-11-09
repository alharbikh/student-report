import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const index = fs.readFileSync('index.html', 'utf8');
const template = fs.readFileSync('قالب_مرصد_غياب_الطلاب.html', 'utf8');
const begin = index.indexOf('async function buildReport(');
const end = index.indexOf('async function loadFile(', begin);
assert.ok(begin >= 0 && end > begin, 'Importer is missing the dashboard generator');
const mock = {
  fetch: async () => ({ok:true, text:async () => template}),
  Blob,
  htmlEscape: s => String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;'),
};
const buildReport = vm.runInNewContext(index.slice(begin, end) + '\nbuildReport', mock);
const data = {
  school:'مدرسة اختبار',
  sourceHeaderStart:'2026-09-27',
  students:[['999', 'طالب اختبار <script>', 'اول 1', 1]],
  dates:['2026-09-27'],
  events:[[0,0]],
  meta:{dateMin:'2026-09-27', dateMax:'2026-11-09'},
};
const html = await (await buildReport(data, 'test.xlsx')).text();
const matches = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
assert.equal(matches.length, 1, 'Expected one generated dashboard script');
assert.ok(html.includes('const DB='), 'The spreadsheet data was not injected');
assert.ok(!html.includes('طالب اختبار <script>'), 'Spreadsheet values must be safely escaped');
// Checks generated HTML after every replacement, including the print-engine string.
new vm.Script(matches[0][1], {filename:'generated-dashboard.js'});
assert.ok(matches[0][1].includes('function calculate()'));
assert.ok(matches[0][1].includes('function makePrintReport('));
console.log('PASS: generated dashboard parses and includes analysis/printing engines');
