/**
 * **화면에 쓰는 말이 저장소 안에서 어긋나지 않는다.**
 *
 * 「조건 좁히기」는 「필터」로 바뀌었다(2026-10-19, 사용자). 말을 바꿀 때 화면만
 * 고치고 주석·검사·문서를 두면 **같은 것을 가리키는 말이 두 갈래로 남는다.**
 * 다음 사람은 주석에서 낱말을 배우므로, 물러난 말이 주석에 남아 있으면 되살아난다.
 *
 * 금지어는 **순한국어로 지어낸 말**이다. 쓰는 사람이 이미 아는 표준 용어가 있는데
 * 새 말을 지으면, 그 말을 아는 사람은 이 저장소를 읽은 사람뿐이 된다.
 *
 * **목록은 사용자가 이름을 댈 때 자란다.** 후보를 미리 채우지 않는다 —
 * 쓸 수 있는 말까지 막으면 다음 사람이 목록을 믿지 않고, 그러면 목록이 죽는다.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, it, expect } from 'vitest';

/**
 * 물러난 말 → 대신 쓸 말.
 *
 * **낱말의 줄기로 문다.** 한국어에는 낱말 경계가 없어서 활용형을 다 적을 수 없다 —
 * `좁히기`만 막으면 `좁히는`·`좁혀서`가 그대로 지나간다.
 *
 * 그 대가로 **엉뚱한 자리도 문다.** 「폭을 좁히지 않고」처럼 물리적인 뜻으로 쓴
 * 자리까지 걸린다. 근본 해결은 없으니, 그날 만나는 사람이 목록을 불신하는 대신
 * **표현을 고치거나 아래 EXEMPT에 이유와 함께 적도록** 이 함정을 여기 밝혀 둔다.
 */
const RETIRED = Object.freeze({
  좁히: '필터',
  좁혀: '필터',
  고르기: '선택',
  고른: '선택한',
  골라: '선택해'
});

/**
 * 옛 말을 **인용하는** 줄. 역사이지 사용이 아니다.
 *
 * 지우면 "언제 무엇에서 무엇으로 바꿨는가"가 사라지고, 그러면 다음 사람이 같은
 * 낱말을 다시 지어도 아무도 그게 되돌아온 것인 줄 모른다.
 */
const QUOTED = ['→ 필터', '→ 선택', '「필터」로 바뀌었다', '「열 선택」으로 바뀌었다', '물러난 말'];

/** 이 검사 자신과, 그 말이 왜 물러났는지를 적어 둔 판례. */
const EXEMPT = ['tests/terms.test.js', 'docs/decisions.md'];

const ROOT = process.cwd();

/** @returns {string[]} */
function filesUnder(dir, extensions) {
  const found = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...filesUnder(path, extensions));
    else if (extensions.some((extension) => name.endsWith(extension))) found.push(path);
  }
  return found;
}

const asPosix = (path) => relative(ROOT, path).replaceAll(sep, '/');

/**
 * 물러난 말을 쓰는 줄. 인용한 줄은 빼고 돌려준다.
 *
 * @param {readonly string[]} lines
 * @returns {{line: number, word: string, instead: string}[]}
 */
export function retiredWordsIn(lines) {
  const found = [];
  lines.forEach((text, index) => {
    if (QUOTED.some((quote) => text.includes(quote))) return;
    for (const [word, instead] of Object.entries(RETIRED)) {
      if (text.includes(word)) found.push({ line: index + 1, word, instead });
    }
  });
  return found;
}

