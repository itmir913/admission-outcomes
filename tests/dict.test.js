/**
 * 사전이 조용히 틀리지 않게 지키는 검사들 (docs/design-field-keys.md §7).
 *
 * 내신 조합·과목과 수능 영역은 **표기를 고유키로 모으는 사전**으로 다룬다. 사전은
 * 규칙이 아니라 열거이므로, 열거가 어긋나는 것 말고는 틀릴 길이 없다. 그 어긋남을
 * 여기서 막는다.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
import fields from '../src/dict/fields.json' with { type: 'json' };
import synonyms from '../src/dict/field-synonyms.json' with { type: 'json' };
import anchors from '../src/dict/section-anchors.json' with { type: 'json' };
import { bundledProfiles } from '../src/dict/header-profiles/index.js';

const combos = fields.repeating.gpa.combos;
const subjects = fields.repeating.gpa.subjects;
const areas = fields.repeating.suneung.areas;

/** 사전 갈래의 짝 — field-synonyms 쪽 ↔ fields 쪽 (검사 3) */
const 짝 = [
  ['gpaCombos', combos, '내신 조합'],
  ['gpaSubjects', subjects, '내신 과목'],
  ['suneungAreas', areas, '수능 영역']
];

describe('한 표기가 두 고유키로 가지 않는다', () => {
  // 들어가면 어느 쪽으로 갈지 목록 순서가 정한다
  it.each(짝.map(([name]) => name))('%s 의 표기가 겹치지 않는다', (name) => {
    const seen = new Map();
    const 겹침 = [];
    for (const entry of synonyms[name]) {
      for (const word of entry.exact) {
        if (seen.has(word)) 겹침.push(`${word}: ${seen.get(word)} ↔ ${entry.key}`);
        else seen.set(word, entry.key);
      }
    }
    expect(겹침).toEqual([]);
  });

  it('내신 조합과 과목이 같은 `gpa.` 키를 다투지 않는다', () => {
    // 둘은 다른 갈래지만 키 공간이 하나다
    const keys = [...combos, ...subjects].map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('수능 영역의 고유키가 겹치지 않는다', () => {
    const keys = areas.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('대표 표기는 하나이고, 글자 판단의 입력이 아니다', () => {
  it.each(짝)('%s 의 모든 키에 label 이 있다', (name, entries) => {
    expect(entries.filter((entry) => !entry.label)).toEqual([]);
  });

  it.each(짝)('%s 의 label 이 서로 겹치지 않는다', (name, entries) => {
    const labels = entries.map((entry) => entry.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  /*
   * 라벨에 괄호를 쓰지 않는다. 라벨은 **글자 판단의 입력이 아니다** — 예전에
   * `student.js`가 라벨의 괄호로 반영비 변형을 구별했고, 그 때문에 `국·수·영·사/과
   * (택일)` 같은 라벨이 그 조합을 접힌 서랍으로 보냈다. 판정은 사전으로 옮겼지만,
   * 라벨에 괄호를 허용하면 다음 사람이 같은 함정을 다시 만든다.
   */
  it.each(짝)('%s 의 label 에 괄호가 없다', (name, entries) => {
    expect(entries.filter((entry) => /[()]/.test(entry.label)).map((entry) => entry.key)).toEqual([]);
  });

  /*
   * 키의 괄호는 **반영비 접미사뿐**이다. 그 안에는 괄호가 없다.
   * `전교과((2/4/4))`처럼 괄호가 겹친 이름이 사전에 들어오는 것을 막는다.
   */
  it('고유키의 괄호는 반영비 접미사뿐이다', () => {
    const 어긋남 = [...combos, ...subjects, ...areas]
      .map((entry) => entry.key)
      .filter((key) => /[()]/.test(key) && !/^[^()]+\([^()]+\)$/.test(key));
    expect(어긋남).toEqual([]);
  });
});

describe('두 사전의 키 집합이 서로를 덮는다', () => {
  it.each(짝)('%s 의 모든 키가 fields.json 에 있다', (name, entries) => {
    const known = new Set(entries.map((entry) => entry.key));
    expect(synonyms[name].filter((entry) => !known.has(entry.key)).map((entry) => entry.key)).toEqual([]);
  });

  it.each(짝)('%s 의 fields.json 키가 모두 표기를 갖는다', (name, entries) => {
    const named = new Set(synonyms[name].map((entry) => entry.key));
    expect(entries.filter((entry) => !named.has(entry.key)).map((entry) => entry.key)).toEqual([]);
  });

  /*
   * 스칼라도 같은 규율을 받는다. 다만 `cohortYear`는 **사람이 확정하는 파생 필드**라
   * 머리글 동의어가 있을 수 없다(§2) — `derived: true`로 밝혀 둔 것만 예외다.
   */
  it('스칼라도 두 파일이 서로를 덮는다 — derived 만 예외다', () => {
    const 사전 = new Set(fields.scalars.map((field) => field.key));
    const 표기 = new Set(synonyms.scalars.map((field) => field.key));
    expect(synonyms.scalars.filter((field) => !사전.has(field.key)).map((field) => field.key)).toEqual([]);
    expect(fields.scalars
      .filter((field) => !field.derived && !표기.has(field.key))
      .map((field) => field.key)).toEqual([]);
    expect(fields.scalars.filter((field) => field.derived).map((field) => field.key)).toEqual(['cohortYear']);
  });
});

describe('수능 항목의 모양을 코드가 믿고 있다', () => {
  /*
   * `profile.js`는 `parts`를 **문자열 배열**로 읽고(`new Set(...)`),
   * `buildRecords.js`는 `partTypes`를 그대로 읽는다. 모양을 바꾸면 전자는 모든
   * `suneung.*` 키를 낯선 키로 보아 **프로파일을 통째로 거절하고**, 후자는 수능 값을
   * 글자로 저장해 **범위 필터·정렬·축이 조용히 죽는다.**
   */
  it('parts 가 문자열 배열이다', () => {
    expect(Array.isArray(fields.repeating.suneung.parts)).toBe(true);
    expect(fields.repeating.suneung.parts.every((part) => typeof part === 'string')).toBe(true);
  });

  it('partTypes 의 키가 parts 와 같다', () => {
    expect(Object.keys(fields.partTypes).sort()).toEqual([...fields.repeating.suneung.parts].sort());
  });

  it('partTypes 의 값이 number 또는 text 뿐이다', () => {
    // 엉뚱한 값이 들어가면 typeOf 가 text 로 떨어져 수능 값이 글자로 저장된다
    expect(Object.values(fields.partTypes).filter((type) => !['number', 'text'].includes(type))).toEqual([]);
  });

  it('partLabels 의 키가 parts 와 같다', () => {
    expect(Object.keys(fields.repeating.suneung.partLabels).sort())
      .toEqual([...fields.repeating.suneung.parts].sort());
  });
});

describe('구역 표지와 사전이 어긋나지 않는다', () => {
  /*
   * 구역 판정은 `section-anchors.json`을 보고, 키 만들기는 `field-synonyms.json`을
   * 본다. 한쪽만 늘면 피해가 크다 — 「전체」를 뜻하는 새 표기를 사전에만 더하면
   * `findSections`가 내신 구역 자체를 찾지 못해 **그 양식의 내신 열이 통째로
   * `extra`로 간다.** 내신 묶음이 화면에서 사라진 까닭은 아무 데도 적히지 않는다.
   */
  // 전체 반영 변형(`전교과(100)`)은 같은 키로 가는 덧붙임이라 표지와 견줄 대상이 아니다
  const 비없는표기 = (key) => synonyms.gpaCombos
    .find((entry) => entry.key === key).exact
    .filter((word) => !/\(/.test(word));

  it('내신 구역 표지가 전교과 조합의 표기와 같다', () => {
    // 전체 반영 변형(`전교과(100)`)은 같은 키로 가는 덧붙임이라 뺀다
    expect([...anchors.gpa.anchors].sort()).toEqual([...비없는표기('전교과')].sort());
  });

  it('내신 과목 표지가 과목 사전과 같다', () => {
    const 표기 = synonyms.gpaSubjects.flatMap((entry) => entry.exact)
      .filter((word) => !/\(/.test(word));
    expect([...anchors.gpa.subjects].sort()).toEqual([...표기].sort());
  });

  it('수능 항목 표지의 값이 parts 와 같다', () => {
    expect([...new Set(Object.values(anchors.suneung.parts))].sort())
      .toEqual([...fields.repeating.suneung.parts].sort());
  });

  it('수능 구역 표지가 영역 사전에 있다', () => {
    // 빠지면 수능 구역을 여는 그 열 자체가 extra 로 간다
    const 표기 = new Set(synonyms.suneungAreas.flatMap((entry) => entry.exact));
    expect(anchors.suneung.anchors.filter((word) => !표기.has(word))).toEqual([]);
  });
});

describe('기본으로 보일 키를 사전이 정한다', () => {
  const 기본 = [...combos, ...subjects].filter((entry) => entry.primary).map((entry) => entry.key);

  it('default 가 정확히 하나다', () => {
    // 둘이면 대표 내신이 사전 순서로 뽑히고, 없으면 화면이 내신 없이 열린다
    expect(combos.filter((entry) => entry.default).map((entry) => entry.key)).toEqual(['전교과']);
  });

  it('반영비가 붙은 키에는 primary 가 없다', () => {
    const 어긋남 = combos.filter((entry) => entry.primary && /\(/.test(entry.key));
    expect(어긋남.map((entry) => entry.key)).toEqual([]);
  });

  /*
   * 오늘의 답을 적어 둔다. 반영비 없는 키를 새로 더하며 `primary`를 빠뜨리면 그 열이
   * **조용히 접힌 서랍으로 가므로**, 빠뜨리면 여기서 요란하게 터지게 한다.
   *
   * 「반영비 없음 == primary」를 **규칙으로** 두지는 않는다 — 규칙을 두면 이 설계가
   * 없앤 추론이 돌아온다. 일부러 바꾸는 사람은 두 줄을 고치며 한 번 더 생각한다.
   */
  it('오늘 기본으로 보이는 키는 이 열셋이다', () => {
    expect([...기본].sort()).toEqual([...[
      '전교과', '국수영', '국수영사', '국수영과', '국영사', '수영과',
      '국수영사과택일', '국수영사과',
      '국어', '영어', '수학', '사회', '과학'
    ]].sort());
  });
});

describe('한 양식 안에서 두 머리글이 한 키로 가지 않는다', () => {
  /*
   * **프로파일마다 따로 본다.** 서로 다른 프로파일의 키가 한 키로 모이는 것은 막으려는
   * 것이 아니라 **하려는 것**이다 — 다섯 장을 모아 세면 충돌 열한 가지가 나오는데
   * 그것이 전부 이 설계의 합치기다(`국영수사`+`국수영사`, `전교과`+`전과목`, …).
   *
   * 지금은 프로파일의 키가 곧 날것 머리글이라 키로 대신 볼 수 있다. 키를 정규화한
   * 뒤에는 그 대역이 사라지므로(프로파일은 머리글 글자를 보관하지 않는다),
   * 격자를 넣어 보는 회귀 검사가 이 자리를 잇는다.
   */
  const 날것을고유키로 = new Map();
  for (const entry of [...synonyms.gpaCombos, ...synonyms.gpaSubjects]) {
    for (const word of entry.exact) 날것을고유키로.set(word, entry.key);
  }

  it.each(bundledProfiles.map((profile) => [profile.id, profile]))('%s 안에서 충돌이 없다', (id, profile) => {
    const 차지 = new Map();
    const 충돌 = [];
    for (const key of Object.keys(profile.columns)) {
      if (!key.startsWith('gpa.')) continue;
      const canon = 날것을고유키로.get(key.slice(4));
      if (!canon) continue;
      if (차지.has(canon)) 충돌.push(`${차지.get(canon)} + ${key} → ${canon}`);
      else 차지.set(canon, key);
    }
    expect(충돌).toEqual([]);
  });
});

describe('코드가 열 이름을 해석하지 않는다', () => {
  /*
   * 「나누는 기준」이라는 것 자체가 코드가 엑셀 열 이름을 해석하고 있다는 뜻이다.
   * 우리는 이 진학 프로그램들의 양식을 알고 있으므로, 해석하는 것이 아니라 사전에
   * 미리 적어 둔다. 한 번 해석하기로 하면 해석이 번진다 — 규칙을 두면 그 규칙을
   * 보는 코드가 생기고, 그 코드가 또 글자를 본다.
   *
   * **`src/`만 훑는다.** 이 저장소의 다른 소스 검사는 `docs/`까지 보는데, 아래 패턴은
   * 설계 문서와 판례가 **인용**하므로 범위를 넓히면 반드시 빨간불이 된다.
   *
   * **해석이 아닌 것**: 우리가 만든 점 키의 접두사 구조를 읽는 것(`gpa.`를 보고 내신
   * 묶음에 넣는 것), 우리가 만든 파생 키와 비교하는 것, 묶음으로 분기하는 것, 값을
   * 보는 것. 그 구조는 우리가 만들었다. 해석은 **엑셀에서 온 글자**를 보는 것만 말한다.
   *
   * **남겨 둔 해석 둘**은 대상이 「모르는 열」이라서다 — `isIdentityLabel`(틀리면
   * 개인정보가 새는 쪽이라 느슨해야 한다)과 스칼라의 `affix`·`partial`(사전에 없는
   * 다른 프로그램을 만났을 때의 그물).
   */
  /*
   * 그물마다 **잡아야 할 예시**를 함께 둔다. 아래 「그물이 제 예시를 잡는다」가
   * 그것을 재므로, 이스케이프가 어긋나 **비어 있는 그물**이 생기면 바로 터진다.
   *
   * 실제로 그 일이 있었다. 넷째 패턴을 `'/^gpa\.('`로 적었는데 자바스크립트가
   * `\.`를 `.`로 접어 **소스의 백슬래시를 못 잡았다.** 그물 하나가 비어 있는데
   * 초록불이었고, 하필 그것이 지키던 것이 「글자가 대표 내신을 선택하던」 자리다.
   *
   * **과신하지 말 것.** 패턴과 예시를 **함께** 고치면 둘 다 통과한다. 이 자가 검사가
   * 막는 것은 고의가 아니라 **이스케이프 실수로 비어 버린 그물**이다. 고의라면 검사
   * 파일째 지울 수 있으니 어떤 자가 검사도 막지 못한다.
   */
  const 금지 = [
    ["includes('(')",
      "const 반영비붙음 = (entry) => entry.label.includes('(');",
      '라벨의 괄호로 반영비 변형을 구별하던 자리 — 사전의 primary 를 쓴다'],
    ['AREA_ORDER = [',
      "const AREA_ORDER = ['국어', '수학', '영어', '한국사'];",
      '수능 영역 순서를 배열에 박아 두던 자리 — 사전의 areas 순서를 쓴다'],
    ["['전교과'",
      "const 전교과 = ['전교과', '전과목', '전교과목'];",
      '전과목 평균의 표기를 목록으로 박아 두던 자리 — 사전이 한 키로 모은다'],
    [String.raw`/^gpa\.(`,
      String.raw`candidates.find((field) => /^gpa\.(전교과|전과목)$/.test(field.key))`,
      '대표 내신을 정규식으로 찾던 자리 — 사전의 default 를 쓴다']
  ];

  const sources = [];
  (function 모으기(dir) {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) 모으기(path);
      else if (name.endsWith('.js')) sources.push(path);
    }
  })(join(ROOT, 'src'));

  it('훑을 소스가 있다', () => {
    // 0건을 훑고 통과하는 것이 이 검사의 가장 나쁜 실패다
    expect(sources.length).toBeGreaterThan(10);
  });

  it.each(금지)('%s 그물이 제 예시를 잡는다', (pattern, example) => {
    // 0건을 훑고 통과하는 것보다 나쁜 것은 **잡지 못하는 그물로 훑는 것**이다
    expect(example.includes(pattern)).toBe(true);
  });

  it.each(금지)('%s 가 src/ 에 없다', (pattern) => {
    const 걸린곳 = sources
      .filter((path) => readFileSync(path, 'utf8').includes(pattern))
      .map((path) => relative(ROOT, path).replaceAll(sep, '/'));
    expect(걸린곳).toEqual([]);
  });
});
