/**
 * 헤더 프로파일 작성 보조 도구 (개발용, 런타임 아님).
 *
 * 엑셀 파일의 헤더를 읽어 열 번호를 붙여 보여주고, 이름 힌트로 초안을 만든다.
 * 사람이 눈으로 확인한 뒤 src/dict/header-profiles/ 에 저장한다.
 *
 *   node scripts/author-profile.mjs <파일경로> --rows=2 --program=kcue --year=2024 [--write]
 *
 * 열 번호를 손으로 세지 않기 위한 도구다. 결과물은 데이터(JSON)이고,
 * 이 스크립트가 최종 판단을 내리지는 않는다.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { read as readWorkbook, utils as sheetUtils } from 'xlsx';
import { normalizeCell } from '../src/ingest/files.js';
import { headerFingerprint } from '../src/ingest/fingerprint.js';
import { validateProfile } from '../src/ingest/profile.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'src', 'dict', 'header-profiles');

/** 합성된 헤더 라벨 → 논리 필드 키. 초안을 만들기 위한 힌트일 뿐이다. */
const HINTS = [
  ['identity.name', ['이름', '성명']],
  ['identity.hakbun', ['학번', '수험번호']],
  ['identity.class', ['반']],
  ['identity.number', ['번호']],
  ['schoolYear', ['학년']],
  ['univ', ['대학명', '대학', '지원대학', '학교명']],
  ['region', ['지역']],
  ['dept', ['모집단위', '학과명', '학과', '전공', '학부']],
  ['track', ['계열']],
  ['period', ['모집시기', '지원시기', '모집구분']],
  ['admType', ['전형유형']],
  ['admName', ['전형명', '전형명(대)', '전형']],
  ['admDetail', ['세부유형', '세부전형']],
  ['selectType', ['선발유형']],
  ['quota', ['모집인원']],
  ['stage1', ['1단계']],
  ['final', ['최종단계', '최종결과', '최종', '합불', '합격여부']],
  ['failReason', ['불합격사유']],
  ['waitRank', ['최초후보순위', '후보순위', '예비']],
  ['register', ['등록여부', '등록구분', '등록']]
];

const GPA_LABELS = ['전교과', '전과목', '국영수사/과', '국수영사과', '국수영사/과', '국영수과', '국수영과', '국영수사', '국수영사', '국영수', '국영사', '국수영사과', '수영과', '국영수사과'];
const SUNEUNG_AREAS = ['한국사', '국어', '수학', '영어', '탐구1', '탐구2', '제2외국어'];
const SUNEUNG_PART_BY_LABEL = { 과목: 'subject', 과목명: 'subject', 표점: 'stdScore', 표준점수: 'stdScore', 백분위: 'percentile', 등급: 'grade' };

const compact = (text) => String(text ?? '').replace(/[\s()[\]]/g, '');

/** 위쪽 헤더를 오른쪽으로 전파해 병합셀을 복원한다 (§4 폴백 2단계와 같은 규칙) */
function fillMerged(row, width) {
  const filled = [];
  let last = '';
  for (let index = 0; index < width; index += 1) {
    const value = normalizeCell(row?.[index]);
    if (value !== null && String(value).trim() !== '') last = String(value).trim();
    filled.push(last);
  }
  return filled;
}

function buildLabels(grid, headerRows) {
  const width = grid.slice(0, headerRows).reduce((max, row) => Math.max(max, row?.length ?? 0), 0);
  const top = fillMerged(grid[0], width);
  if (headerRows === 1) return top.map((value) => ({ top: value, sub: '', label: value }));
  const sub = (grid[1] ?? []).slice(0, width).map((value) => String(normalizeCell(value) ?? '').trim());
  return top.map((value, index) => ({
    top: value, sub: sub[index] ?? '',
    label: sub[index] ? `${value}·${sub[index]}` : value
  }));
}