/**
 * **줄바꿈에 쪼개진 옛 말.** 주석에서 `조건\n좁히기`처럼 두 줄에 걸친 것은
 * 위의 줄 단위 훑기가 원리적으로 못 본다.
 *
 * 공백을 하나로 접으면 그냥 찾힌다. 줄머리의 주석 기호(`*`)와 목록 기호(`-`)는
 * 낱말 사이로 들어오므로 함께 지운다.
 *
 * **자리는 파일까지만 알린다.** 공백을 접으면 줄 번호가 사라지는데, 되살리려고
 * 원문에 다시 맞추는 것은 이 검사가 더 잡는 양에 비해 비싸다.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function retiredWordsAcrossLines(text) {
  const collapsed = text.replace(/\s+[*\-#>]+\s+/g, ' ').replace(/\s+/g, ' ');
  const found = [];
  for (const word of Object.keys(RETIRED)) {
    let at = collapsed.indexOf(word);
    while (at !== -1) {
      const window = collapsed.slice(Math.max(0, at - 120), at + word.length + 120);
      if (!QUOTED.some((quote) => window.includes(quote))) {
        found.push(word);
        break;
      }
      at = collapsed.indexOf(word, at + word.length);
    }
  }
  return found;
}

describe('화면에 쓰는 말이 하나다', () => {
  const targets = [
    ...filesUnder(join(ROOT, 'src'), ['.js', '.json']),
    ...filesUnder(join(ROOT, 'tests'), ['.js']),
    ...filesUnder(join(ROOT, 'docs'), ['.md']),
    ...filesUnder(join(ROOT, 'scripts'), ['.mjs', '.js']),
    join(ROOT, 'index.html'),
    join(ROOT, 'CLAUDE.md'),
    join(ROOT, 'README.md')
  ].filter((path) => !EXEMPT.includes(asPosix(path)));

  /**
   * **0건을 훑고 통과하는 것이 이 검사의 가장 나쁜 실패다.** 훑는 목록이 조용히 비면
   * 초록불이 "깨끗하다"가 아니라 "안 봤다"를 뜻하는데, 둘이 화면에서 똑같이 생겼다.
   *
   * **합계 하나로는 못 지킨다.** `src`만으로도 문턱을 넘으므로, 나중에 넓힌 작은
   * 트리(`docs`·`scripts`)가 통째로 비어도 합계는 울지 않는다. 그런데 조용히 비기
   * 쉬운 쪽이 바로 그 작은 트리들이다.
   */
  it('트리마다 훑는 파일이 실제로 있다', () => {
    const counted = (prefix) => targets.filter((path) => asPosix(path).startsWith(prefix)).length;
    expect(counted('src/')).toBeGreaterThan(15);
    expect(counted('tests/')).toBeGreaterThan(8);
    expect(counted('docs/')).toBeGreaterThan(1); // decisions.md는 판례라 EXEMPT다
    expect(counted('scripts/')).toBeGreaterThan(0);
  });

  it('물러난 말을 쓰는 자리가 없다', () => {
    const offenders = [];
    for (const path of targets) {
      const where = asPosix(path);
      const text = readFileSync(path, 'utf-8');

      const byLine = retiredWordsIn(text.split(/\r?\n/));
      for (const hit of byLine) offenders.push(`${where}:${hit.line} '${hit.word}' → '${hit.instead}'`);

      // 줄바꿈에 쪼개진 것. 줄 단위가 이미 잡은 말은 다시 세지 않는다
      const seen = new Set(byLine.map((hit) => hit.word));
      for (const word of retiredWordsAcrossLines(text)) {
        if (!seen.has(word)) offenders.push(`${where} '${word}' (줄바꿈에 쪼개져 있다)`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('검사기가 물러난 말을 잡는다', () => {
    expect(retiredWordsIn(['조건 좁히기 판'])).toEqual([{ line: 1, word: '좁히', instead: '필터' }]);
  });

  it('검사기가 활용형도 잡는다 - 낱말 경계가 없어 줄기로 문다', () => {
    expect(retiredWordsIn(['먼저 좁히는 것들이다']).map((hit) => hit.word)).toEqual(['좁히']);
    expect(retiredWordsIn(['범위를 좁혀서 본다']).map((hit) => hit.word)).toEqual(['좁혀']);
  });

  it('검사기가 「고르기」 갈래를 잡는다 - 표준 용어가 있는데 지어낸 말이다', () => {
    expect(retiredWordsIn(['열 고르기 화면']).map((hit) => hit.word)).toEqual(['고르기']);
    expect(retiredWordsIn(['고른 값만 남긴다']).map((hit) => hit.word)).toEqual(['고른']);
    expect(retiredWordsIn(['묶음별로 골라 넣는다']).map((hit) => hit.word)).toEqual(['골라']);
  });

  it('검사기가 대신 쓸 말을 함께 알려 준다 - 목록만 보고도 고칠 수 있어야 한다', () => {
    expect(retiredWordsIn(['열 고르기'])[0].instead).toBe('선택');
  });

  it('검사기가 안 닮은 낱말은 안 잡는다', () => {
    // 「고르게」는 다른 뜻이고 금지 대상이 아니다. 줄기를 짧게 자르면 여기가 걸린다
    expect(retiredWordsIn(['여백을 고르게 둔다'])).toEqual([]);
  });

  it('검사기가 인용한 줄은 안 잡는다', () => {
    expect(retiredWordsIn(['「조건 좁히기」는 「필터」로 바뀌었다'])).toEqual([]);
  });

  it('검사기가 줄바꿈에 쪼개진 말을 잡는다', () => {
    expect(retiredWordsAcrossLines('왼쪽의 조건\n좁히기 판을 연다')).toEqual(['좁히']);
  });

  it('검사기가 줄머리의 주석 기호를 건너뛴다', () => {
    expect(retiredWordsAcrossLines('   * 왼쪽의 조건\n   * 좁히기 판')).toEqual(['좁히']);
  });

  it('쪼개진 것도 인용이면 안 잡는다', () => {
    expect(retiredWordsAcrossLines('「조건\n좁히기」는 「필터」로 바뀌었다')).toEqual([]);
  });
});
