# 0015. 周期性 WebSocket 通信优化(sysinfo 去重 + tmux_state JSON Patch 差量 + forcePublish batching)

- 状态:accepted
- 日期:2026-04-23
- 决策者:@ChuangLee
- 相关:ADR-0011(sysinfo 来源)、ADR-0013(多 slot 使 client 数 × 2~4,放大广播成本)、commit `16b553b`(已修的 50+ terminal_ready/sec 级联)、DESIGN_PRINCIPLES §1(低延迟、不闪烁)、北极星("精准控制 + 卓越 UX")。

## 背景

TM-Agent 没有传统意义上的 ping/pong 心跳,控制通道的周期性流量只有两条:

| 消息           | 来源                     | 周期        | 体积(典型)                                        | 广播策略                                                                                          |
| -------------- | ------------------------ | ----------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `tmux_state`   | `TmuxStateMonitor`(后端) | **2500 ms** | **2–10 KB/帧**(序列化整个 session/window/pane 树) | 所有 `authed` control client 全量广播;已有"序列化一致则跳过"的去重                                |
| `system_stats` | `SysinfoSampler`(后端)   | **2000 ms** | ~250 B/帧                                         | 所有 `authed` client 全量广播;前端 `useSysinfoStore.ingest` **无值变化检查**,每 2 s 都 `setState` |

加上一类非周期但频度受用户操作放大的广播:

- **`forcePublish()`**:每个 control mutation(`select_session`、`new_session`、`rename_window`、`send_compose`、…)的 `finally` 块都调一次,若用户在 ~50 ms 内连发 3 个命令 → 3 次完整 `tmux_state` 广播。

### 当前痛点

以 ADR-0013 的 Quad 布局 + 2 个浏览器 tab 为例(= 2 个 control WS,每个 tab 附带 4 条 terminal WS):

- **带宽冗余**:2.5 s × 2 client × 10 KB ≈ **8 KB/s**。`tmux_state` 里 **大部分字段不变**(窗口名、cwd、paneCount 等),真正常变的是 `lastActivity` 和个别 pane 的 `currentCommand`/`width/height`。
- **前端 re-render 浪涌**:`setSnapshot` / `ingest` 无论值是否变化都触发 zustand 通知,所有订阅 SessionList / SysinfoPanel / FilePanel 的组件都会 re-render。`system_stats` 每 2 s 都是一次"空"更新。
- **mutation 放大**:新建 session + 切换 window + 首条 compose 这种标准序列会在 1 秒内触发 **3 次** 10 KB 广播。

这些都不是 showstopper,但放到"北极星:精准控制 + 卓越 UX"的标尺下,**看得见的低效 = 看不见的卡顿**。ADR-0013 把桌面做到 4 slot 并行后,进一步的规模化要求控制通道本身先瘦身。

### 不做的事

显式排除:

- **不改采样周期**。2500 ms / 2000 ms 是 ADR-0011/现有体验平衡过的值,提速增开销、降速降灵敏,本 ADR 不触碰。
- **不合并 sysinfo 与 tmux_state**。两者语义、消费者、触发边界都不同;合并会让 ADR-0011 的 `unsupported` 分支与 tmux 的差量策略纠缠,得不偿失。
- **不上 binary 协议**(MessagePack / CBOR)。JSON Patch 的 gzip over WS 已经接近 MessagePack 在本场景的效果,换编码形态引入的运维与调试成本不值得。
- **不做 per-client 订阅过滤**(只发该 client 关心的 session/slot)。下一步 ADR 才评估,这次只把"全广播但体积瘦身"做到。

## 决策

三个独立但互补的优化,每个单独发布、单独回退:

### 1. Sysinfo 前端值变化去重

**改动**:`useSysinfoStore.ingest(sample)` 对新旧样本做字段级比较,若所有字段(`cpu` / `mem` / `load1` / `cores` / `uptimeSec`)与上一样本**逐字段全等**,丢弃该 sample,不 push 进环形缓冲、不 `set`。

**边界**:

- `uptimeSec` 严格单调递增,所以"全等"几乎不可能触发 → 这条实质上等于"没去重"。**我们放弃比较 `uptimeSec`**,因为它不影响任何可见渲染(SysinfoPanel 只用 `t/cpu/mem/load1/cores`,uptime 走 tooltip 通过 `samples[len-1].uptimeSec` 但用户看不出 2 s 和 4 s 的差别)。
- `t` 时间戳也不比较(肯定递增)。
- 真正比较的是 `cpu` / `mem` / `load1` / `cores`,且 **做 3 位小数取整** 后比较 —— 避免浮点抖动(`/proc/stat` 的 delta 计算会在空闲时产生 0.0001~0.001 的噪声,视觉上不应触发重渲染)。
- 若 `load1` 发生 ±0.005 以内的抖动(空闲 idle loadavg 的常态),也视为未变化。

**收益**:空闲机器上 `system_stats` 的前端 re-render 从 30 次/分降到 ~0 次。负载变化时正常响应。

