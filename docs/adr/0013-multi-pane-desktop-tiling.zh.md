# 0013. 桌面端多 slot 平铺(1 / 1×2 / 2×2 三档,固定栅格)

- 状态:accepted
- 日期:2026-04-22
- 决策者:@ChuangLee
- 相关:ADR-0006(action-first UI,Compose Bar 模型)、ADR-0007(session identity)、ADR-0010(unified session switcher)、ADR-0012(sidebar file panel)、DESIGN_PRINCIPLES §1(手机优先 / 桌面是 reflow)、§4(tmux state 是一级导航)、README "Agent 时代,用 tmux 精准驾驭你的智能体"。

## 背景

README 把本项目定位为"在 Agent 时代,用 tmux 精准驾驭你的智能体"。这条卖点的具象体现是**用户同时编排多个 agent**——一个 Claude Code 在写前端、一个 Codex 在跑测试、一个 aider 在重构后端、一个 logs tail 兜底。

当前桌面布局:Sidebar(Sessions / Files / Sysinfo)+ 主区单 `Surface`。切 session = 重 attach。这意味着:

- "同时盯 4 个 agent"在 UI 层不可能——只能盯 1 个,其余靠脑补 + 频繁切换。
- 切换是 `select_session` → tmux 重 attach → capture-pane 种子 → live socket 重接,~200–500ms 视觉跳动。频繁切等于打断节奏。
- tmux 自身的 `split-window` 把多 pane 塞进同一 session,共享 cwd / env / scrollback,无法表达"4 个独立项目并排"。语义不符。

本 ADR 在桌面端引入**客户端层的多 slot 平铺**:把主区切分成 N 个独立的 `Surface`,每个绑定一条独立的 terminal-WS,各自 attach 一个 tmux session。tmux 后端 0 改动——只是从"一个 web 客户端挂 1 路"变成"挂 N 路",这本就是 tmux 多 client 的本职工作。

性能侧已在前期讨论中估算:4 路客户端 ≈ 40–80MB xterm 缓冲 + 4 个 WebSocket + 4 个 `node-pty` 子进程,等价于"用户开 4 个本仓库浏览器 tab"。线性、可接受、4 路完全在舒适区,8+ 才需要降频策略。

手机端**不做**(竖屏 + 虚拟键盘下,4 列每列 ~90px 不可读)。这与 ADR-0006 / DESIGN_PRINCIPLES §1 一致:手机有手机的形态,桌面用 reflow 表达不同形态。

## 决策

桌面端(`min-width: 768px`)新增 **Layout 模式**,三档固定:

| 档     | 栅格      | slot 数 | 默认显示          |
| ------ | --------- | ------- | ----------------- |
| Single | 1         | 1       | 当前行为,保持兼容 |
| 2-cols | 1×2(左右) | 2       | 两等宽列          |
| Quad   | 2×2(田字) | 4       | 四等格            |

不做 1×3 / 1×4 / 2×1 / 全竖切。理由:

- **2 mode 必须左右切**——竖切会让 Compose Bar 上方主区被劈成两窄条,xterm cols 不够 80,大量 TUI 渲染崩。
- **4 mode 选 2×2 而不是 1×4**:1920px 主屏减 sidebar ~1600px,1×4 每列 ~400px(约 50 cols),Claude Code / Codex 这类 TUI 经常 80 cols 起步,挤压严重;2×2 每格 ~800×450,接近 100 cols × 25 rows,更接近 TUI 默认假设。代价是每格高度只有 ~450px,但 agent 输出本来就以滚动为主,高度不是瓶颈。
- **不做 1×3**:奇数格视觉不对称,与 2×2 的对称美学冲突;且"3 个 agent"的需求总能用"4 个里空一格"覆盖。

### 1. 入口与触发

TopBar 右侧新增 **Layout 按钮**,与 Direct Mode 按钮并列。两者同源:都是"桌面专属、改 viewport 拓扑"的开关。

```
[⌨ 直通模式]  [⊞ 布局 ▾]
                ├ ▢ Single   ✓
                ├ ⊟ 1×2
                └ ⊞ 2×2
```

- 移动端不渲染该按钮(与 Direct Mode 同断点策略)。
- 折叠态(SessionRail)保留按钮——layout 是视口级配置,与 sidebar 折叠正交。

不放进 Sidebar:Sidebar 是 session 数据视图,layout 是视口配置,两件事,合一会让 "+ New session" 的语义被稀释。

### 2. Slot 数据模型

新增 `useLayoutStore`(zustand):

