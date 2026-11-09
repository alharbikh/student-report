#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""بناء مرصد غياب الطلاب من كشف Excel بنفس أعمدة المصدر.

الاستخدام:
  python إنشاء_مرصد_الغياب.py "غياب_جديد.xlsx"
  python إنشاء_مرصد_الغياب.py "غياب_جديد.xlsx" --start 2026-09-27 --end 2026-11-09

المتطلبات: Python 3.9+ فقط؛ لا حاجة لتثبيت مكتبات.
البيانات تبقى في الجهاز؛ الناتج HTML يضم أسماء الطلاب، فلا تنشره على الإنترنت.
"""
from __future__ import annotations
import argparse
import collections
import datetime as dt
import html
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
HEADER_COLS = ('C', 'G', 'L', 'O')


def shared_text(z: zipfile.ZipFile) -> list[str]:
    if 'xl/sharedStrings.xml' not in z.namelist():
        return []
    root = ET.fromstring(z.read('xl/sharedStrings.xml'))
    return [''.join(x.itertext()) for x in root.findall(f'{NS}si')]


def cell_value(cell: ET.Element, strings: list[str]) -> str:
    if cell.get('t') == 'inlineStr':
        return ''.join(t.text or '' for t in cell.iter(f'{NS}t')).strip()
    value = cell.findtext(f'{NS}v', default='')
    if cell.get('t') == 's' and value:
        index = int(value)
        return strings[index] if 0 <= index < len(strings) else ''
    return str(value).strip()


def date_iso(value: str) -> str | None:
    value = str(value).strip()
    if not value:
        return None
    for fmt in ('%d-%m-%Y', '%d/%m/%Y', '%Y-%m-%d', '%Y/%m/%d', '%d.%m.%Y'):
        try:
            return dt.datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            pass
    # بعض ملفات Excel تخزن التاريخ رقمًا تسلسليًا
    if re.fullmatch(r'\d+(?:\.\d+)?', value):
        n = float(value)
        if 30000 < n < 100000:
            return (dt.date(1899, 12, 30) + dt.timedelta(days=int(n))).isoformat()
    return None


def grade(class_name: str, job: str) -> int:
    normalized = class_name.replace('أ', 'ا').replace('إ', 'ا').strip()
    if normalized.startswith('اول'):
        return 1
    if normalized.startswith('ثاني'):
        return 2
    if normalized.startswith('ثالث'):
        return 3
    match = re.search(r'\b([123])\s*[\\/\\-]', job)
    if match:
        return int(match.group(1))
    raise ValueError(f'تعذر تحديد الصف الدراسي من الفصل: {class_name!r}')


def read_absence_book(source: Path) -> dict:
    if not zipfile.is_zipfile(source):
        raise ValueError('الملف ليس XLSX صالحًا؛ يجب استخدام Excel بصيغة .xlsx')
    with zipfile.ZipFile(source) as z:
        strings = shared_text(z)
        sheets = sorted(p for p in z.namelist() if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', p))
        if not sheets:
            raise ValueError('لم يتم العثور على ورقة عمل داخل Excel')
        sheet = ET.fromstring(z.read(sheets[0]))
        school = ''
        header_start = ''
        students = []
        student_index = {}
        records = []
        incomplete = []
        duplicate = set()
        date_count = collections.Counter()
        parsed_rows = 0
        halfday = 0
        summary = 0
        for row in sheet.iter(f'{NS}row'):
            rn = int(row.get('r') or 0)
            if rn < 2:
                continue
            cells = {}
            for cell in row.findall(f'{NS}c'):
                ref = cell.get('r', '')
                col = re.match(r'[A-Z]+', ref)
                if col:
                    cells[col.group()] = cell_value(cell, strings)
            if rn == 2:
                school = cells.get('H', '').strip()
            elif rn == 9:
                header_start = date_iso(cells.get('M', '')) or ''
            if rn < 12:
                continue
            if not any(cells.get(k, '') for k in HEADER_COLS):
                continue
            parsed_rows += 1
            rawdate = cells.get('C', '')
            iso = date_iso(rawdate)
            if not iso:
                if 'اجمالي' in rawdate.replace('إ', 'ا').replace('أ', 'ا') or 'المجموع' in rawdate:
                    summary += 1
                else:
                    incomplete.append((rn, 'تاريخ غير معروف', rawdate))
                continue
            sid = cells.get('O', '').strip()
            name = cells.get('L', '').strip()
            clas = cells.get('G', '').strip()
            if not (sid and name and clas):
                incomplete.append((rn, 'معرّف/اسم/فصل ناقص', sid or name or clas))
                continue
            key = (sid, iso)
            if key in duplicate:
                incomplete.append((rn, 'سجل مكرر للطالب في التاريخ نفسه', sid))
                continue
            duplicate.add(key)
            try:
                g = grade(clas, cells.get('J', ''))
            except ValueError as exc:
                incomplete.append((rn, str(exc), clas))
                continue
            if sid not in student_index:
                student_index[sid] = len(students)
                students.append([sid, name, clas, g])
            elif students[student_index[sid]][1:4] != [name, clas, g]:
                incomplete.append((rn, 'اختلاف بيانات نفس رقم الطالب', sid))
            amount = cells.get('A', '').strip()
            if amount and amount not in ('1', '1.0'):
                try:
                    if float(amount) == 0.5:
                        halfday += 1
                except ValueError:
                    pass
            records.append((student_index[sid], iso))
            date_count[iso] += 1
        if not records:
            raise ValueError('لا توجد سجلات غياب صالحة. المطلوب الأعمدة: C=التاريخ، G=الفصل، L=الاسم، O=رقم الطالب.')
        dates = sorted(date_count)
        date_idx = {date: i for i, date in enumerate(dates)}
        events = [[pi, date_idx[iso]] for pi, iso in records]
        events.sort(key=lambda x: (x[0], x[1]))
        return {
            'school': school or 'المدرسة',
            'sourceHeaderStart': header_start or dates[0],
            'students': students,
            'dates': dates,
            'events': events,
            'meta': {
                'sourceRows': parsed_rows,
                'totalLines': summary,
                'validRows': len(events),
                'uniqueStudents': len(students),
                'dateMin': dates[0],
                'dateMax': dates[-1],
            },
            'issues': incomplete,
            'halfDayRows': halfday,
        }


def build_html(data: dict, template_path: Path, output_path: Path, source_file: Path, start: str, end: str) -> None:
    raw = template_path.read_text('utf-8')
    pattern = r'const DB=(\{.*?\});\s*const GRADE_NAMES='
    if not re.search(pattern, raw, flags=re.S):
        raise ValueError('قالب HTML غير متوافق؛ تعذر العثور على موضع بيانات DB.')
    school = data['school']
    old_school = 'مدرسة بن سيرين الثانوية'
    if old_school in raw:
        raw = raw.replace(old_school, html.escape(school))
    # القالب المرفق لا يحتوي على بيانات الطلاب، وتظهر فيه تسمية مكانية عامة.
    raw = raw.replace('<title>مرصد غياب الطلاب | المدرسة</title>', '<title>مرصد غياب الطلاب | ' + html.escape(school) + '</title>')
    raw = raw.replace('<small>المدرسة · لوحة تحليل تفاعلية</small>', '<small>' + html.escape(school) + ' · لوحة تحليل تفاعلية</small>')
    db = {
        'title': 'مرصد غياب الطلاب — ' + school,
        'school': school,
        'source': source_file.name,
        'filenameStart': start,
        'filenameEnd': end,
        'sourceHeaderStart': data['sourceHeaderStart'],
        'students': data['students'],
        'dates': data['dates'],
        'events': data['events'],
        'meta': data['meta'],
    }
    serialized = json.dumps(db, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    raw = re.sub(pattern, lambda m: 'const DB=' + serialized + ';\nconst GRADE_NAMES=', raw, count=1, flags=re.S)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(raw, encoding='utf-8')


def main() -> int:
    p = argparse.ArgumentParser(description='إعادة بناء مرصد غياب الطلاب من ملف Excel ببنية كشف الغياب المعتمد')
    p.add_argument('file', type=Path, help='ملف Excel بصيغة xlsx')
    p.add_argument('--template', type=Path, default=Path(__file__).resolve().parent / 'قالب_مرصد_غياب_الطلاب.html', help='قالب HTML للوحة')
    p.add_argument('--output', type=Path, default=None, help='ملف HTML الناتج')
    p.add_argument('--start', help='بداية الفترة YYYY-MM-DD')
    p.add_argument('--end', help='نهاية الفترة YYYY-MM-DD')
    args = p.parse_args()
    try:
        if not args.file.is_file():
            raise ValueError(f'ملف Excel غير موجود: {args.file}')
        if not args.template.is_file():
            raise ValueError(f'قالب اللوحة غير موجود: {args.template}')
        data = read_absence_book(args.file)
        start = date_iso(args.start) if args.start else data['dates'][0]
        end = date_iso(args.end) if args.end else data['dates'][-1]
        if start is None or end is None or start > end:
            raise ValueError('فترة غير صالحة؛ استخدم --start YYYY-MM-DD --end YYYY-MM-DD')
        output = args.output or (args.file.parent / ('مرصد_غياب_الطلاب_' + args.file.stem + '.html'))
        build_html(data, args.template, output, args.file, start, end)
        print('تم إنشاء اللوحة:', output.resolve())
        print('المدرسة:', data['school'])
        print('الطلاب:', data['meta']['uniqueStudents'], ' | سجلات الغياب:', data['meta']['validRows'], ' | التواريخ:', len(data['dates']))
        print('المدى:', data['dates'][0], 'إلى', data['dates'][-1], ' | فترة العرض:', start, 'إلى', end)
        if data['issues']:
            print('تنبيه: صفوف لم تُدرج أو بها اختلافات:', len(data['issues']))
            for item in data['issues'][:6]:
                print('  صف', item[0], item[1], item[2])
        if data['halfDayRows']:
            print('تنبيه: وُجد', data['halfDayRows'], 'سجل نصف يوم؛ محرك اللوحة يحسب السجل كوحدة واحدة.')
        print('تنبيه أمني: ملف HTML الناتج يحتوي على بيانات الطلاب. لا تنشره في GitHub Pages.')
        return 0
    except (ValueError, OSError, zipfile.BadZipFile, ET.ParseError) as exc:
        print('تعذر إنشاء اللوحة:', exc, file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
