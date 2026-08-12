import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * 개발 서버에서만 CSP를 한 칸 연다.
 *
 * 배포본은 `connect-src 'none'` 이다 — 바깥으로 나가는 요청 경로를 브라우저가 막는다.
 * 그런데 Vite 개발 서버는 웹소켓으로 갱신을 알리므로 그대로 두면 개발이 안 된다.
 * **여는 것은 개발 서버뿐이고, 빌드 산출물은 손대지 않는다.**
 */
const relaxCspForDev = () => ({
  name: 'relax-csp-for-dev',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace("connect-src 'none'", "connect-src 'self' ws: wss:")
});

export default defineConfig({
  // USB로 들고 다니는 단일 HTML과 Pages 배포를 같은 산출물로 낸다.
  // 상대 경로라야 file:// 로 열어도 동작한다
  base: './',
  plugins: [tailwindcss(), viteSingleFile(), relaxCspForDev()],
  build: {
    // 단일 파일로 합칠 것이므로 청크를 나누지 않는다
    assetsInlineLimit: 100 * 1024 * 1024,
    chunkSizeWarningLimit: 8000
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // PBKDF2를 60만 회 도는 테스트가 섞이므로 기본 타임아웃을 넉넉히 잡는다
    testTimeout: 30_000
  }
});