```ts
type SlotId = 0 | 1 | 2 | 3; // 位置即身份(row-major:0=TL,1=TR,2=BL,3=BR),固定四色绑位置
type LayoutMode = 1 | 2 | 4;

type SlotState = {
  id: SlotId;
  attachedSession: string | null; // tmux session 名;null = 空 slot
  // terminal/compose/attachments 的 per-slot 子状态见 §6
};

type LayoutStoreState = {
  mode: LayoutMode;
  slots: SlotState[]; // 长度 = mode;mode 切换时按 §5 规则重排
  focusedSlot: SlotId; // 任何时刻必有一个焦点
};
```

**slot id 即位置**,row-major 编号:

```
2-cols:        Quad (2×2):
┌────┬────┐   ┌────┬────┐
│ 0  │ 1  │   │ 0  │ 1  │
└────┴────┘   ├────┼────┤
              │ 2  │ 3  │
              └────┴────┘
```

位置绑色(§3)、绑快捷键(Ctrl+1..4 = slot 0..3)。Quad 模式下 Ctrl+1/2 = 上排,Ctrl+3/4 = 下排,与视觉位置一致。

### 3. 焦点指示(本 ADR 的关键 UX)

四 slot 各分配一个 accent 色(在 `tokens.css` 锁死):

| Slot | 位置     | Accent | 备注                                         |
| ---- | -------- | ------ | -------------------------------------------- |
| 0    | 左上(TL) | cyan   | 现有 `--c-accent` 同色系,Single 模式也用此色 |
| 1    | 右上(TR) | amber  | warm                                         |
| 2    | 左下(BL) | violet | cool                                         |
| 3    | 右下(BR) | rose   | warm-cool 对照                               |

2-cols 模式只用 slot 0/1,色为 cyan/amber。Single 模式不显示 accent 装饰,但内部仍跑在 slot 0 上(协议层一致性,§6)。

视觉规则:

- **焦点 slot**:2px accent 边框 + mini-bar 背景使用该色 12% alpha。
- **非焦点 slot**:1px `--c-line` 灰边框,内容颜色不变(避免被误判 disabled)。
- **Compose Bar**:左侧 3px 竖向 accent 条 = 焦点色;textarea 上方一行小字 `→ <session-name> · win-<N>`;切焦点时 200ms 高亮闪一下,显式告知"下条发给谁"。
- **Single 模式**:不显示 accent 装饰、不显示 mini-bar——保持现状视觉。

切焦点的方式:

- **鼠标**:点击任意 slot 内任意位置(含 mini-bar、Surface 区)。
- **键盘**:`Ctrl+1` / `Ctrl+2` / `Ctrl+3` / `Ctrl+4` → 切到 slot 0..3(row-major,与视觉位置对齐)。Direct Mode 下这些组合归 PTY,所以 Direct Mode 时**只能用鼠标切焦点**——可接受,Direct Mode 的语义就是"键盘交给 shell"。

### 4. Slot 结构与空态

#### 已 attach 的 slot

```
┌─ session-name · win-3 ──────── ✕ ┐  ← mini-bar(N>1 时显示)
│                                   │
│             Surface              │
│           (xterm,独立 cell      │
│            metrics,独立滚动     │
│            位置,独立 freeze)    │
│                                   │
└───────────────────────────────────┘
```

mini-bar:

- session 名 + 当前 window 序号(`#{window_index}`),点击 window 部分弹一个轻量 popover 列出该 session 所有 window,与现有 `WindowStrip` 行为对齐但作用域为本 slot。
- ✕ 关闭按钮:断开**这一格**(close terminal-WS),tmux session 本身**不杀**;触发 §5 的自动回退规则。
- Single 模式不显示 mini-bar,window 切换继续靠全局 `WindowStrip`(行为不变)。

#### 空 slot(`attachedSession === null`)

```
┌──────── empty ─────────────── ✕ ┐
│  ┌────────────────────────────┐ │
│  │  ╋  开新 session           │ │  ← ~40% 高,主路径
│  └────────────────────────────┘ │
│                                  │
│  挂载现有 session                │
│  ────────                        │
│  ◐ main-work     · 3 wins       │  ← 已被其他 slot 占用,灰化不可点
│  ◯ aider-refactor · 1 win       │
│  ◯ logs-tail     · 2 wins       │
└──────────────────────────────────┘
```

