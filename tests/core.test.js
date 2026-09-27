/*
 * 核心算法单元测试（Node，无外部依赖）。
 * 覆盖：可区分模型（最短 + ASCII 序唯一）、等价反例（最小化等价类）、
 *       非法输入合并报告，并以暴力枚举作为独立对照验证随机模型。
 */
'use strict';
const assert = require('assert');
const Core = require('../web/core.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ✔ ' + name);
}

/* ---------- 工具 ---------- */
function rawFrom(positions, codes, rows) {
  return {
    positionsText: positions.join(','),
    codesText: codes.join(''),
    rows: rows.map(r => ({ position: r[0], code: r[1], receipt: r[2], next: r[3] }))
  };
}

/* 独立对照：按（长度, ASCII 序）枚举所有探测串，找第一个区分串 */
function bruteForce(model, maxDepth) {
  const codes = model.codes.slice().sort();
  const n = model.positions.length;
  const distinguishes = seq => {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let a = i, b = j, same = true;
        for (const c of seq) {
          if (model.trans[a][c].receipt !== model.trans[b][c].receipt) { same = false; break; }
          a = model.trans[a][c].next;
          b = model.trans[b][c].next;
        }
        if (same) return false;
      }
    }
    return true;
  };
  let frontier = [''];
  for (let d = 0; d <= maxDepth; d++) {
    for (const s of frontier) if (distinguishes(s)) return s;
    const next = [];
    for (const s of frontier) for (const c of codes) next.push(s + c);
    frontier = next;
  }
  return null;
}

