// 페이지 하나를 빌드해서 한 장짜리 HTML로 합친다 (CSS와 JS를 인라인).
// claude.ai 아티팩트처럼 문서 뼈대(<html>, <head>, <body>)를 따로 씌워주는 곳에 올릴 때 쓴다.
// 사용법: node scripts/build-artifact.mjs <출력 파일> [페이지]
//   페이지: index.html(내야 수비, 기본) 또는 runner.html(주루 판단)
// 두 페이지를 같이 빌드하면 공통 코드가 따로 나뉘어서, 여기서는 페이지 하나만 따로 빌드한다.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { build } from 'vite';

const out = process.argv[2];
const page = process.argv[3] ?? 'index.html';
if (!out) {
  console.error('출력 파일 경로를 지정하세요');
  process.exit(1);
}

const root = join(dirname(new URL(import.meta.url).pathname), '..');
const dist = join(root, 'dist-artifact');
await build({ root, logLevel: 'warn', build: { outDir: dist, emptyOutDir: true, rollupOptions: { input: join(root, page) } } });
const html = readFileSync(join(dist, page), 'utf8');

const title = html.match(/<title>(.*?)<\/title>/)[1];
const cssHref = html.match(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"/)[1];
const jsSrc = html.match(/<script type="module"[^>]*src="\.\/([^"]+)"/)[1];
const body = html
  .match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .trim();

const css = readFileSync(join(dist, cssHref), 'utf8');
const js = readFileSync(join(dist, jsSrc), 'utf8').replace(/<\/script/gi, '<\\/script');

writeFileSync(
  out,
  `<title>${title}</title>\n<style>\n${css}\n</style>\n${body}\n<script type="module">\n${js}\n</script>\n`,
);
console.log(`${out} (${(Buffer.byteLength(readFileSync(out)) / 1024).toFixed(0)} KB)`);
