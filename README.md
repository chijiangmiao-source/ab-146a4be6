# 射频切换矩阵 · 探测串审计

控制器上电后可能停在任意内部位置，现场只能发送**同一串探测码**并读取回执。
本应用审计：是否存在一串探测码，使**任意两个不同初态产生不同的完整回执串**（从而唯一识别起始位置）。

- 录入：至多 10 个位置、2–4 个可打印 ASCII 探测码、每个位置 × 每个码的确定回执与下一位置。
- 结论：规范探测串（**最短优先，同长按探测码 ASCII 序取唯一解**），并逐轮列出仍未分开的初态对；
  或给出**经最小化等价类证明始终同回执的初态对**作为不可区分依据。
- 算法（`web/core.js`，在 Web Worker 中运行）：以“未分开位置对集合”为状态做**精确广度搜索**，
  命中后沿**回溯链**复原探测串并按初态复算每轮结果；不做初态响应枚举，也不做固定深度猜测。
- 缺失转移、重复位置、空码表、非确定定义等输入问题**一次性合并显示**，并清除旧结论。

## 运行（Docker Compose）

```sh
HOST_PORT=8080 docker compose up --build web
```

- 页面：<http://localhost:8080>（宿主端口由 `HOST_PORT` 配置，默认 8080）
- 健康检查：`GET /healthz` → `ok`（Compose 健康检查亦基于此端点）

## 验证（verify 服务）

```sh
docker compose up --build --exit-code-from verify verify
```

`verify` 等待 `web` 健康后依次执行，全部通过则以退出码 0 结束，否则非 0：

1. **代码测试**（`tests/core.test.js`）：可区分模型、等价反例、非法输入，及随机模型与暴力枚举对照；
2. **构建检查**（`verify/build-check.js`）：资产齐全、JS 语法、页面→Worker→核心引用链、产物组装；
3. **HTTP 冒烟**：`/healthz`、首页标记、`app.js` / `worker.js` / `core.js` 静态资源内容。

## 目录

```
docker-compose.yml      编排：web（页面+健康检查，可配置宿主端口）+ verify（验证后退出）
web/                    index.html / app.js / worker.js / core.js / nginx 配置 / Dockerfile
tests/core.test.js      核心算法单元测试（Node，无外部依赖）
verify/                 verify 服务：run.sh（测试→构建→冒烟→报告退出）/ build-check.js / Dockerfile
```