/* 独立对照：两位置在给定深度内的所有串上回执是否完全一致 */
function alwaysSameReceipt(model, i, j, maxDepth) {
  const codes = model.codes.slice().sort();
  let frontier = [['', i, j]];
  for (let d = 0; d <= maxDepth; d++) {
    const next = [];
    for (const [, a, b] of frontier) {
      for (const c of codes) {
        if (model.trans[a][c].receipt !== model.trans[b][c].receipt) return false;
        next.push(['', model.trans[a][c].next, model.trans[b][c].next]);
      }
    }
    frontier = next;
  }
  return true;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 用例 ---------- */
console.log('核心算法单元测试');

const DEMO_DIST_ROWS = [
  ['A', 'a', '0', 'B'], ['A', 'b', '0', 'C'],
  ['B', 'a', '0', 'C'], ['B', 'b', '1', 'A'],
  ['C', 'a', '1', 'A'], ['C', 'b', '0', 'B']
];

test('可区分模型：规范探测串最短且按 ASCII 序唯一（= aa）', () => {
  const raw = rawFrom(['A', 'B', 'C'], ['a', 'b'], DEMO_DIST_ROWS);
  const r = Core.audit(raw);
  assert.strictEqual(r.status, 'distinguishable');
  assert.strictEqual(r.sequence, 'aa');
  assert.strictEqual(r.sequence, bruteForce(r.model, 6), '须与暴力枚举的规范解一致');
  // 逐轮未分开初态对：初始 3 对 → 发 a 后仅剩初态对 {A,B}（已演化到 B,C）→ 再发 a 后全部分开
  assert.deepStrictEqual(r.rounds.map(x => x.pairs.length), [3, 1, 0]);
  assert.deepStrictEqual(r.rounds[1].pairs, [[0, 1]]);
  // 各初态完整回执串两两不同
  assert.strictEqual(new Set(r.receipts).size, 3);
});

test('单位置模型：空探测串即可，无需发送任何码', () => {
  const r = Core.audit(rawFrom(['A'], ['a', 'b'], [['A', 'a', '0', 'A'], ['A', 'b', '1', 'A']]));
  assert.strictEqual(r.status, 'distinguishable');
  assert.strictEqual(r.sequence, '');
  assert.strictEqual(r.rounds.length, 1);
  assert.strictEqual(r.rounds[0].pairs.length, 0);
});

test('等价反例：最小化等价类给出始终同回执的初态对', () => {
  const raw = rawFrom(['A', 'B', 'C'], ['a', 'b'], [
    ['A', 'a', '0', 'A'], ['A', 'b', '1', 'C'],
    ['B', 'a', '0', 'A'], ['B', 'b', '1', 'C'],
    ['C', 'a', '1', 'B'], ['C', 'b', '0', 'A']
  ]);
  const r = Core.audit(raw);
  assert.strictEqual(r.status, 'indistinguishable');
  assert.deepStrictEqual(r.pair, [0, 1]); // A 与 B
  assert.deepStrictEqual(r.classes, [[0, 1], [2]]);
  // 独立验证：A、B 在长度 ≤7 的一切探测串上回执完全一致
  assert.ok(alwaysSameReceipt(r.model, 0, 1, 7), '等价对须始终同回执');
  // 且不存在区分串（深度 ≤8 的暴力枚举也找不到）
  assert.strictEqual(bruteForce(r.model, 8), null);
});

test('非法输入：重复位置 / 非确定定义 / 缺失转移 一次性合并报告', () => {
  const r = Core.audit(rawFrom(['A', 'A', 'B'], ['a', 'b'], [
    ['A', 'a', '0', 'A'],
    ['A', 'a', '1', 'B'] // 与上一行冲突 → 非确定
    // A 缺 b；B 缺 a、b
  ]));
  assert.strictEqual(r.status, 'invalid');
  const text = r.errors.join('\n');
  assert.ok(/重复位置/.test(text), '应含重复位置');
  assert.ok(/非确定定义/.test(text), '应含非确定定义');
  assert.ok((text.match(/缺失转移/g) || []).length === 3, '应含 3 条缺失转移，实际：\n' + text);
});

test('非法输入：空码表与未知探测码合并报告', () => {
  const r = Core.audit(rawFrom(['A', 'B'], [], [['A', 'x', '0', 'A']]));
  assert.strictEqual(r.status, 'invalid');
  const text = r.errors.join('\n');
  assert.ok(/空码表/.test(text), '应含空码表');
  assert.ok(/未知探测码/.test(text), '应含未知探测码');
});

test('非法输入：重复转移定义 / 位置过多 / 码数越界 / 非法字符', () => {
  const dup = Core.audit(rawFrom(['A', 'B'], ['a', 'b'], [
    ['A', 'a', '0', 'A'], ['A', 'a', '0', 'A'], // 完全相同的重复定义
    ['A', 'b', '0', 'A'], ['B', 'a', '0', 'A'], ['B', 'b', '0', 'A']
  ]));
  assert.ok(/重复转移定义/.test(dup.errors.join('\n')));

  const many = Core.audit(rawFrom(
    ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10'], ['a', 'b'], []));
  assert.ok(/位置过多/.test(many.errors.join('\n')));

  assert.ok(/探测码不足/.test(Core.audit(rawFrom(['A'], ['a'], [])).errors.join('\n')));
  assert.ok(/探测码过多/.test(Core.audit(rawFrom(['A'], ['a', 'b', 'c', 'd', 'e'], [])).errors.join('\n')));
  assert.ok(/非法探测码/.test(Core.audit(rawFrom(['A'], ['a', '中'], [])).errors.join('\n')));
  assert.ok(/回执/.test(Core.audit(rawFrom(['A'], ['a', 'b'],
    [['A', 'a', '01', 'A'], ['A', 'b', '0', 'A']])).errors.join('\n')), '多字符回执须报错');
});

test('确定性：同一输入两次审计结果完全一致', () => {
  const raw = rawFrom(['A', 'B', 'C'], ['a', 'b'], DEMO_DIST_ROWS);
  assert.deepStrictEqual(Core.audit(raw), Core.audit(raw));
});

test('随机模型：与暴力枚举对照（最短 + ASCII 序）', () => {
  const rnd = mulberry32(20260927);
  let dist = 0, none = 0, eq = 0;
  for (let t = 0; t < 400; t++) {
    const n = 2 + Math.floor(rnd() * 3); // 2..4 个位置
    const codes = ['a', 'b'];
    const positions = Array.from({ length: n }, (_, i) => 'P' + i);
    const rows = [];
    for (const p of positions) {
      for (const c of codes) {
        rows.push([p, c, rnd() < 0.5 ? '0' : '1', positions[Math.floor(rnd() * n)]]);
      }
    }
    const raw = rawFrom(positions, codes, rows);
    const model = Core.validate(raw).model;
    assert.ok(model, '随机模型应合法');
    const r = Core.audit(raw);
    const bf = bruteForce(model, 10);
    if (r.status === 'distinguishable') {
      dist++;
      assert.strictEqual(r.sequence, bf, '规范解须等于暴力枚举结果，模型：' + JSON.stringify(rows));
      assert.strictEqual(r.rounds[r.rounds.length - 1].pairs.length, 0, '末轮须全部分开');
      assert.strictEqual(new Set(r.receipts).size, n, '各初态回执串须两两不同');
    } else {
      none++;
      assert.strictEqual(bf, null, '核心判定不可区分时，深度 10 暴力枚举也不应找到');
      if (r.status === 'indistinguishable') {
        eq++;
        assert.ok(alwaysSameReceipt(r.model, r.pair[0], r.pair[1], 8),
          '报告的等价对须始终同回执');
      }
    }
  }
  console.log(`    （随机 400 例：可区分 ${dist}，不可区分 ${none}，其中含等价对 ${eq}）`);
});

console.log(`全部 ${passed} 项测试通过`);
