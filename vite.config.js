import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // PBKDF2를 60만 회 도는 테스트가 섞이므로 기본 타임아웃을 넉넉히 잡는다
    testTimeout: 30_000
  }
});
