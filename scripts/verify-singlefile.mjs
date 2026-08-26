/** 校验 dist/index.html 为自包含单文件：不允许任何外链资源引用。失败退出码 1。 */
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const offenders = [];

for (const m of html.matchAll(/<(?:script|link|img|source|video|audio)\b[^>]*?\b(?:src|href)="([^"]+)"/gi)) {
  const url = m[1];
  if (/^(?:https?:)?\/\//i.test(url) || url.startsWith('/')) offenders.push(url);
}
for (const m of html.matchAll(/url\(\s*['"]?(https?:)?\/\/[^)'"]+/gi)) offenders.push(m[0]);
if (!/<script\b/i.test(html)) offenders.push('<script> 缺失——产物疑似为空');

if (offenders.length) {
  console.error('[verify-singlefile] 发现外链引用，产物不自包含：');
  for (const o of offenders) console.error('  ✗ ' + o);
  process.exit(1);
}
const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log(`[verify-singlefile] OK -> dist/index.html 自包含 (${kb} KB)`);
