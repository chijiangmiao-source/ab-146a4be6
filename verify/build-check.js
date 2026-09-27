/*
 * 构建检查：校验前端资产存在、JS 语法正确、页面与 Worker 引用完整，
 * 并将产物组装到 /tmp/dist 以确认可发布。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const WEB = path.join(process.env.SRC_DIR || '/src', 'web');
const FILES = ['index.html', 'app.js', 'worker.js', 'core.js'];

for (const f of FILES) {
  const p = path.join(WEB, f);
  if (!fs.existsSync(p)) throw new Error('缺少文件：' + f);
  if (fs.statSync(p).size === 0) throw new Error('空文件：' + f);
}
console.log('  资产齐全：' + FILES.join(', '));

for (const f of ['app.js', 'worker.js', 'core.js']) {
  execFileSync(process.execPath, ['--check', path.join(WEB, f)], { stdio: 'inherit' });
}
console.log('  JS 语法检查通过（node --check）');

const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
if (!html.includes('src="app.js"')) throw new Error('index.html 未引用 app.js');
const workerSrc = fs.readFileSync(path.join(WEB, 'worker.js'), 'utf8');
if (!/importScripts\(\s*['"]core\.js['"]\s*\)/.test(workerSrc)) {
  throw new Error('worker.js 未通过 importScripts 加载 core.js');
}
const appSrc = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
if (!appSrc.includes("new Worker('worker.js')")) throw new Error('app.js 未启动 worker.js');
console.log('  引用链完整：index.html → app.js → worker.js → core.js');

const dist = '/tmp/dist';
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
for (const f of FILES) fs.copyFileSync(path.join(WEB, f), path.join(dist, f));
const total = FILES.reduce((s, f) => s + fs.statSync(path.join(dist, f)).size, 0);
console.log(`  产物组装完成：${dist}（${FILES.length} 个文件，共 ${total} 字节）`);
console.log('构建检查通过');