function draftColumns(labels) {
  const columns = {};
  const taken = new Set();
  const claim = (key, index) => {
    if (taken.has(index) || key in columns) return;
    columns[key] = index;
    taken.add(index);
  };

  // 수능 구역: 한국사 앵커 이후 (§4). 내신의 국어·수학·영어와 갈라내기 위함이다
  const suneungStart = labels.findIndex((item) => compact(item.top) === '한국사');
  labels.forEach((item, index) => {
    if (suneungStart < 0 || index < suneungStart) return;
    const area = SUNEUNG_AREAS.find((name) => compact(item.top) === compact(name));
    if (!area) return;
    const part = SUNEUNG_PART_BY_LABEL[compact(item.sub)] ?? (item.sub ? null : 'grade');
    if (part) claim(`suneung.${area}.${part}`, index);
  });

  labels.forEach((item, index) => {
    if (suneungStart >= 0 && index >= suneungStart) return;
    const label = compact(item.top);
    const gpa = GPA_LABELS.find((name) => compact(name) === label);
    if (gpa) {
      // 같은 조합이 반영비별로 여러 열에 걸쳐 있다. 100 반영을 기본으로 두고
      // 나머지는 반영비를 키에 남긴다 — 조용히 버리지 않기 위함이다(§4)
      const weight = item.sub && item.sub !== '100' ? `(${item.sub})` : '';
      claim(`gpa.${gpa}${weight}`, index);
      return;
    }
    for (const [key, names] of HINTS) {
      if (names.some((name) => compact(name) === label)) { claim(key, index); return; }
    }
  });

  return columns;
}

async function main() {
  const args = process.argv.slice(2);
  const path = args.find((arg) => !arg.startsWith('--'));
  if (!path) {
    console.error('사용법: node scripts/author-profile.mjs <파일경로> --rows=2 --program=이름 --year=2024 [--sheet=시트] [--write]');
    process.exit(1);
  }
  const option = (name, fallback) => {
    const found = args.find((arg) => arg.startsWith(`--${name}=`));
    return found ? found.slice(name.length + 3) : fallback;
  };

  const headerRows = Number(option('rows', '1'));
  const program = option('program', basename(path).replace(/\.[^.]+$/, ''));
  const programLabel = option('label', program);
  const year = Number(option('year', '0'));

  const workbook = readWorkbook(readFileSync(path), { type: 'buffer', cellDates: true, cellFormula: false });
  const sheetName = option('sheet', workbook.SheetNames[0]);
  const grid = sheetUtils
    .sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null, blankrows: false, raw: true })
    .map((row) => (Array.isArray(row) ? row.map(normalizeCell) : []));

  const labels = buildLabels(grid, headerRows);
  console.log(`\n[${basename(path)} · ${sheetName}] 헤더 ${headerRows}행, 열 ${labels.length}개\n`);
  labels.forEach((item, index) => {
    if (item.label) console.log(`  ${String(index).padStart(3)}  ${item.label}`);
  });

  const columns = draftColumns(labels);
  const profile = {
    id: `${program}-${year}`,
    program,
    programLabel,
    year,
    headerRows,
    fingerprint: await headerFingerprint(grid, headerRows),
    columns,
    source: `${basename(path)}#${sheetName}`
  };

  const { valid, problems } = validateProfile(profile);
  console.log('\n--- 초안 ---');
  console.log(JSON.stringify(profile, null, 2));
  console.log(valid ? '\n검사 통과' : `\n검사 실패:\n  ${problems.join('\n  ')}`);
  console.log(`\n매핑된 열 ${Object.keys(columns).length} / 전체 ${labels.filter((item) => item.label).length}`);

  if (args.includes('--write')) {
    mkdirSync(OUT_DIR, { recursive: true });
    const out = join(OUT_DIR, `${profile.id}.json`);
    writeFileSync(out, `${JSON.stringify(profile, null, 2)}\n`);
    console.log(`\n저장: ${out}`);
  }
}

main();
