/*
 * Web Worker：在后台线程执行精确审计（对集合 BFS + 回溯链复算），避免阻塞页面。
 * 核心逻辑与 Node 测试共用 core.js。
 */
importScripts('core.js');

self.onmessage = function (ev) {
  let result;
  try {
    result = MealyCore.audit(ev.data);
  } catch (err) {
    result = { status: 'error', message: String((err && err.stack) || err) };
  }
  self.postMessage(result);
};
