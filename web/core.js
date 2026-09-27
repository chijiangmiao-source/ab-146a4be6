/*
 * 射频切换矩阵 · 探测串审计核心（纯逻辑）
 * 浏览器 Web Worker 与 Node 测试共用同一份实现。
 *
 * 模型：Mealy 型 —— 每个位置对每个探测码有确定回执（单字符）与下一位置。
 * 目标：规范探测串 —— 使任意两个不同初态产生不同的完整回执串；
 *       优先最短长度，其次按探测码 ASCII 序取唯一解。
 * 方法：以“仍未分开的位置对集合”为状态做精确广度搜索（BFS），
 *       命中后沿回溯链复原探测串，并按初态复算每轮未分开的初态对。
 *       不存在时以划分精化做最小化，给出始终同回执的等价初态对。
 */
(function (global, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MealyCore = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const MAX_POSITIONS = 10;
  const MIN_CODES = 2;
  const MAX_CODES = 4;
  const MAX_BFS_STATES = 1000000; // 资源上限；触发时如实报告，绝不靠固定深度猜测

  function isPrintableAscii(ch) {
    return typeof ch === 'string' && ch.length === 1 &&
      ch.charCodeAt(0) >= 0x21 && ch.charCodeAt(0) <= 0x7e;
  }

  function splitList(text) {
    return String(text == null ? '' : text)
      .split(/[,，、\s]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  /* 探测码按字符拆分：每个码都是单个字符，"ab"、"a,b"、"a b" 等价 */
  function splitCodes(text) {
    return String(text == null ? '' : text)
      .replace(/[,，、\s]+/g, '')
      .split('');
  }

  function dedupKeepOrder(list) {
    const seen = new Set();
    const out = [];
    for (const x of list) if (!seen.has(x)) { seen.add(x); out.push(x); }
    return out;
  }

  /* 校验原始录入，返回 { errors, model? }；所有问题一次性合并报告 */
  function validate(raw) {
    const errors = [];
    const positions = splitList(raw && raw.positionsText);
    const codes = splitCodes(raw && raw.codesText);
    const rows = Array.isArray(raw && raw.rows) ? raw.rows : [];

    // —— 位置 ——
    if (positions.length === 0) errors.push('位置列表为空：至少录入 1 个位置');
    const dupPos = [];
    {
      const seen = new Set();
      for (const p of positions) {
        if (seen.has(p) && dupPos.indexOf(p) === -1) dupPos.push(p);
        seen.add(p);
      }
    }
    for (const p of dupPos) errors.push(`重复位置：「${p}」被录入多次`);
    const posList = dedupKeepOrder(positions);
    if (posList.length > MAX_POSITIONS) {
      errors.push(`位置过多：去重后共 ${posList.length} 个，至多 ${MAX_POSITIONS} 个`);
    }
    const posSet = new Set(posList);

    // —— 探测码 ——
    if (codes.length === 0) {
      errors.push('空码表：未录入任何探测码（需 2–4 个可打印 ASCII 字符）');
    } else {
      if (codes.length < MIN_CODES) errors.push(`探测码不足：仅 ${codes.length} 个，至少 ${MIN_CODES} 个`);
      if (codes.length > MAX_CODES) errors.push(`探测码过多：共 ${codes.length} 个，至多 ${MAX_CODES} 个`);
      const seen = new Set();
      const dup = new Set();
      for (const c of codes) {
        if (!isPrintableAscii(c)) errors.push(`非法探测码：「${c}」须为单个可打印 ASCII 字符`);
        else if (seen.has(c)) dup.add(c);
        else seen.add(c);
      }
      for (const c of dup) errors.push(`重复探测码：「${c}」被录入多次`);
    }
    const codeList = dedupKeepOrder(codes.filter(isPrintableAscii));
    const codeSet = new Set(codeList);

    // —— 转移行 ——
    const byKey = new Map(); // "pos\0code" -> [{receipt,next}]
    rows.forEach((r, idx) => {
      const line = `转移第 ${idx + 1} 行`;
      const pos = String((r && r.position) || '').trim();
      const code = String((r && r.code) || '').trim();
      const receipt = String((r && r.receipt) || '').trim();
      const next = String((r && r.next) || '').trim();
      const posOk = posSet.has(pos);
      const codeOk = codeSet.has(code);
      if (!posOk) errors.push(`${line}：未知位置「${pos}」（不在位置表中）`);
      if (!codeOk) errors.push(`${line}：未知探测码「${code}」（不在码表中）`);
      if (!isPrintableAscii(receipt)) errors.push(`${line}：回执「${receipt}」须为单个可打印 ASCII 字符`);
      if (!next) errors.push(`${line}：下一位置为空`);
      else if (!posSet.has(next)) errors.push(`${line}：下一位置「${next}」不在位置表中`);
      if (posOk && codeOk) {
        const k = pos + '\0' + code;
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push({ receipt, next });
      }
    });
    for (const [k, list] of byKey) {
      if (list.length > 1) {
        const parts = k.split('\0');
        const pos = parts[0];
        const code = parts[1];
        const conflict = list.some(r => r.receipt !== list[0].receipt || r.next !== list[0].next);
        if (conflict) {
          errors.push(`非确定定义：位置「${pos}」对探测码「${code}」有 ${list.length} 条互相冲突的转移`);
        } else {
          errors.push(`重复转移定义：位置「${pos}」对探测码「${code}」被重复录入 ${list.length} 次`);
        }
      }
    }
    for (const p of posList) {
      for (const c of codeList) {
        if (!byKey.has(p + '\0' + c)) errors.push(`缺失转移：位置「${p}」对探测码「${c}」无定义`);
      }
    }

    if (errors.length) return { errors };

    const posIndex = new Map(posList.map((p, i) => [p, i]));
    const trans = posList.map(() => ({}));
    for (const [k, list] of byKey) {
      const parts = k.split('\0');
      const p = parts[0];
      const c = parts[1];
      trans[posIndex.get(p)][c] = { receipt: list[0].receipt, next: posIndex.get(list[0].next) };
    }
    return { errors: [], model: { positions: posList, codes: codeList, trans } };
  }

  /* 以“未分开位置对集合”为状态的精确广度搜索 */
  function distinguish(model) {
    const n = model.positions.length;
    const codes = model.codes.slice().sort(); // ASCII 升序扩展：同长时取字典序最小
    const pack = (a, b) => (a < b ? a * 16 + b : b * 16 + a);
    const canon = arr => arr.slice().sort((x, y) => x - y).join(',');

    const start = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) start.push(pack(i, j));
    if (start.length === 0) {
      return { ok: true, codes: [], rounds: [{ code: null, pairs: [] }] };
    }

    // 对一个对集合施加探测码 c；若有某对汇合到同一位置（永远无法再分开），该分支返回 null
    function step(setArr, c) {
      const out = new Set();
      for (const k of setArr) {
        const a = (k / 16) | 0;
        const b = k % 16;
        const ta = model.trans[a][c];
        const tb = model.trans[b][c];
        if (ta.receipt !== tb.receipt) continue; // 回执不同：此对被分开
        if (ta.next === tb.next) return null;    // 汇合：沿此分支永远分不开此对
        out.add(pack(ta.next, tb.next));
      }
      return Array.from(out);
    }

    const startKey = canon(start);
    const visited = new Map([[startKey, { parent: null, code: null, set: start }]]);
    let queue = [startKey];
    let goalKey = null;

    outer:
    while (queue.length > 0) {
      const nextQueue = [];
      for (const k of queue) {
        const set = visited.get(k).set;
        for (const c of codes) {
          const t = step(set, c);
          if (t === null) continue;
          const tk = canon(t);
          if (visited.has(tk)) continue;
          visited.set(tk, { parent: k, code: c, set: t });
          if (t.length === 0) { goalKey = tk; break outer; }
          nextQueue.push(tk);
        }
      }
      queue = nextQueue;
      if (visited.size > MAX_BFS_STATES) {
        return { ok: false, reason: 'overflow', visited: visited.size };
      }
    }

    if (goalKey === null) return { ok: false, reason: 'no-sequence' };

    // 回溯链：从目标状态沿父指针复原探测串
    const chain = [];
    for (let k = goalKey; k !== null;) {
      const node = visited.get(k);
      chain.push(node);
      k = node.parent;
    }
    chain.reverse();
    const seqCodes = chain.slice(1).map(nd => nd.code);

    // 复算：按初态逐轮模拟，列出每轮仍未分开的初态对
    const rounds = [];
    let cur = model.positions.map((_, i) => i);
    let alive = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) alive.push([i, j]);
    rounds.push({ code: null, pairs: alive.map(p => p.slice()) });
    for (const c of seqCodes) {
      alive = alive.filter(pair =>
        model.trans[cur[pair[0]]][c].receipt === model.trans[cur[pair[1]]][c].receipt);
      cur = cur.map(s => model.trans[s][c].next);
      rounds.push({ code: c, pairs: alive.map(p => p.slice()) });
    }
    return { ok: true, codes: seqCodes, rounds };
  }

  /* 划分精化最小化：返回等价类（位置下标数组的数组） */
  function minimize(model) {
    const codes = model.codes.slice().sort();
    const compress = sigs => {
      const ids = new Map();
      return sigs.map(s => {
        if (!ids.has(s)) ids.set(s, ids.size);
        return ids.get(s);
      });
    };
    let block = compress(model.positions.map((_, i) =>
      codes.map(c => model.trans[i][c].receipt).join('')));
    for (;;) {
      const next = compress(model.positions.map((_, i) =>
        codes.map(c => model.trans[i][c].receipt + '' + block[model.trans[i][c].next]).join('')));
      if (next.every((b, i) => b === block[i])) break;
      block = next;
    }
    const groups = new Map();
    block.forEach((b, i) => {
      if (!groups.has(b)) groups.set(b, []);
      groups.get(b).push(i);
    });
    return Array.from(groups.values()).sort((a, b) => a[0] - b[0]);
  }

  /* 审计入口 */
  function audit(raw) {
    const v = validate(raw);
    if (v.errors.length) return { status: 'invalid', errors: v.errors };
    const model = v.model;

    const d = distinguish(model);
    if (d.ok) {
      const receipts = model.positions.map((_, i) => {
        let s = i;
        let out = '';
        for (const c of d.codes) { out += model.trans[s][c].receipt; s = model.trans[s][c].next; }
        return out;
      });
      return {
        status: 'distinguishable',
        model,
        codes: d.codes,
        sequence: d.codes.join(''),
        rounds: d.rounds,
        receipts
      };
    }
    if (d.reason === 'overflow') {
      return { status: 'overflow', visited: d.visited, limit: MAX_BFS_STATES };
    }
    const classes = minimize(model);
    const big = classes.filter(g => g.length > 1);
    if (big.length > 0) {
      let pair = null;
      for (const g of big) {
        const cand = [g[0], g[1]];
        if (!pair || cand[0] < pair[0] || (cand[0] === pair[0] && cand[1] < pair[1])) pair = cand;
      }
      return { status: 'indistinguishable', model, pair, classes };
    }
    // 约简机但仍无预置探测串（理论上的罕见情形），如实报告
    return { status: 'no-preset', model, classes };
  }

  return { validate, distinguish, minimize, audit, MAX_POSITIONS, MIN_CODES, MAX_CODES };
});