**回退**:改动只在 `ingest` 里加 10 行代码,出问题可以单 commit revert。

### 2. `tmux_state` JSON Patch 差量广播

**协议新增**(追加到 `ControlServerMessage` 的 union):

```ts
export interface TmuxStatePatch {
  /** RFC 6902 ops. add/remove/replace 三种足够覆盖当前模型;move/copy/test 不使用。 */
  ops: Array<
    | { op: "add" | "replace"; path: string; value: unknown }
    | { op: "remove"; path: string }
  >;
}

// 追加到 ControlServerMessage union:
| {
    type: "tmux_state_delta";
    /** 自当前 WS 连接建立起单调递增的版本号,从 1 开始。 */
    version: number;
    /** 本 patch 应用于上一版本(version - 1)的基底。 */
    baseVersion: number;
    /** 来源的 capturedAt,便于 debug;前端通过 patch 后的 snapshot.capturedAt 得到新值。 */
    capturedAt: string;
    patch: TmuxStatePatch;
  }
```

**后端状态机**(per-client,不是 per-monitor):

- 每个 `ControlContext` 新增 `lastSentState?: TmuxStateSnapshot` 与 `stateVersion: number`(初始 0)。
- 当 `broadcastState(snapshot)` 被调用时,**对每个 authed client 独立决策**:
  - `lastSentState === undefined` → 发 `tmux_state`(全量),`stateVersion = 1`,`lastSentState = snapshot`。
  - 否则计算 `patch = diff(lastSentState, snapshot)`:
    - `patch.ops.length === 0` → 根本不发(和当前"序列化一致跳过"对齐,但改到 per-client 粒度,更严格)。
    - `serialize(patch).length >= serialize(snapshot).length * 0.6` → **发全量**(阈值 60%,证据不足时 fallback 更安全),同时重置 `stateVersion`。
    - 否则 → 发 `tmux_state_delta`,`version += 1`,`baseVersion = version - 1`,`lastSentState = snapshot`。
- WS 关闭 → 清理 `lastSentState`。

**差量算法选型**:

- **用 `fast-json-patch`**(npm 包,~3 KB 打包后,MIT,RFC 6902 标准实现)。它的 `compare(a, b)` 返回标准 ops 数组,`applyPatch(doc, ops)` 在前端应用。同一个库前后端都用,不用手写 diff。
- 不用 `immer` 的 patch(非 RFC 6902、私有格式)、不用 `json-diff-ts`(更重、输出格式非标)。
- 为什么选标准 JSON Patch 而不是自定义 delta:(a) 协议文档化零成本,(b) 调试面板可以直接 pretty-print,(c) 如果后来我们想把这条协议暴露给第三方客户端(比如 vscode 插件)不用重新定义格式。

**前端应用**:

- `useSessionsStore` 新增 `snapshotBaseRef`(保存上一份完整 snapshot)与 `stateVersion`。
- 收到 `tmux_state` → 直接 `setSnapshot`,重置 `stateVersion = msg.version ?? 1`(全量消息暗含 version=1 或沿用后端发来的 version;我们在后端全量路径也填 `version` 字段便于前端校验)。
- 实际上**全量消息不带 version**(protocol 里 `tmux_state` 字段不变),为了兼容当前的 `{ type: "tmux_state", state }` 单一形态。前端收到 `tmux_state` = 重置 base,`stateVersion` 重新以 delta 计数。
- 收到 `tmux_state_delta` → 校验 `baseVersion === 当前 stateVersion`:
  - 对齐 → `applyPatch(snapshotBaseRef, patch.ops)` 得到新 snapshot,`setSnapshot(next)`,`stateVersion = msg.version`。
  - 不对齐(丢包、重连、版本漂移)→ 丢弃 delta,**发送隐式请求**让后端重发全量:最简策略是前端不发任何消息,由后端下一次 `broadcastState` 自动 fallback。但这最长要等 2.5 s。加速路径:前端给 control WS 发一条新消息 `{ type: "resync_state" }`,后端收到 → 强制下次广播走全量路径。
- 协议扩充,客户端消息 union 里添加 `{ type: "resync_state" }`。

**兼容性**:

- 旧客户端不认识 `tmux_state_delta` → 会走 `default` 分支被静默丢弃。**因此后端必须带一个能力协商**:新客户端在 `auth` 消息里带 `capabilities: { stateDelta: true }`,后端只对声明了该能力的 client 走差量路径,其他继续发全量。
- 协议上 `auth` 消息追加可选字段 `capabilities?: { stateDelta?: boolean }`,向后兼容。

**收益估算**:

- 稳态(无操作)下 `tmux_state` 的 diff 通常只涉及 `lastActivity` 几个数字 → patch ops ≤ 5 个、体积 ~200 B → 相比 2–10 KB 全量,**节省 95%+ 带宽**。
- 高操作频率下(新建/重命名)patch 可能与全量体积接近,此时 60% 阈值保护下自动 fallback。
- 最坏情况 = 全量,不劣化。

