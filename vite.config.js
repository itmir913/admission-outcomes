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
  transformIndexHtml: (html) => html
    .replace("connect-src 'none'", "connect-src 'self' ws: wss:")
    /*
     * 개발 클라이언트는 연결이 끊기면 **blob으로 만든 SharedWorker**를 띄워 서버를
     * 다시 찔러 본다. worker-src 를 따로 적지 않으면 script-src 가 대신 쓰이는데
     * 거기에 blob: 이 없어 콘솔이 CSP 위반으로 가득 찬다. 여는 것은 개발 서버뿐이다.
     */
    .replace("script-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-inline'; worker-src 'self' blob:")
});

export default defineConfig({
  // USB로 들고 다니는 단일 HTML과 Pages 배포를 같은 산출물로 낸다.
  // 상대 경로라야 file:// 로 열어도 동작한다
  base: './',
  plugins: [tailwindcss(), viteSingleFile(), relaxCspForDev()],
  /*
   * 개발 서버가 번들해 둘 의존성을 **못 박는다.**
   *
   * 적지 않으면 Vite가 모듈을 훑다가 새 의존성을 발견할 때마다 다시 번들하고,
   * 그 사이에 날아간 요청은 `504 Outdated Optimize Dep`으로 떨어진다.
   * 그러면 화면은 머리줄만 뜨고 아래가 비는데, 콘솔을 안 보면 CSS 문제처럼 보인다.
   * xlsx는 특히 크고 느려서 이 창이 넓다.
   */
  optimizeDeps: {
    include: ['xlsx', 'fflate']
  },
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
