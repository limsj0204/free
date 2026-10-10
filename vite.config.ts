import { defineConfig } from 'vite';

// 상대 경로로 빌드해서 어느 주소에 올려도 동작하게 한다.
export default defineConfig({
  base: './',
  // three.js 하나만으로 500kB를 넘어서 경고 기준을 올린다
  build: { chunkSizeWarningLimit: 1000 },
});