- 顶部"开新 session"按钮 = 主路径,占 ~40% 高度。复用 `SheetHost` 现有 New Session 流程,onCreated 后自动 attach 到本 slot。
- 下方列表 = 现有 session,**已被其他 slot attach 的项灰化不可点**(§7 的"不允许同 session 多 attach"在 UI 层兜住)。
- mini-bar 的 ✕ 在空 slot 上的语义:从布局缩档(2→1 / 4→2),走 §5 规则。

### 5. 自动回退规则

任何"连接数下降"事件都触发以下重新计算:

| 当前 mode | 已连接数 | 动作                                                  |
| --------- | -------- | ----------------------------------------------------- |
| Quad      | 4 → 3    | **不变**,Quad 内出现 1 个空 slot                      |
| Quad      | 3 → 2    | **降到 2-cols**,2 个连接按 row-major pack 进 slot 0/1 |
| Quad      | 2 → 1    | **降到 Single**                                       |
| 2-cols    | 2 → 1    | **降到 Single**                                       |
| 任意      | 0        | **降到 Single + 空态**,等同首次进入                   |

升档规则(用户主动选 Layout):

- N → M(M > N):新增的 slot 全部为空,等用户填。
- M → N(M > N)且**当前已连接 ≤ N**:直接降,空 slot 被去掉。
- M → N 且**当前已连接 > N**:菜单项 disabled + tooltip "请先关闭多余 slot"。**不做隐式 detach**——agent 跑到一半被默默断了用户会骂街。

降档时 slot 重排:**保持 row-major 相对顺序,pack 到前面**。例如 Quad 下 slot 0/2/3 已 attach、slot 1 空,触发"3→2 降到 2-cols":

- 旧顺序 [A, _, C, D] → 移除空 slot → [A, C, D] → 取前 2 → [A, C] 进 slot 0/1
- 但已连接是 3 个,不会触发该路径(3 在 Quad 内停留)。
- 触发降档的真实路径是"再关一个",例如再关 D → [A, _, C, _] → 已连接 = 2 → 自动降 → 新 slot 0 = A、slot 1 = C。
- focusedSlot 跟着搬:若旧焦点的会话还在新布局里,焦点跟会话走;否则落到 slot 0。

### 6. 状态层改造(真正的工程量)

当前以下 store / hook 是**全局 singleton**,需变成 `Record<SlotId, ...>`:

| 现状                                                   | 目标                                | 说明                                                         |
| ------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------ |
| `terminal-store`(xterm 实例、scroll 状态、freeze 状态) | per-slot                            | 每个 slot 持有自己的 xterm 实例与 freeze layer               |
| `attachments-store`                                    | per-slot                            | 草稿附件不应跨 slot 串味                                     |
| `compose-bridge`(草稿文本、focus 状态)                 | per-slot draft + 全局 focus         | 草稿 per-slot,但 textarea 焦点是全局的(只有一个 Compose Bar) |
| `useControlSession`(control WS)                        | **保持全局**                        | control plane 是用户级的                                     |
| `use-completion`(slash 补全)                           | per-slot 上下文                     | 取焦点 slot 的 attached pane state 作输入                    |
| `useDirectMode`                                        | **保持全局开关 + 焦点 slot 作用域** | 全局 on/off,但 keystroke 路由到焦点 slot                     |
| `useTerminalReady`(terminal-WS 生命周期)               | per-slot                            | 每个 slot 自己起一条 terminal-WS,attach 自己的 session       |

`useSessionsStore` 的 `attachedBaseSession` 概念演化为 `attachedBySlot: Record<SlotId, string | null>`。后端控制协议保留单一 session 选择消息但加 slot 维度:

```ts
// shared/protocol.ts(草拟,具体字段在 PR 锁死)
type SelectSessionMsg = {
  type: "select_session";
  slot: SlotId;
  session: string;
};
```

兼容老消息(无 slot 字段)= slot 0,保护 mobile 单 slot 路径。

### 7. 同 session 不允许 attach 到多 slot

**UI 层兜底**:空 slot 列表里灰化已被占用的 session,hover 提示"已在 slot 2 打开"。
**协议层兜底**:`select_session` 消息后端校验该 session 是否已被同一用户的其他 slot attach;若是,返回 `error` 不切换。
**为什么不允许**:tmux grouped client 会让两个 slot 内容完全同步,在"4 agent 并排"的语义下没有意义,只会让用户误以为是 bug。如未来用户出现"同 session 不同 window 并排"的真实需求,再开 follow-up ADR 评估。

### 8. Compose Bar 单根 + per-slot draft

不做 4 根 Compose Bar:Quad 下每格主区只有 ~450px,如果再各塞 72px Compose 就只剩 ~378px 给 xterm,严重劣化。

