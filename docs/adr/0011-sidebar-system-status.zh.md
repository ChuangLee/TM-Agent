# 0011. 侧栏系统状态条(CPU / Mem / Load sparkline)

- 状态:accepted
- 日期:2026-04-22
- 决策者:@ChuangLee
- 相关:[research/0008](../research/0008-web-shell-file-transfer-and-sysinfo.md)、ROADMAP Post-v1 #11(本 ADR 通过后上移至 Phase 3b)、DESIGN_PRINCIPLES §1(一眼可辨)、ADR-0010(侧栏两尺寸)。

## 背景

2026-04-21 的 research/0008 对"web shell 要不要做系统状态面板"做了 prior art survey,结论是:

- 真正把 **终端 + 文件传输 + 系统状态** 三合一做到位的只有 Cockpit、Webmin,而这两者都是主机管理工具,不是 web shell。
- 我们若做,应该**彻底做小**:只在侧栏挂一条 CPU / Mem / Load 的 sparkline,不做服务/防火墙/日志面板。
- 当时把它挂到 Post-v1(#11),因为"文件传输更高频,系统状态是锦上添花"。

一天后(2026-04-22)改变主意把这件事拉回来,原因:

1. **实现成本极低**。Linux `/proc/{stat,meminfo,loadavg,uptime}` 是纯文件读,每 2s 一次采样开销可以忽略(<0.01% CPU,几 KB 内存)。没有 auth、没有路径遍历、没有大文件流——比文件传输简单一个量级。
2. **侧栏展开态目前底部大面积留白**(ADR-0010 定了 272px 宽、SessionList 通常只占上半屏),天然有位置挂一条只读信息。
3. **TM-Agent 的典型使用场景是长开**(陪 Claude Code/aider 跑作业几分钟到几小时),用户 **偶尔瞥一眼"机器还好吗"** 是高价值低成本的信号——比切去另一个 tab 跑 `top` 要顺手。
4. Research 0008 已经把方案想清楚(Cockpit 式 sparkline),无需再调研。

## 决策

在桌面侧栏**展开态**的 `SessionList` 下方固定一条 ~72px 高的 `SysinfoPanel`,折叠态(Rail)时降级为 3 个阈值色圆点。

### 1. 显示内容(最小集)

| 指标                                       | 展开态                   | 折叠态(Rail)     |
| ------------------------------------------ | ------------------------ | ---------------- |
| CPU % (user+system,跨核平均)               | 1 行数字 + 60s sparkline | 1 个圆点(阈值色) |
| Mem % (used / total,含 buffers/cache 折算) | 1 行数字 + 60s sparkline | 1 个圆点         |
| Load 1m                                    | 次要行,仅数字            | 1 个圆点         |
| Uptime                                     | tooltip,不占主位         | —                |

阈值色:绿 < 60%,黄 60–85%,红 ≥ 85%(load 用 CPU 核数归一化)。

**明确不做**:磁盘、网络、进程列表、服务状态、日志联动。这些是 Cockpit 的 scope,不是我们。

### 2. 数据路径

```
backend SysinfoSampler (setInterval 2s)
  → 读 /proc/stat /proc/meminfo /proc/loadavg /proc/uptime
  → 计算 delta(CPU % 依赖前一个样本)
  → 广播 { type: "system_stats", sample } 到所有 authed control WS
  → frontend sysinfo-store 维护环形缓冲(30 点 = 60s)
  → SysinfoPanel 读 store 渲染
```

- 采样周期 **2s**(60s 窗口 = 30 个样本,视觉上平滑、采样开销可忽略)。
- 环形缓冲在**后端持有**(而不是每个客户端),新连接 auth 后 force-publish 最新 1 个样本;前端自己积累历史(刷新页面会丢失 sparkline 历史——可接受,代价换了实现简洁)。
- **平台 gating**:只在 Linux 上启用(`process.platform === "linux"`)。macOS/其他平台后端不起 sampler,发一次 `{ type: "system_stats", unsupported: true }`,前端隐藏面板。

### 3. 协议

`src/shared/protocol.ts` 新增 `ControlServerMessage` variant:

```ts
| {
    type: "system_stats";
    sample?: {
      t: number;        // Unix ms
      cpu: number;      // 0..1
      mem: number;      // 0..1
      load1: number;    // raw
      cores: number;    // for load 归一化
      uptimeSec: number;
    };
    unsupported?: boolean;
  }
```

`sample` 和 `unsupported` 互斥。

### 4. 实现约束

- **零依赖**:后端不引入 `systeminformation` / `node-os-utils` 等库——直接读 `/proc`,~60 行足够。Sparkline 前端不引图表库,手写 `<svg path>`。
- **生命周期**:sampler 绑定在 `server.start()` / `server.stop()`,不是每个 WS 连接起一个;单点、共享。
- **错误容忍**:`/proc` 读失败(FS gating、container 内 `/proc` 残缺)→ 记一次 warn,发 `unsupported: true`,不崩。

### 5. 非目标

- **不做历史持久化**。重启后从 0 重建,不写盘。
- **不做阈值告警/通知**。只做视觉提示,不 push。
- **不做多主机聚合**。ROADMAP Post-v1 #7(多后端)那天再说。

## 代价

- 协议多一个 variant,前后端各多 ~200 行代码 + 1 个新模块目录。
- 后端常驻一个 2s interval timer(即使没客户端连接——可以加 "只在有 authed 客户端时轮询" 优化,但当前 setInterval 成本已经远低于一次 tmux pane poll,不值得复杂化)。

## 撤销条件

如果发现:

1. 用户反馈"这条占地方、想关掉" → 加一个 `useUiStore.sysinfoHidden` 切换,不撤 ADR。
2. `/proc` 在某个目标部署环境(例如 Alpine container、WSL2)行为异常且难以修复 → 扩大 `unsupported` 的触发条件,不撤 ADR。
3. 出现需要 **超出 CPU/Mem/Load** 的指标(磁盘、GPU) → 新开 ADR,不在本 ADR 内扩。
