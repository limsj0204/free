import { defineConfig } from 'vite';

// 상대 경로로 빌드해서 어느 주소에 올려도 동작하게 한다.
// 내야 수비(index.html)와 주루 판단(runner.html)은 구장·선수 코드를 같이 쓰는 별도 페이지다.
export default defineConfig({
  base: './',
  // three.js 하나만으로 500kB를 넘어서 경고 기준을 올린다
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: { input: { main: 'index.html', runner: 'runner.html' } },
  },
});
