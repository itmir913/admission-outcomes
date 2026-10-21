/**
 * **엑셀 값이 든 글자는 어떻게든 끊을 수 있어야 한다** (2026-10-21, 사용자).
 *
 * 화면에 뜨는 글자는 대부분 원본 엑셀의 셀 값이고, 그 길이는 우리가 정하지 않는다.
 * 「아주아주길고긴이름을가진국립대학교제이캠퍼스」처럼 **띄어쓰기 없이 붙여 쓴**
 * 한글 이름은 CSS 눈에 한 낱말이라, 끊을 길을 열어 두지 않으면 상자를 그대로
 * 뚫고 나간다. 실제로 학생 상자에서 375px 기준 178px가 밖으로 나갔다.
 *
 * 밖으로 나간 글자는 **없는 것처럼 보인다** — 화면은 멀쩡한 얼굴을 하고 있고,
 * 사라진 것이 대학 이름의 뒷부분인지 전공 이름인지 알 길이 없다 (§5).
 *
 * jsdom은 자리를 재지 않으므로 화면을 띄워 재는 검사를 둘 수 없다. 대신 **끊을
 * 길을 막는 설정**을 코드에서 직접 찾는다. 이런 설정은 한 줄로 조용히 들어온다.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, it, expect } from 'vitest';

const ROOT = process.cwd();
const 훑을곳 = ['index.html', 'src'];

/** 파일을 모두 모은다. */
function 파일들(경로, 모음 = []) {
  const 절대 = join(ROOT, 경로);
  if (statSync(절대).isDirectory()) {
    for (const 이름 of readdirSync(절대)) 파일들(join(경로, 이름), 모음);
    return 모음;
  }
  if (/\.(js|html|css)$/.test(경로)) 모음.push(경로);
  return 모음;
}

const 파일 = () => 훑을곳.flatMap((곳) => 파일들(곳)).map((경로) => ({
  경로: relative('.', 경로).replaceAll('\\', '/'),
  글: readFileSync(join(ROOT, 경로), 'utf8')
}));

/** 줄 번호와 함께 찾는다. */
function 찾기(글, 정규식) {
  const hits = [];
  글.split('\n').forEach((줄, index) => {
    if (정규식.test(줄)) hits.push({ line: index + 1, text: 줄.trim().slice(0, 90) });
  });
  return hits;
}

describe('긴 값이 상자를 뚫지 않는다', () => {
  /*
   * 한글을 어절 단위로 끊으려면 `word-break: keep-all` 이 필요하고, 그것만 두면
   * 띄어쓰기 없는 긴 이름이 끊을 자리를 잃는다. **둘은 반드시 짝으로 선다.**
   * 하나만 남으면 글이 글자 단위로 끊기거나(읽기 나쁨) 상자를 뚫는다(보이지 않음).
   */
  it('어절 단위 줄바꿈과 비상구가 짝으로 서 있다', () => {
    const css = readFileSync(join(ROOT, 'src/styles.css'), 'utf8');
    const start = css.indexOf('  body {');
    const body = start < 0 ? '' : css.slice(start, css.indexOf('\n  }', start));
    expect(body, 'body 규칙을 찾지 못했다').not.toBe('');
    expect(body).toMatch(/word-break:\s*keep-all/);
    expect(body).toMatch(/overflow-wrap:\s*(anywhere|break-word)/);
  });

  /*
   * 칩에는 열 이름과 선택한 값이 그대로 들어간다 — 「원본 파일: …(2026년2월4일).xlsx」.
   * 한 줄로 버티게 두면 그 줄이 통째로 화면 밖으로 나간다.
   */
  it('칩은 줄을 바꾸고 제 줄보다 넓어지지 않는다', () => {
    const css = readFileSync(join(ROOT, 'src/styles.css'), 'utf8');
    const 블록 = /\.chip \{[\s\S]*?\n {2}\}/.exec(css)?.[0] ?? '';
    expect(블록, '.chip 규칙을 찾지 못했다').not.toBe('');
    expect(블록).toMatch(/max-width:\s*100%/);
    expect(블록).not.toMatch(/\bwhitespace-nowrap\b/);
  });

  /*
   * 확인 상자는 **파일 이름과 사람이 적은 글귀를 한 줄에 세운다.** 둘 다 길이를
   * 우리가 정하지 않으므로, 줄어들 수 있게(min-w-0) 또는 줄을 바꿀 수 있게(flex-wrap)
   * 열어 두지 않으면 상자를 넘는다. 실제로 좁은 화면에서 파일 이름이 밖으로 나가고
   * 「불러오기」가 한 줄에 한 자씩 세로로 눌렸다.
   */
  it('확인 상자의 한 줄짜리 자리가 줄어들거나 줄을 바꾼다', () => {
    const upload = readFileSync(join(ROOT, 'src/ui/upload.js'), 'utf8');
    const 시트이름줄 = /el\('label', \{ class: '([^']*)'[^]*?sheet\.fileName/.exec(upload);
    expect(시트이름줄, '시트 이름 줄을 찾지 못했다').not.toBeNull();
    expect(시트이름줄[1]).toMatch(/(^| )min-w-0( |$)/);

    const 단추줄 = /footer: el\('div', \{ class: '([^']*)'/.exec(upload);
    expect(단추줄, '아래 단추줄을 찾지 못했다').not.toBeNull();
    expect(단추줄[1]).toMatch(/(^| )flex-wrap( |$)/);
  });

  /*
   * **지역 규칙이 전역 비상구를 덮어쓰지 않게 한다.** `break-words`(overflow-wrap:
   * break-word)는 body 의 `anywhere` 보다 약하다. 끊을 자리가 없는 긴 이름 앞에서
   * 상자 너비를 다시 글자 길이에 맞추므로, 적어 두면 오히려 뚫린다.
   */
  it('더 약한 줄바꿈 규칙으로 전역 설정을 덮지 않는다', () => {
    const offenders = [];
    for (const { 경로, 글 } of 파일()) {
      if (경로.endsWith('tests/overflow.test.js')) continue;
      // 주석에서 그 이름을 말하는 것은 괜찮다. 클래스로 적힌 것만 본다
      const 클래스 = /(class[:=] *["'`][^"'`]*|@apply[^;]*)break-words/;
      for (const hit of 찾기(글, 클래스)) offenders.push(`${경로}:${hit.line} ${hit.text}`);
    }
    expect(offenders).toEqual([]);
  });
});
