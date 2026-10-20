/**
 * 물러난 말이 남은 자리를 파일·줄 단위로 내놓는다 (개발용, 런타임 아님).
 *
 *   node scripts/prose-report.mjs            # 전부
 *   node scripts/prose-report.mjs src/ui     # 그 아래만
 *
 * 검사(`tests/prose.test.js`)는 통과/실패만 말한다. 고치는 동안에는 자리 목록이 필요하다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { retiredIn } from '../tests/helpers/prose-rules.js';

const ROOT = process.cwd();
const EXTENSIONS = ['.js', '.mjs', '.md', '.html'];
const SKIP_DIR = new Set(['node_modules', 'dist', '.git', '.agents', '.claude', '.idea']);
const EXEMPT = ['tests/helpers/prose-rules.js', 'docs/decisions.md'];

function filesUnder(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name) || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...filesUnder(path));
    else if (EXTENSIONS.some((extension) => name.endsWith(extension))) found.push(path);
  }
  return found;
}

const only = process.argv[2];
const targets = [
  ...filesUnder(join(ROOT, 'src')), ...filesUnder(join(ROOT, 'tests')),
  ...filesUnder(join(ROOT, 'docs')), ...filesUnder(join(ROOT, 'scripts')),
  join(ROOT, 'index.html'), join(ROOT, 'CLAUDE.md'), join(ROOT, 'README.md')
].filter((path) => {
  const where = relative(ROOT, path).replaceAll(sep, '/');
  return !EXEMPT.includes(where) && (!only || where.startsWith(only.split(sep).join('/')));
});

let total = 0;
const byWord = new Map();
for (const path of targets) {
  const where = relative(ROOT, path).replaceAll(sep, '/');
  const lines = readFileSync(path, 'utf-8').split(/\r?\n/);
  const hits = [];
  lines.forEach((line, index) => {
    for (const hit of retiredIn(line)) {
      hits.push({ line: index + 1, ...hit, text: line.trim() });
      byWord.set(hit.was, (byWord.get(hit.was) ?? 0) + 1);
      total += 1;
    }
  });
  if (hits.length === 0) continue;
  console.log(`\n### ${where}  (${hits.length})`);
  for (const hit of hits) console.log(`  ${String(hit.line).padStart(4)} [${hit.found}] → ${hit.use}\n       ${hit.text.slice(0, 110)}`);
}
console.log(`\n=== 말별 ===`);
for (const [was, n] of [...byWord].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${was}`);
console.log(`\n총 ${total}건 / 파일 ${targets.length}개`);
