// dist/ 빌드 결과를 한 장짜리 HTML로 합친다 (CSS와 JS를 인라인).
// claude.ai 아티팩트처럼 문서 뼈대(<html>, <head>, <body>)를 따로 씌워주는 곳에 올릴 때 쓴다.
// 사용법: npm run build && node scripts/build-artifact.mjs <출력 파일>
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const out = process.argv[2];
if (!out) {
  console.error('출력 파일 경로를 지정하세요');
  process.exit(1);
}

const dist = join(dirname(new URL(import.meta.url).pathname), '..', 'dist');
const html = readFileSync(join(dist, 'index.html'), 'utf8');

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
