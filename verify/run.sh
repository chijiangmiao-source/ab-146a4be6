#!/bin/sh
# verify：代码测试 → 构建检查 → HTTP 冒烟，汇总报告后以状态码退出。
STATUS=0

say() { printf '%s\n' "$*"; }

step() {
  name="$1"; shift
  say "── $name ──"
  if "$@"; then
    say "✔ $name：通过"
  else
    say "✘ $name：失败"
    STATUS=1
  fi
  say ""
}

smoke() {
  rc=0
  body=$(wget -q -O- --timeout=5 http://web/healthz) || rc=1
  if [ "$body" = "ok" ]; then
    echo "  /healthz → ok"
  else
    echo "  /healthz 异常：[$body]"; rc=1
  fi

  home=$(wget -q -O- --timeout=5 http://web/) || rc=1
  echo "$home" | grep -q "探测串审计" && echo "  / 包含页面标记" || { echo "  / 缺少页面标记"; rc=1; }
  echo "$home" | grep -q 'src="app.js"' && echo "  / 引用 app.js" || { echo "  / 未引用 app.js"; rc=1; }

  wjs=$(wget -q -O- --timeout=5 http://web/worker.js) || rc=1
  echo "$wjs" | grep -q "importScripts('core.js')" && echo "  /worker.js 加载核心" || { echo "  /worker.js 内容异常"; rc=1; }

  cjs=$(wget -q -O- --timeout=5 http://web/core.js) || rc=1
  echo "$cjs" | grep -q "MealyCore" && echo "  /core.js 含核心实现" || { echo "  /core.js 内容异常"; rc=1; }

  ajs=$(wget -q -O- --timeout=5 http://web/app.js) || rc=1
  echo "$ajs" | grep -q "new Worker('worker.js')" && echo "  /app.js 启动 Worker" || { echo "  /app.js 内容异常"; rc=1; }

  return $rc
}

say "════════ verify：射频切换矩阵探测串审计 ════════"
step "代码测试（可区分模型 / 等价反例 / 非法输入）" node /src/tests/core.test.js
step "构建检查（语法 / 引用 / 产物组装）" node /src/verify/build-check.js
step "HTTP 冒烟（页面 / 健康检查 / 静态资源）" smoke
say "═══════════════════════════════════════════════"
if [ "$STATUS" -eq 0 ]; then
  say "VERIFY 结果：全部通过 ✔"
else
  say "VERIFY 结果：存在失败项 ✘"
fi
exit "$STATUS"
