/**
 * **물러난 말이 다시 들어오지 않았는가** (문장 정제).
 *
 * 목록과 정규식은 `tests/helpers/prose-rules.js`에 있다. 여기서는 두 가지를 잰다 —
 * **규칙이 스스로 도는지**(예/아님)와 **저장소에 남은 자리가 있는지**.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, it, expect } from 'vitest';

import { RULES, SKIP_LINE, retiredIn } from './helpers/prose-rules.js';

/** 줄 나누기. CR이 붙어 와도 같게 센다 — 역슬래시 없이 적는다. */
const LINES = (text) => text.split(String.fromCharCode(10))
  .map((line) => line.replaceAll(String.fromCharCode(13), ""));

const ROOT = process.cwd();
const EXTENSIONS = ['.js', '.mjs', '.md', '.html'];
const SKIP_DIR = new Set(['node_modules', 'dist', '.git', '.agents', '.claude', '.idea']);

/**
 * 물러난 말을 잔뜩 적어 두는 자리는 목록 파일 하나뿐이다.
 *
 * **이 검사 파일 자신은 예외로 두지 않는다.** 설명하려고 그 낱말을 써야 하는 줄에는
 * 줄마다 `prose: 예시`를 단다 — 파일 통째로 빼 두면 그 안에서 조용히 되살아난다.
 *
 * 판례(`docs/decisions.md`)는 어떤 말이 왜 물러났는지를 적는 자리라 그 말을 인용해야 한다.
 * `terms.test.js`가 같은 이유로 같은 파일을 빼 둔다.
 */
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

const asPosix = (path) => relative(ROOT, path).replaceAll(sep, '/');



describe('규칙이 스스로를 시험한다', () => {
  /*
   * **목록을 믿을 수 있게 하는 장치다.** 「재다」가 금지어였는데도 활용형 둘이 빠져
   * 일곱 곳이 살아남은 일이 있었다. 규칙을 적은 사람이 활용형을 다 떠올리지 못하는 것은
   * 흔한 일이므로, 떠올린 것만이라도 실제로 걸리는지 기계가 확인한다.
   */
  it.each(RULES)('%s — 예가 전부 걸린다', (pattern, was, use, examples) => {
    const missed = examples.filter((text) => !new RegExp(pattern, 'u').test(text));
    expect(missed, `${was}: 이 꼴이 안 걸린다`).toEqual([]);
  });

  it.each(RULES.filter((rule) => rule[4]?.length))('%s — 아님이 하나도 안 걸린다', (pattern, was, use, examples, notThese) => {
    const wrong = notThese.filter((text) => new RegExp(pattern, 'u').test(text));
    expect(wrong, `${was}: 이 꼴은 걸리면 안 된다`).toEqual([]);
  });

  it('규칙마다 예가 하나 이상 있다', () => {
    const bare = RULES.filter((rule) => !rule[3]?.length).map((rule) => rule[1]);
    expect(bare, '예가 없으면 그 규칙이 도는지 아무도 모른다').toEqual([]);
  });
});

describe('물러난 말이 저장소에 없다', () => {
  const targets = [
    ...filesUnder(join(ROOT, 'src')),
    ...filesUnder(join(ROOT, 'tests')),
    ...filesUnder(join(ROOT, 'docs')),
    ...filesUnder(join(ROOT, 'scripts')),
    join(ROOT, 'index.html'),
    join(ROOT, 'CLAUDE.md'),
    join(ROOT, 'README.md')
  ].filter((path) => !EXEMPT.includes(asPosix(path)));

  it('트리마다 훑는 파일이 실제로 있다', () => {
    const counted = (prefix) => targets.filter((path) => asPosix(path).startsWith(prefix)).length;
    expect(counted('src/')).toBeGreaterThan(15);
    expect(counted('tests/')).toBeGreaterThan(8);
    expect(counted('docs/')).toBeGreaterThan(1); // decisions.md는 판례라 EXEMPT다
    expect(counted('scripts/')).toBeGreaterThan(0);
  });

  it('쓰지 않기로 한 말이 없다', () => {
    const offenders = [];
    for (const path of targets) {
      const where = asPosix(path);
      LINES(readFileSync(path, 'utf-8')).forEach((line, index) => {
        for (const hit of retiredIn(line)) {
          offenders.push(`${where}:${index + 1} '${hit.found}' (${hit.was}) → ${hit.use}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('검사기 자신', () => {
  it('물러난 말을 잡는다', () => {
    expect(retiredIn('여기서 한 번 짚고 넘어간다').map((hit) => hit.was)).toContain('짚다');  // prose: 예시
  });

  it('설명하려고 적은 줄은 넘어간다', () => {
    expect(retiredIn(`「짚다」는 쓰지 않는다 — ${SKIP_LINE}`)).toEqual([]);  // prose: 예시
  });

  it('닮았지만 다른 낱말은 안 잡는다', () => {
    expect(retiredIn('헷갈리는 자리')).toEqual([]);
  });
});