**测试**:

- 单测:`diff(prev, next) → ops`、`applyPatch(prev, ops) → next` 往返一致性(property-based on snapshot fixtures)。
- 后端单测:三种分支(首次全量 / 空 diff 跳过 / 小 patch / 阈值触发 fallback)。
- 集成测:模拟 10 次连续 `forcePublish`,验证客户端收到的消息序列 + 最终 snapshot 与全量路径一致。
- 回归测:旧客户端(不声明 capability)仍只收 `tmux_state`,无行为变化。

### 3. `forcePublish` microtask batching

**改动**:`TmuxStateMonitor.forcePublish()` 从"每次调用立即 await publishSnapshot(true)"改为 **microtask 级 coalesce**:

```ts
private pendingForce: Promise<void> | null = null;

public async forcePublish(): Promise<void> {
  if (this.pendingForce) return this.pendingForce;

  this.pendingForce = Promise.resolve().then(async () => {
    try {
      clearTimeout(this.timer);
      this.timer = undefined;
      const generation = ++this.forceGeneration;
      await this.publishSnapshot(true);
      if (generation === this.forceGeneration) {
        this.scheduleNextTick();
      }
    } finally {
      this.pendingForce = null;
    }
  });
  return this.pendingForce;
}
```

**语义**:同一个 event-loop tick(更准确:同一 microtask 队列清空前)多次调用 `forcePublish` 只会真正 publish 一次。发起方仍能 `await` 到完成。

**边界**:

- 如果 publishSnapshot 内部 await 了异步(buildSnapshot 读 tmux),期间新的 `forcePublish` 调用 **会被合并到同一个 pendingForce**,看到同一结果。这是期望行为——多个 mutation 在后端被异步 sequentially 处理,它们最终要反映的 snapshot 是同一个"处理完所有 mutation 之后"的 tmux 状态。
- 不改变现有的 `forceGeneration` 语义(保留,以便定时 tick 能发现自己被并发 force 过而丢弃 stale 结果)。

**收益**:"连建 3 个 window"的场景从 3 次广播降到 1 次。与 §2 叠加,差量体积进一步被摊薄。

**测试**:

- 单测:同步连续调 10 次 `forcePublish`,`publishSnapshot` mock 被调用次数 ≤ 2(首次 + 下一 tick)。
- 集成测:模拟 mutation burst,统计 WS 观察到的 `tmux_state` / `tmux_state_delta` 总帧数。

## 实施分期

| PR  | 范围                                                                        | 依赖                                           |
| --- | --------------------------------------------------------------------------- | ---------------------------------------------- |
| #1  | Sysinfo 前端去重(§1)                                                        | 无                                             |
| #2  | tmux_state JSON Patch 差量(§2),含协议 + 能力协商 + 前端 applyPatch + resync | 新依赖 `fast-json-patch`                       |
| #3  | forcePublish microtask batching(§3)                                         | 不依赖 #2,但 #2 先落地能把 #3 的价值看得最清楚 |

每个 PR 独立通过 typecheck / unit / e2e,主分支随时可发布。

## 代价

- 新增一个前端依赖(`fast-json-patch`,~3 KB gzipped),可接受。
- 协议面 + 2 个 variant(`tmux_state_delta`、`resync_state`),+ auth 消息的 `capabilities` 可选字段。
- 后端每个 `ControlContext` 多一份 `lastSentState`(~10 KB 内存/client),4 slot × 2 tab 场景 ~80 KB,可忽略。
- 排查成本:当 tmux_state 行为可疑时,多一个"先看 delta 还是 full"的诊断步骤。开发环境用 verboseLog 打印 patch 的 op 数和体积即可覆盖。

## 撤销条件

单 PR 粒度撤销,不整体撤:

1. **§1 撤销**:如果 CPU sparkline 出现"明显变化但前端没刷新",把 `ingest` 的值比较去掉。
2. **§2 撤销**:如果差量路径在某些场景下引起客户端状态漂移且不易查,关 capability flag(前端硬编码 `capabilities: { stateDelta: false }`),后端自动降到全量。
3. **§3 撤销**:如果发现 batching 让某类 mutation 响应感知变慢(应该不会,microtask 粒度 < 1ms),直接 revert。

## 后续

- **per-client 订阅过滤**(只发该 client 当前 attached session 相关的子树)—— 比差量再进一步,但会破坏"任何 client 都看得到所有 session"的 UI 前提,要新 ADR 评估。
- **资源感知降频**:非焦点 slot 的 tmux_state 差量合并间隔延长到 5s 或 10s(仅前端感知层 throttle),承接 ADR-0013 §11 的 8+ slot 降级策略。
- **传输层压缩**:开启 WebSocket `permessage-deflate`。与本 ADR 互补、互不冲突,但需独立评估 CPU/延迟 trade-off。
