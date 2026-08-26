/**
 * 浩劫 · 零依赖构建脚本
 * 将 src/ 下的 CSS 与 JS（按声明顺序）内联进 template.html，
 * 产出 dist/haojie.html 单文件成品。
 *
 * 用法：node build.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');

/** JS 拼接顺序：数据层 -> 逻辑层 -> 表现层。顺序不可随意调换。 */
const SCRIPTS = [
  'js/rng.js',
  'js/data.js',
  'js/state.js',
  'js/rules.js',
  'js/engine.js',
  'js/abilities.js',
  'js/spells.js',
  'js/game.js',
  'js/fx.js',
  'js/ui.js',
  'js/input.js',
  'js/codex.js',
  'js/main.js',
];

function read(rel) {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

function build() {
  const template = read('template.html');
  const css = read('css/style.css');

  // 所有脚本拼进同一个 IIFE，共享作用域；'use strict' 保证整洁。
  const js = SCRIPTS.map(read).join('\n\n');
  const wrapped =
    '(function () {\n"use strict";\n' + js + '\n})();\n';

  let html = template;
  if (!html.includes('/*__STYLE__*/') || !html.includes('//__SCRIPTS__')) {
    throw new Error('模板缺少占位符 /*__STYLE__*/ 或 //__SCRIPTS__');
  }
  html = html.replace('/*__STYLE__*/', () => css);
  html = html.replace('//__SCRIPTS__', () => wrapped);

  fs.mkdirSync(DIST, { recursive: true });
  const out = path.join(DIST, 'haojie.html');
  fs.writeFileSync(out, html, 'utf8');
  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log(`[build] OK -> dist/haojie.html (${kb} KB)`);
}

build();
