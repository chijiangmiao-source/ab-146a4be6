/* 页面交互：录入模型 → Web Worker 审计 → 渲染结论 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const rowsEl = $('rows');

  const escapeHtml = s => String(s).replace(/[&<>"']/g,
    m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  function splitList(text) {
    return String(text || '').split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean);
  }
  function unique(list) {
    const seen = new Set();
    const out = [];
    for (const x of list) if (!seen.has(x)) { seen.add(x); out.push(x); }
    return out;
  }
  /* 与核心一致：探测码按字符拆分 */
  function parseCodes(text) {
    return String(text || '').replace(/[,，、\s]+/g, '').split('');
  }

  /* ---------- 转移行 ---------- */
  function addRow(pos, code, receipt, next) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td><input class="c-pos" list="posList" maxlength="16" placeholder="位置" value="' + escapeHtml(pos || '') + '"></td>' +
      '<td><input class="c-code" list="codeList" maxlength="1" placeholder="码" value="' + escapeHtml(code || '') + '"></td>' +
      '<td><input class="c-rec" maxlength="1" placeholder="回执" value="' + escapeHtml(receipt || '') + '"></td>' +
      '<td><input class="c-next" list="posList" maxlength="16" placeholder="下一位置" value="' + escapeHtml(next || '') + '"></td>' +
      '<td><button type="button" class="del" title="删除此行">✕</button></td>';
    tr.querySelector('.del').addEventListener('click', () => { tr.remove(); clearOutput(); });
    tr.querySelectorAll('input').forEach(i => i.addEventListener('input', clearOutput));
    rowsEl.appendChild(tr);
  }

  function refreshDatalists() {
    $('posList').innerHTML = unique(splitList($('positions').value))
      .map(p => '<option value="' + escapeHtml(p) + '">').join('');
    $('codeList').innerHTML = unique(parseCodes($('codes').value))
      .map(c => '<option value="' + escapeHtml(c) + '">').join('');
  }

  function fillGrid() {
    const poss = unique(splitList($('positions').value));
    const codes = unique(parseCodes($('codes').value));
    const have = new Set();
    rowsEl.querySelectorAll('tr').forEach(tr => {
      have.add(tr.querySelector('.c-pos').value.trim() + '\0' + tr.querySelector('.c-code').value.trim());
    });
    for (const p of poss) {
      for (const c of codes) {
        if (!have.has(p + '\0' + c)) addRow(p, c, '', '');
      }
    }
    clearOutput();
  }

  /* ---------- 示例 ---------- */
  const DEMO_DIST = {
    positions: 'A,B,C', codes: 'ab',
    rows: [
      ['A', 'a', '0', 'B'], ['A', 'b', '0', 'C'],
      ['B', 'a', '0', 'C'], ['B', 'b', '1', 'A'],
      ['C', 'a', '1', 'A'], ['C', 'b', '0', 'B']
    ]
  };
  const DEMO_EQ = {
    positions: 'A,B,C', codes: 'ab',
    rows: [
      ['A', 'a', '0', 'A'], ['A', 'b', '1', 'C'],
      ['B', 'a', '0', 'A'], ['B', 'b', '1', 'C'],
      ['C', 'a', '1', 'B'], ['C', 'b', '0', 'A']
    ]
  };
  function loadDemo(d) {
    $('positions').value = d.positions;
    $('codes').value = d.codes;
    rowsEl.innerHTML = '';
    d.rows.forEach(r => addRow(r[0], r[1], r[2], r[3]));
    refreshDatalists();
    clearOutput();
  }

  /* ---------- 输入收集 ---------- */
  function collect() {
    const rows = [];
    rowsEl.querySelectorAll('tr').forEach(tr => {
      const pos = tr.querySelector('.c-pos').value.trim();
      const code = tr.querySelector('.c-code').value.trim();
      const rec = tr.querySelector('.c-rec').value.trim();
      const next = tr.querySelector('.c-next').value.trim();
      if (!pos && !code && !rec && !next) return; // 完全空白行忽略
      rows.push({ position: pos, code: code, receipt: rec, next: next });
    });
    return { positionsText: $('positions').value, codesText: $('codes').value, rows };
  }

  /* ---------- 输出 ---------- */
  function clearOutput() {
    $('errorPanel').hidden = true;
    $('resultPanel').hidden = true;
    $('errors').innerHTML = '';
    $('result').innerHTML = '';
  }
  function showErrors(errors) {
    $('resultPanel').hidden = true; // 清除旧结论
    $('result').innerHTML = '';
    $('errCount').textContent = errors.length;
    $('errors').innerHTML = errors.map(e => '<li>' + escapeHtml(e) + '</li>').join('');
    $('errorPanel').hidden = false;
  }
  function pairChip(names, p) {
    return '<span class="chip pair">{' + escapeHtml(names[p[0]]) + ', ' + escapeHtml(names[p[1]]) + '}</span>';
  }
  function render(res) {
    if (res.status === 'invalid') { showErrors(res.errors); return; }
    $('errorPanel').hidden = true;
    const box = $('result');
    $('resultPanel').hidden = false;
    if (res.status === 'distinguishable') box.innerHTML = htmlDist(res);
    else if (res.status === 'indistinguishable') box.innerHTML = htmlIndist(res);
    else if (res.status === 'no-preset') box.innerHTML = htmlNoPreset(res);
    else if (res.status === 'overflow') {
      box.innerHTML = '<p class="bad">搜索空间超出资源上限（已访问 ' + res.visited +
        ' 个对集合状态，上限 ' + res.limit + '）。请化简模型后重试。</p>';
    } else {
      box.innerHTML = '<p class="bad">内部错误：' + escapeHtml(res.message || '未知') + '</p>';
    }
  }

  function htmlDist(res) {
    const names = res.model.positions;
    const seqHtml = res.codes.length
      ? res.codes.map(c => '<code class="code">' + escapeHtml(c) + '</code>').join('<span class="arrow">→</span>')
      : '<em>空串（仅一个位置，无需发送任何探测码）</em>';
    let h = '<p class="ok">✔ 存在规范探测串（最短优先，同长按探测码 ASCII 序取唯一解）</p>';
    h += '<p class="seq">规范探测串：' + seqHtml +
      '　<span class="muted">长度 ' + res.codes.length + '</span></p>';
    h += '<h3>逐轮仍未分开的初态对</h3>' +
      '<table class="rounds"><thead><tr><th>轮次</th><th>发送</th><th>仍未分开的初态对</th></tr></thead><tbody>';
    res.rounds.forEach((r, i) => {
      const pairs = r.pairs.length
        ? r.pairs.map(p => pairChip(names, p)).join(' ')
        : '<span class="ok">全部可区分 ✔</span>';
      h += '<tr><td>' + i + '</td><td>' +
        (r.code === null ? '<span class="muted">（初始）</span>'
          : '<code class="code">' + escapeHtml(r.code) + '</code>') +
        '</td><td>' + pairs + '</td></tr>';
    });
    h += '</tbody></table>';
    h += '<h3>各初态的完整回执串（两两不同）</h3>' +
      '<table class="rounds"><thead><tr><th>初态</th><th>完整回执串</th></tr></thead><tbody>';
    res.receipts.forEach((rc, i) => {
      h += '<tr><td>' + escapeHtml(names[i]) + '</td><td><code class="code">' +
        (rc ? escapeHtml(rc) : '（空）') + '</code></td></tr>';
    });
    h += '</tbody></table>';
    return h;
  }

  function htmlIndist(res) {
    const names = res.model.positions;
    const a = res.pair[0];
    const b = res.pair[1];
    let h = '<p class="bad">✘ 不存在满足条件的探测串。</p>';
    h += '<p>经最小化等价类证明，初态对 <span class="chip pair">{' + escapeHtml(names[a]) +
      ', ' + escapeHtml(names[b]) + '}</span> 对任意探测串始终产生相同回执，无法区分。</p>';
    h += '<h3>最小化等价类（同类位置对一切探测串回执完全一致）</h3><ol>';
    res.classes.forEach(g => {
      h += '<li>' + g.map(i => '<span class="chip">' + escapeHtml(names[i]) + '</span>').join(' ') +
        (g.length > 1 ? ' <span class="bad">← 等价，不可区分</span>' : '') + '</li>';
    });
    h += '</ol>';
    return h;
  }

  function htmlNoPreset(res) {
    const names = res.model.positions;
    let h = '<p class="bad">✘ 不存在单一规范探测串。</p>';
    h += '<p>最小化后每个等价类均只含一个位置（任意两位置都可分别区分），' +
      '但不存在能同时分开所有初态对的预置探测串。</p>';
    h += '<h3>最小化等价类</h3><ol>';
    res.classes.forEach(g => {
      h += '<li>' + g.map(i => '<span class="chip">' + escapeHtml(names[i]) + '</span>').join(' ') + '</li>';
    });
    h += '</ol>';
    return h;
  }

  /* ---------- Worker ---------- */
  let worker = null;
  let timer = null;
  function finish() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (worker) { worker.terminate(); worker = null; }
    $('audit').disabled = false;
    $('busy').hidden = true;
  }
  function runAudit() {
    clearOutput();
    $('audit').disabled = true;
    $('busy').hidden = false;
    if (worker) worker.terminate();
    worker = new Worker('worker.js');
    timer = setTimeout(() => {
      finish();
      showErrors(['计算超时：搜索空间过大，已终止。请化简模型后重试。']);
    }, 60000);
    worker.onmessage = ev => { finish(); render(ev.data); };
    worker.onerror = e => { finish(); showErrors(['Worker 异常：' + (e.message || '未知错误')]); };
    worker.postMessage(collect());
  }

  /* ---------- 事件 ---------- */
  $('audit').addEventListener('click', runAudit);
  $('addRow').addEventListener('click', () => { addRow(); });
  $('fillGrid').addEventListener('click', fillGrid);
  $('demoDist').addEventListener('click', () => loadDemo(DEMO_DIST));
  $('demoEq').addEventListener('click', () => loadDemo(DEMO_EQ));
  $('clearAll').addEventListener('click', () => {
    $('positions').value = '';
    $('codes').value = '';
    rowsEl.innerHTML = '';
    refreshDatalists();
    clearOutput();
  });
  $('positions').addEventListener('input', () => { refreshDatalists(); clearOutput(); });
  $('codes').addEventListener('input', () => { refreshDatalists(); clearOutput(); });

  loadDemo(DEMO_DIST); // 默认载入可区分示例
})();
