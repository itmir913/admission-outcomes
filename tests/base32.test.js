import { describe, it, expect } from 'vitest';
import { encodeBase32, group } from '../src/core/base32.js';

describe('Crockford Base32', () => {
  it('혼동되는 글자(I, L, O, U)를 쓰지 않는다', () => {
    // 상담 기록에 손으로 옮겨 적히는 값이므로 1/I, 0/O 혼동이 없어야 한다
    const everyByte = new Uint8Array(256);
    for (let index = 0; index < 256; index += 1) everyByte[index] = index;
    const encoded = encodeBase32(everyByte);
    for (const forbidden of ['I', 'L', 'O', 'U']) {
      expect(encoded).not.toContain(forbidden);
    }
  });

  it('32글자 알파벳만 사용한다', () => {
    const bytes = new Uint8Array(320);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 256;
    expect(encodeBase32(bytes)).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/);
  });

  it('같은 입력은 언제나 같은 결과를 낸다', () => {
    const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(encodeBase32(bytes)).toBe(encodeBase32(bytes));
  });

  it('길이를 지정하면 그만큼만 낸다', () => {
    const bytes = Uint8Array.from([255, 255, 255, 255, 255, 255, 255, 255]);
    expect(encodeBase32(bytes, 8)).toHaveLength(8);
    expect(encodeBase32(bytes, 1)).toHaveLength(1);
  });

  it('길이를 지정한 결과는 전체 결과의 접두사다', () => {
    const bytes = Uint8Array.from([17, 34, 51, 68, 85, 102, 119, 136]);
    expect(encodeBase32(bytes).startsWith(encodeBase32(bytes, 5))).toBe(true);
  });

  it('요청 길이가 입력 바이트보다 길면 가능한 만큼만 낸다', () => {
    expect(encodeBase32(Uint8Array.from([255]), 8).length).toBeLessThanOrEqual(8);
  });

  it('빈 입력은 빈 문자열이다', () => {
    expect(encodeBase32(new Uint8Array(0))).toBe('');
  });

  it('첫 바이트가 0이어도 글자를 잃지 않는다', () => {
    // 0을 그냥 버리는 구현이 흔한데, ID 길이가 들쭉날쭉해지면 안 된다
    expect(encodeBase32(Uint8Array.from([0, 0, 0, 0, 0]), 8)).toBe('00000000');
  });

  describe('group', () => {
    it('지정한 크기마다 하이픈을 넣는다', () => {
      expect(group('A3F27K9M', 4)).toBe('A3F2-7K9M');
    });

    it('나누어떨어지지 않아도 남은 부분을 버리지 않는다', () => {
      expect(group('ABCDE', 2)).toBe('AB-CD-E');
    });

    it('그룹 크기보다 짧으면 그대로 둔다', () => {
      expect(group('AB', 4)).toBe('AB');
    });
  });
});
