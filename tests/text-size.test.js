/**
 * **화면의 모든 글자는 `text-base`(16px) 이상이다** (2026-10-21, 사용자).
 *
 * 이 도구를 보는 사람은 교사이고, 보는 것은 상담 자료다. 작은 글자로 줄인
 * 각주·범례·표의 열 이름 줄이 바로 **오독하면 안 되는 자리**다. 12px 범례의
 * `판정 미상 0.9%`를 잘못 봐도 화면은 멀쩡해 보인다 (§5).
 *
 * 검사가 정적인 까닭은, 글자 크기를 줄이는 일이 **한 줄로 조용히** 일어나기
 * 때문이다. 새 조각을 그리며 습관처럼 `text-base`를 적어 넣어도 아무것도 울지 않는다.
 * 그래서 코드를 직접 훑는다.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, it, expect } from 'vitest';

const ROOT = process.cwd();
const 훑을곳 = ['index.html', 'src'];

/** 1rem = 16px. 이보다 작은 글자는 두지 않는다. */
const 바닥 = 16;

/**
 * Tailwind 기본 눈금 중 바닥에 못 미치는 것들.
 *
 * 이름만 막으면 `text-[13px]` 같은 임의값으로 빠져나간다. 그래서 임의값도 함께 본다.
 */
const 작은이름 = ['text-2xs', 'text-xs', 'text-sm'];

const px = (value, unit) => (unit === 'rem' || unit === 'em' ? Number(value) * 16 : Number(value));

/** @returns {{rule: string, line: number, text: string}[]} */
export function findSmallText(source) {
  const hits = [];
  /*
   * 인쇄 구역은 제외한다. 종이에서는 뿌리 글자를 줄여 표 한 장을 접지 않고 담는데,
   * 그건 화면에서 읽는 글자 크기와 다른 문제다.
   */
  let 인쇄깊이 = null;

  source.split(/\r?\n/).forEach((line, index) => {
    if (인쇄깊이 === null && /@media[^{]*\bprint\b/.test(line)) 인쇄깊이 = 0;
    if (인쇄깊이 !== null) {
      인쇄깊이 += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      if (인쇄깊이 <= 0) 인쇄깊이 = null;
      return;
    }
    for (const name of 작은이름) {
      // `btn-base` 처럼 다른 낱말에 붙은 꼬리를 잡지 않도록 경계를 둔다
      if (new RegExp(`(^|[^\\w-])${name}(?![\\w-])`).test(line)) {
        hits.push({ rule: name, line: index + 1, text: line.trim() });
      }
    }
    for (const match of line.matchAll(/text-\[(\d*\.?\d+)(px|rem|em)\]/g)) {
      if (px(match[1], match[2]) < 바닥) {
        hits.push({ rule: match[0], line: index + 1, text: line.trim() });
      }
    }
    for (const match of line.matchAll(/font-size:\s*(\d*\.?\d+)(px|rem|em)/g)) {
      if (px(match[1], match[2]) < 바닥) {
        hits.push({ rule: match[0], line: index + 1, text: line.trim() });
      }
    }
  });
  return hits;
}

function 파일들(path) {
  const full = join(ROOT, path);
  if (!statSync(full).isDirectory()) return [path];
  return readdirSync(full).flatMap((name) => 파일들(join(path, name)));
}

describe('작은 글자 찾기', () => {
  // 찾는 규칙 자체가 맞는지 먼저 본다. 아무것도 못 잡는 검사는 늘 통과한다
  it('작은 눈금을 잡는다', () => {
    expect(findSmallText('<p class="text-base text-ink">')).toHaveLength(0);
    expect(findSmallText('<p class="text-xs">')).toHaveLength(1);
    expect(findSmallText("class: 'mt-2 text-base text-ink-soft'")).toHaveLength(0);
    expect(findSmallText("class: 'mt-2 text-base text-ink-soft'")).toHaveLength(0);
  });

  it('비슷하게 생긴 낱말은 잡지 않는다', () => {
    expect(findSmallText('<button class="btn btn-sm">')).toHaveLength(0);
    expect(findSmallText('<div class="text-base-soft">')).toHaveLength(0);
  });

  it('인쇄 구역은 제외한다', () => {
    const css = ['@media print {', '  html { font-size: 12px; }', '}', '.x { font-size: 11px; }'].join('\n');
    expect(findSmallText(css).map((hit) => hit.line)).toEqual([4]);
  });

  it('임의값도 본다', () => {
    expect(findSmallText('class="text-[13px]"')).toHaveLength(1);
    expect(findSmallText('class="text-[17px]"')).toHaveLength(0);
    expect(findSmallText('class="text-[0.75rem]"')).toHaveLength(1);
    expect(findSmallText('  font-size: 12px;')).toHaveLength(1);
    expect(findSmallText('  font-size: 1.125rem;')).toHaveLength(0);
  });
});

describe('화면 글자 크기', () => {
  const 어긴곳 = 훑을곳
    .flatMap((path) => 파일들(path))
    .filter((path) => /\.(js|css|html)$/.test(path))
    .flatMap((path) =>
      findSmallText(readFileSync(join(ROOT, path), 'utf8')).map((hit) => ({
        ...hit,
        where: `${relative('.', path).replaceAll('\\', '/')}:${hit.line}`
      })));

  it('text-base 미만인 글자가 없다', () => {
    expect(어긴곳.map((hit) => `${hit.where}  ${hit.rule}`)).toEqual([]);
  });
});