**单根 Compose Bar 在最底部不动**,行为变化:

- target = 焦点 slot 的 attached session。
- **草稿与附件 per-slot 持久化**:切焦点时 textarea 内容 + 附件清单跟着切。这是"4 个 agent 各自在写不同 prompt"的核心需求。
- 顶部一行小字 `→ <session-name> · win-<N>`,用焦点 slot 的 accent 色渲染。
- 切焦点 200ms 闪一下背景,显式提示"target 已变"。
- 现有的 IME 通路、`set-buffer` + `paste-buffer -dpr` + 120ms sleep + `send-keys Enter` 模式不变(详见 `feedback_compose_send_keys_pattern.md`)。

### 9. Direct Mode 在多 slot 下

- Direct Mode 是**全局开关**,作用对象 = 焦点 slot。
- 现有 `DirectModeIndicator`(全屏呼吸光)演化为**焦点 slot 局部呼吸光**——只给当前焦点 slot 的边框加呼吸 accent。
- IME bridge 仍然全局,composition 完成后路由到焦点 slot 的 PTY。
- Ctrl+1..4 在 Direct Mode 下归 PTY(明确接受),用户用鼠标切焦点。

### 10. 后端影响

- **tmux**:零改动。
- **WebSocket / node-pty**:每个 slot attach = 多 1 条 terminal-WS + 多 1 个 `tmux attach-session` 子进程。资源开销线性。
- **session-snapshot 推送**:已经是全 session list 广播,无需改。
- **per-slot capture-pane 种子**:每个 slot attach 时各自跑一次 10K 行 `capture-pane -e`,与现有路径相同。
- **新增校验**:`select_session` 加 slot 维度;同 session 重复 attach 拒绝(§7)。

### 11. 性能预算与降级

4 路目标:

- 客户端内存增量 ≤ 60MB(4 × 15MB xterm 缓冲)。
- 主线程 CPU:4 路同时空闲 < 1%;1 路连续高速输出(claude 流式回答)≤ 5%;4 路同时高速输出 ≤ 25%——可接受。
- 单纯多 slot 不引入降频;**8+ 路才考虑非焦点 slot 的 ANSI 解析降频 / DOM mirror 懒挂载**。本 ADR 不实现 8+ 模式,留 ROADMAP。

### 12. 不做(显式)

- 手机端不做多 slot(竖屏物理约束)。
- 不做 1×3 / 1×4 / 2×1 / 任意竖切(对称美学 + TUI 列宽下限)。
- 不做拖拽改 slot 顺序(slot id 即位置,顺序固定)。
- 不做 slot 不等宽(等分 1/N,无 resize handle——保持简单,等用户反馈再加)。
- 不做"同 session attach 多 slot"(§7)。
- 不做 office 文档 / 富媒体的 per-slot 视图(FilePanel 已在 sidebar,不复制)。
- 不做 8+ slot(性能与可读性双重边界)。

## 实施分期

| PR  | 范围                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| #1  | `useLayoutStore` + Layout 按钮 + Single mode 兼容路径(切 mode 但只允许停在 1)。回归现有功能不破。                                           |
| #2  | 状态层 per-slot 化:`terminal-store` → keyed,Surface 接受 `slotId` prop;协议加 slot 维度;后端校验。Single mode 实际跑在 slot 0 上,行为不变。 |
| #3  | 2-cols mode 启用 + 焦点指示(Compose Bar 联动) + 自动回退规则。                                                                              |
| #4  | Quad(2×2)mode 启用 + Ctrl+1..4 焦点切换 + Direct Mode per-slot 呼吸光。                                                                     |
| #5  | 空 slot session picker(复用 New Session sheet) + "已 attach 灰化"逻辑 + tooltip。                                                           |
| #6  | 性能 / E2E:4 路并发流式输出回归、focus 路由测试、降档矩阵覆盖。                                                                             |

每个 PR 独立通过 typecheck / unit / e2e,主分支随时可发布。

## 后续

- **同 session 不同 window 并排**(若用户反馈强烈):新 ADR 评估"同 session 多 attach 但绑定不同 window"的可行性。tmux 没有原生"per-client window"概念,需要在客户端做 window override。
- **8+ slot 的降频策略**:非焦点 slot 的 xterm 解析降频、DOM mirror 懒挂载、freeze layer 关掉。
- **slot resize handle**:用户手动调整 slot 宽度比例,持久化到 localStorage。
- **Direct Mode + Ctrl+1..4 共存**:研究 chord 解决方案(如 `Ctrl+]` 临时退出 Direct Mode 切焦点再回来)。
