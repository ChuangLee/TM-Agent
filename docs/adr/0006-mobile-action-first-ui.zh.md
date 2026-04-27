# 0006. 移动端动作优先 UI:Shell 状态分类器 + 顶部下拉按键层

- 状态:**accepted**(PR1–6 已落地;2026-04-21 addendum:flag 已拆除)
- 日期:2026-04-20(2026-04-21 修订)
- 决策者:@ChuangLee
- 取代关系:在**移动端**部分取代 Design Principle #3("输入为虚拟键盘之上的常驻 compose bar")。Compose bar 从主输入降级为回退路径,换取 prompt 捕获、命令历史、草稿暂存三项产品化能力。
- 目标 Phase:接受后在 `docs/ROADMAP.md` 的 3a 与 3b 之间插入新的 **Phase 2.5 — 移动 UX 重构**。
- 范围扩展(2026-04-20,原 ROADMAP Post-v1 #8 并入本 ADR):**桌面直通模式**作为 Phase 2.5 的对称交付物,见 §5。
- 英文主版本:[`0006-mobile-action-first-ui.md`](./0006-mobile-action-first-ui.md)(英文为权威版,有歧义以英文为准)。

## 背景

Phase 1 落地了 compose bar 作为移动端主要输入面。DESIGN_PRINCIPLES #3 的论证是"它比'点终端召唤键盘'好",因为虚拟键盘会吃掉约 40% 可视区域。这个论证只证明了"不应该点终端",**并没有**证明"compose bar 就是正确的主面"。

当前设计隐含的假设:

- 输入就是打字。
- 打命令是默认动作。

但我们自己用下来观察到的事实:

- 约 80% 的移动端操作是重复命令(`ls`、`cd foo`、`git status`、`npm run dev`、`clear`)或单键(`Enter`、`Ctrl+C`、`y`、`Esc`、`q`)。
- 剩下约 20% 分两种:(a) 真正需要键入的长命令(commit 信息、ssh 一行),(b) 程序内按键(vim 模式键、pager 导航、TUI 快捷键)——这些"打字"其实是假象,本质是按键。
- 虚拟键盘 + smart-keys 这块**还没有做**,也就是说**现在是重定主面最便宜的时机**,再晚改就要推倒已做工作。

两个关键观察让翻转成为可能:

1. **xterm.js buffer 随时可寻址。** 我们能扫描尾部几行匹配 prompt 模式——shell 状态本来就是一等可读信号,只是我们没读它。
2. **tmux 暴露 `#{pane_current_command}`。** 权威来源:直接告诉你"vim"、"python"、"claude"、"bash",无需猜。

两信号结合就能把当前 shell 状态确定性地分类——**不需要 LLM**。

## 决策

把移动端输入从"compose bar 优先"重定为"**动作优先**"。主面变成一个**随 shell 状态变化的动作卡片面板**,贴在终端上方。文本输入成为主动二等动作(`✎` → compose bar + 系统 IME)。另设一个**顶部下拉的半透明按键覆盖层**(`⌨` 呼出),处理低频按键。

### 1. 状态分类器

纯函数,吃三路信号,产出 8 种状态之一。

| 信号                 | 来源                                      | 更新时机                          |
| -------------------- | ----------------------------------------- | --------------------------------- |
| `paneCurrentCommand` | 后端推送的 `#{pane_current_command}`      | tmux pane 焦点变化 / 前台进程切换 |
| `altScreen`          | `term.buffer.active.type === 'alternate'` | `onBufferChange`                  |
| `bufferTail`         | `term.buffer.active` 的最后 5 行拼为单串  | `onWriteParsed`,debounce 200ms    |

8 种状态与检测规则(按顺序评估,第一条命中即终止):

| 状态              | 规则                                                                                 | 典型进程                       |
| ----------------- | ------------------------------------------------------------------------------------ | ------------------------------ |
| `password_prompt` | tail 匹配 `(?i)(password\|passphrase).*:\s*$`                                        | sudo、ssh、gpg                 |
| `confirm_prompt`  | tail 匹配 `\[[yY]/[nN]\]\|\([yY]es/[nN]o\)\|continue\?\s*$`                          | apt、pip、rm -i                |
| `editor`          | `altScreen` && cmd ∈ `{vim, nvim, nano, micro, hx}`                                  | 文本编辑                       |
| `pager`           | `altScreen` && cmd ∈ `{less, more, man}` 或 git pager                                | `less`、`man`、`git log`       |
| `tui`             | `altScreen` && cmd ∈ 已知 TUI 列表,或 alt-screen 但 cmd 未知                         | claude、htop、lazygit 等       |
| `repl`            | cmd ∈ `{python, node, bun, irb, ghci}`,或 tail 匹配 `^(>>>\|\.\.\.\|> \|In \[\d+\])` | 交互 REPL                      |
| `long_process`    | 非 alt,tail 无 prompt,3s 内有输出                                                    | `npm run dev`、`tail -f`、构建 |
| `shell_idle`      | 非 alt,tail 匹配 `[\$›#»]\s*$`                                                       | bash、zsh、fish                |

模糊情况靠上述**顺序**解决(最具体者先)。未命中 → 落入 `shell_idle` 但标 `confidence: 'low'`,UI 在顶栏显示小 `?` 徽章,并让 `⌨` 更显眼。

分类器是纯函数(`classify(signals): ShellState`),输出喂给 Zustand slice,UI 订阅。

### 2. Context card panel(移动端主面)

固定在 compose rail 之上的横向滚动卡片带,内容由当前状态决定。每种状态的卡片集定义在 `state-definitions.ts` 里;8 种状态各自的视觉 mock 见 `docs/prototypes/mobile-action-first.md`。

设计准则:

- 卡片结构:`{label, payload, kind}`。`payload` 可以是字符串(`"git status\n"`)或命名按键(`Escape`、`Ctrl+C`)。
- 单击 = 立即发送;长按 = 把 payload 复制到 compose bar 供编辑后再发。
- 每种状态最左永远是 `⌨`,最右永远是 `✎`。
- 学习机制:`shell_idle` 卡片包含从 `~/.bash_history` 机会性拉取(首次 `select_session` 时触发)+ 用户手动 pin 的条目,按频次排序,不滚动时最多 8 张可见。
- 状态切换时卡片带 180ms 交叉淡入,不抖布局。

### 3. 顶部下拉按键层(`⌨` 呼出)

通过 `⌨` 卡片或从屏幕顶部边缘下拉手势(60px 拖拽阈值)呼出。从顶部下滑入场,覆盖约 68vh,背景半透明(`rgba(12,14,18,0.78)` + `backdrop-filter: blur(6px)`)。按键本身不透明保证可读。

关键空间决策(参见对话记录 2026-04-20):**从顶部下滑,而不是底部上滑**。理由:

- 物理上区别于系统 IME(IME 从底部弹)——用户一眼知道这不是文本输入键盘。
- 保留底部约 32vh 的终端可见区——光标和 prompt 所在的高活跃区不被遮挡。
- 用户能同时看见按键层和终端活跃区。

内部布局遵循**逆优先级**(高频键靠近覆盖层的下沿,即靠近用户拇指——覆盖层虽然从上方下滑,但拇指是从下方伸上来的):

```
┌─ 下拉把手 ──────────────────────────┐  (小)
│ 状态相关键 (vim: :w :q :wq gg G /)   │
│ ─── 修饰键 ───                       │
│ [Ctrl] [Alt] [Shift]  (粘滞触发)     │
│ ─── 方向键 ───                       │
│     ↑                                │
│   ← ↓ →                              │
│ ─── 高频键(拇指区)───               │  (较大)
│ [Esc] [Tab] [Enter] [Backspace]      │
│ [ | ] [ ~ ] [ / ] [ > ]              │
│                        [✎ compose]   │
└──────────────────────────────────────┘
```

- 修饰键粘滞触发:轻点 `Ctrl` → 琥珀色边框 → 下一个按键发送组合并自动释放。长按锁定,再长按解锁。
- 关闭方式:点覆盖层外(底部 32vh)任意位置、在覆盖层上向上滑、或点 `✎`(切到 compose 模式,覆盖层退场)。
- 顶部覆盖层与系统 IME **互斥**——打开 compose 模式会自动收起覆盖层。
- 动画:180ms `translateY(-100% → 0)` + `opacity`。`prefers-reduced-motion` 下跳过变换。

### 4. Compose bar 产品化

Compose bar 保留原职(编辑后发送 + 系统 IME),新增:

- **Prompt 捕获横幅** — 状态为 `confirm_prompt` / `password_prompt` 时,在 compose bar 之上显示"脚本在等待:[Y/n]",配大号 Yes/No 按钮(密码场景是 `type=password` 输入框)。tail 不再匹配 → 自动消失。
- **按 session 的命令历史** — 空 compose bar 上按上箭头(或栏内向上滑)步进历史。数据源:(a) 本 session compose bar 发过的记录,(b) 机会性拉取的 `~/.bash_history`。按状态过滤:`editor` 状态下只显示 `:` 开头。
- **草稿暂存** — compose bar 内容按 session 保存在 Zustand(v1 仅内存,不跨刷新)。
- **快速插入托盘** — 长按 compose bar 弹出小托盘,列出 {最近 URL、路径、当前 git 分支}(正则从近期 buffer 提取)。如实现时间紧,延到 v1.1。

### 5. 桌面端

桌面端保持现有两栏网格 + compose bar 作为**默认模式**。**ActionPanel 在桌面端以紧凑布局呈现**(§5.1),让"看见当前状态 + 一键高频命令 + 脚本提示捕获"这三个价值在 PC 同样生效。**KeyOverlay 不在桌面渲染**——PC 有物理键盘,低频键直接按即可。桌面端的"低频键直通"+ "视觉专注"由 §5.2 的 **Direct Mode** 覆盖。

#### 5.1 桌面 ActionPanel(紧凑布局)

- **位置**:TopBar 下方、Surface 上方,独占一行,高度 40px。不进入 Sidebar 避免打断 SessionList。
- **内容**:与移动端相同的 8 状态卡片集,文案一致但视觉更紧凑——每张卡片 28px 高 × 自适应宽(padding 0 10px),`ui-font` 13px,单行横向排布;溢出时横向滚动(无滚动条,和移动端一致)。
- **键盘快捷键**:前 9 张卡片绑定 `Alt+1` … `Alt+9`(避开浏览器的 `Ctrl/Cmd+数字` 切标签快捷键)。hover 时卡片右下角显示角标。
- **PromptCaptureBanner**:`confirm_prompt` / `password_prompt` 时**替换** ActionPanel 的这一行,高度自适应(48–80px),样式与移动端一致但不占全屏;密码 banner 用原生 `<input type="password">`(PC 无虚拟键盘之忧)。
- **Direct Mode 态**:ActionPanel 与 TopBar / Sidebar 一起被 blur——保持视觉一致,用户专注 shell;退出 Direct Mode 后恢复清晰。
- **不渲染的情况**:视口宽度 < 820px(回到移动端布局);用户主动关闭(`localStorage.action_panel_desktop === '0'`,默认开)。

#### 5.2 桌面 Direct Mode

Direct Mode 是一键切换的"直接键盘驱动 shell"状态。开启后,浏览器级以下的所有键盘事件直接转成字节流发送到 PTY,视觉上用模糊 + 动效让非 shell 区域退至背景,强提醒"此刻你在直接操控终端"。

**检测**:`matchMedia('(min-width: 820px) and (pointer: fine)')` 成立视为 PC,显示直通模式按钮。触摸为主的宽屏设备(iPad 横屏)不自动出,但支持手动 URL 参数打开。

**为什么 Direct Mode 只做 PC**:手机端虚拟键盘与输入焦点**物理耦合**——只要焦点在 `<input>` / `<textarea>` 上,虚拟键盘必弹出且占屏;反之键盘消失则键盘事件也消失。所以"键盘接管但不显示输入框"在 iOS / Android 上做不到。手机端等价的"直通式体验"已经由 action-first UI(compose bar + 卡片带 + KeyOverlay)覆盖,不需要额外 mode。

**进入**:桌面 TopBar 右上"直通模式(Direct Mode)"按钮一键切换;或 URL 参数 `?direct_mode=1` 冷启动即开。

**退出**:同按钮(文字变"退出直通");或 `Ctrl+]`(traditional telnet/ssh 逸出序列,shell 与编辑器几乎都不占用);或 Esc 连按两次(300ms 窗口)。三路并存,文档明示快捷键。

**视觉引导**:

- `Surface`(`.tm-scroller`)保持完全不变(100% 清晰度、无滤镜)。
- 其余 UI(TopBar 主体、Sidebar、ActionRail、任何悬浮层)加 `filter: blur(4px) grayscale(30%) opacity(0.4)` + `pointer-events: auto`(仍可点,但视觉退居背景)。
- Surface 四周加 `box-shadow` 呼吸光晕(`--accent` 色,3s loop 动画)。
- 顶部插入 40px 悬浮条,accent 色底、深色文字 "直通中 · `Ctrl+]` 退出",带左侧 8px 脉冲圆点。
- 进入/退出有 200ms ease 过渡,避免"啪"一下的硬切换。

**键盘抓取**:

- `document`-level `keydown`(capture 阶段)监听;直通态下 `preventDefault` + `stopPropagation` 大多数组合键,只放行:
  - 浏览器级保留键(`Cmd+T/W/R/Q`、`F11`、`F12`、`Ctrl+Shift+I` 等无法被 JS 抓的键)—— 物理上抓不到,浏览器优先;
  - `Ctrl+]` 和连续 Esc —— 内部捕获为"退出"信号,不发 PTY。
- 其余键 → 映射表 → PTY 字节(字母/数字/控制键/方向键/功能键各有 ANSI/xterm 编码规则,沿用现有 xterm.js 的键盘映射思路)。

**IME 支持**:

- 直通态下 focus 一个隐藏的 `<textarea>` 作为输入载体,利用浏览器原生 `compositionstart/update/end` 捕获 IME 合成状态。
- 合成进行中:不转发键盘事件给 PTY,textarea 的候选词在一个小浮层里显示(贴在光标位置)。
- 合成完成(`compositionend`):把结果字符串整段发到 PTY。
- v1 先支持英文直通 + 中文 IME;其他 IME(日韩)留 PR6 的 v1.1 兼容测试。

**鼠标**:PC 直通模式(Direct Mode)**不**转发鼠标(与 ADR-0005 的决策保持一致)。未来若要加 tmux copy-mode / vim 鼠标选择,另起 ADR。

**已知边界**(非 bug,是浏览器安全模型):

- 浏览器保留键(`Cmd+Q/W/T/R`、`Ctrl+W`、`F11`、`F5`、`Alt+Tab`、操作系统级快捷键)抓不到。
- 右键菜单可保留(默认禁用在直通态会让用户不安);v1 不禁用右键菜单,用户期望"能退"。
- 全屏 API 可选:用户点直通按钮时可同时请求 `requestFullscreen()`(URL 参数 `?direct_mode=fullscreen`),但默认不全屏(避免弹出权限提示)。

**粘贴支持**:

- 直通态下 `Ctrl+V` / `Cmd+V` 被 `paste` 事件捕获 → 直接把剪贴板文本写到 PTY(不经 compose)。
- 和 ADR-0005 §"Input 不变"矛盾?不矛盾:直通模式(Direct Mode)是**新**的输入路径,compose-bar 路径依然保留。

## 执行流程

本 ADR 分六个带门槛的阶段推进。每个阶段有具体交付物,前一阶段未落地并通过审查,不得开始下一阶段。

| #   | 阶段     | 交付物                                                                                                                                             | 门槛                                                                         |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | 调研     | `docs/research/0006-mobile-action-first-research.md` — 特性对比(tmux-mobile + ttyd/wetty/gotty)+ 分类器信号的实证验证                              | 在 ≥ 30 条真实 prompt(覆盖 8 种状态)上分类器准确率 ≥ 90%;产出"借鉴 / 拒绝"表 |
| 2   | 计划     | `docs/ROADMAP.md` 插入 Phase 2.5 块:PR 序列、回滚 flag、每里程碑验收标准                                                                           | 决策者确认里程碑可在 `action_first` flag 后独立上线                          |
| 3   | 产品设计 | `docs/prototypes/mobile-action-first-v0.1.html` — 可部署到 `/preview/mobile-action-first-v0.1.html` 的交互 HTML mock;8 种状态文案 + 点击区尺寸锁定 | 决策者在真机上点完 8 种状态并签字                                            |
| 4   | 技术设计 | `docs/design/0006-mobile-action-first-tech-design.md` — 组件 API、状态机规范、wire 协议 diff(Zod)、调试 flag 机制                                  | 类型与协议增量审过,测试 fixture 范围划定                                     |
| 5   | 开发     | `action_first` flag 背后 5 个 PR,边界见「实现注记」+ ROADMAP Phase 2.5 里程碑                                                                      | 每个 PR CI 绿、部署至 `your-host.example`、真机验过                          |
| 6   | 测试     | 单元(分类器表驱动)+ 集成(面板 + 覆盖层 + compose 交互)+ Playwright e2e 覆盖 8 种状态(带截图)                                                       | 8 状态 Playwright 全绿;密码路径隔离已断言                                    |

门槛是硬的:调研阶段如果分类器在真实 prompt 上做不到 90%,**先改状态表**再进计划;产品设计阶段如果暴露缺失的交互,**先吸收进技术设计**再写代码。

## 备选方案评估

- **继续打磨 compose bar + smart-keys row(当前轨道、Phase 4)。** 拒绝:优化了错误的主面。80% 的移动端操作非文本,但主面假设它们是。
- **用 LLM 做状态分类。** 拒绝:引入延迟、成本、依赖。正则 + `pane_current_command` 在我们关心的 8 种状态上足够(>95% 准确)。长尾问题再议。
- **常驻 smart-keys 横条(不用下拉覆盖层)。** 拒绝:永久占屏给低频键。覆盖层默认隐藏,让终端默认最大化可见。
- **底部上滑覆盖层(iOS sheet 常见模式)。** 拒绝:与系统 IME 方向冲突,遮挡交互热区。顶部下滑心智模型更清晰。
- **把 prefix-key chord 菜单搬到 UI。** DESIGN_PRINCIPLES #4 已拒绝,本 ADR 不变——prefix 是桌面键盘遗产,不在 UI 暴露。
- **延到 Phase 4 / v1.1 再改。** 拒绝:虚拟键盘 + compose 打磨尚未动工,现在改主面最便宜;延迟就是在已知错误的主面上继续加东西。

## 后果

**变容易:**

- 移动端少打字。高频动作变成"点卡片"。
- 交互 CLI prompt(y/N、密码)获得一等 UI。现在这种情况很容易被埋进 scrollback 里错过。
- 分状态按键集把以前只能通过"打字打 `:wq` 三个字符"才能到的键变成可见卡片。
- Shell 状态变成可观察的 UI 状态——用户永远知道"应用认为我在 vim 里",错判时也能立刻发现。

**变难:**

- **分类器正确性要守住。** 错判 → 错卡片 → 用户困惑。缓解:保守默认(未命中走 `shell_idle`)、顶栏显示状态小徽章、`⌨` 永远可达作为逃生通道。
- **前端多一层状态。** rAF 内一次正则 + tmux 事件时一次字符串比较。spike 实测 <0.1ms/tick,可忽略。
- **UI 面多一些。** 8 状态 ×(卡片集) + 覆盖层 + compose 增强 ≈ 10-12 个独立界面要 mock。prototype 文档把这事前置解决了。
- **测试负担。** 每种状态需要 Playwright fixture 重现其检测输入(buffer tail + mocked `pane_current_command`)。可复用的 buffer 注入 helper。
- **后端小改。** `#{pane_current_command}` 需在 pane 焦点变时通过控制通道推出去——见实现注记。

**锁定(若接受):**

- 移动端主输入面 = 动作卡片;compose bar 是回退。
- DESIGN_PRINCIPLES #3 被修订。原"Consequence"段落替换建议文案:
  > 移动端:文本输入是主动的回退路径,主面由 shell 状态驱动的动作卡片承担。Compose bar 通过 `✎` 唤出,仍保持 `VisualViewport` 浮于虚拟键盘之上。桌面端:compose bar 仍为主输入面,直到直通模式(Direct Mode) ADR 另行修订。
- 新不变量:**Shell 状态是一等 UI 状态。** 任何影响 xterm 订阅或 tmux 控制通道、导致分类器信号损坏的改动都是 breaking change。

## 实现注记

**模块结构:**

```
src/frontend/features/
  shell-state/
    classifier.ts         ← 纯函数:(signals) => ShellState
    state-definitions.ts  ← 枚举 + 每种状态的元数据 + 卡片清单
    use-shell-state.ts    ← hook:订阅 term + control-ws
  action-panel/
    ActionPanel.tsx       ← 横向卡片带
    Card.tsx              ← 单张卡片(单击 + 长按)
  key-overlay/
    KeyOverlay.tsx        ← 顶部下拉层
    key-layout.ts         ← 状态 → 按键优先级
  compose/
    ComposeBar.tsx        (扩展)
    PromptCaptureBanner.tsx
    history-store.ts
    draft-store.ts
```

**后端改动:**

- `src/backend/tmux/tmux-gateway.ts`:给 `listPanes` 的 format 字符串加上 `#{pane_current_command}`,每次 snapshot 更新都推出去。
- 控制协议:`paneSummary`(Zod schema,`src/shared/protocol.ts`)加字段 `pane_current_command: string`。
- **不动** PTY、attach 逻辑。

**分类器伪代码:**

```ts
export function classify(s: Signals): { state: ShellState; confidence: "high" | "low" } {
  if (PASSWORD_RE.test(s.tail)) return { state: "password_prompt", confidence: "high" };
  if (CONFIRM_RE.test(s.tail)) return { state: "confirm_prompt", confidence: "high" };
  if (s.altScreen) {
    if (EDITOR_CMDS.has(s.cmd)) return { state: "editor", confidence: "high" };
    if (PAGER_CMDS.has(s.cmd)) return { state: "pager", confidence: "high" };
    if (TUI_CMDS.has(s.cmd)) return { state: "tui", confidence: "high" };
    return { state: "tui", confidence: "low" };
  }
  if (REPL_CMDS.has(s.cmd) || REPL_PROMPT_RE.test(s.tail))
    return { state: "repl", confidence: "high" };
  if (PROMPT_RE.test(s.tail)) return { state: "shell_idle", confidence: "high" };
  if (Date.now() - s.lastOutputTs < 3000) return { state: "long_process", confidence: "high" };
  return { state: "shell_idle", confidence: "low" };
}
```

**回滚方案:** 动作面板、覆盖层、shell-state slice 都是新 feature 目录,ComposeBar 和 TopBar 除了可见性开关外不动。调试 flag `action_first: false` 回到 Phase 1 UI。Phase 2.5 分 3-5 个 PR 推:(a) 分类器 + 后端信号,(b) `shell_idle` + `editor` 动作面板,(c) 剩余 6 种状态,(d) 按键覆盖层,(e) compose 增强。

**测试补充:**

- Unit:`classify()` 表驱动测试——每行一个 (state, inputs) 对,包含模糊破歧义。
- Integration:状态变化时动作面板重渲染;打开 compose 时覆盖层关闭。
- E2E(Playwright):打开 vim → 验证 `:wq` 卡片出现 → 点击 → buffer 反映保存退出;触发 `apt install` prompt → 验证大号 Yes/No 出现 → 点 Yes → 流程结束。

## Addendum 2026-04-21 (三)—— 移动端彻底不渲染 ActionPanel

**决定**:`ActionPanel` 在 `!isDesktop` 时直接 `return null`。移动端不再有常驻动作卡片条;所有状态相关按键集中在 `KeyOverlay` 里(通过 TopBar 的 `⌨` 按钮打开)。桌面保持不变——Alt+1-9 快捷键 + slim 卡片条仍在。

**动机**:

1. 真机上,即便只有 1-2 张卡片(如 `long_process` 的 `⏹ Ctrl+C`),ActionPanel 还是吃了 113 px 高度。手机视口垂直空间本就紧张,这部分全是净损失。
2. `KeyOverlay` 的 `ContextualBand` 已经覆盖所有状态的关键按键(`long_process` → Ctrl+C、`editor vim` → :w/:q/:wq/gg/G/、`pager` → Space/b/q 等)。ActionPanel 和 KeyOverlay 在功能上对移动端来说是**重复的**。
3. 代价:移动端失去 `shell_idle` 的便利命令卡片(`ls` / `git status` / `npm run dev` / `cd ..` / 学习历史)。这是刻意取舍——手机端更常用的是"看 + 单键响应",敲长命令本就应该走 compose bar。真要快速发常用命令,后续把它们挪进 KeyOverlay 的 contextual band 即可,但这不是 v1 的战场。

**实现**:`ActionPanel.tsx` 的 `if (bannerState || cards.length === 0) return null` 改为 `if (!isDesktop || bannerState || cards.length === 0) return null`;`data-layout` 从运行时变成硬编码 `"desktop"`;`shortcutIndex` 判断去掉 `isDesktop &&` 前缀(因为已早退)。单测 `mobile viewport` 用例反转为断言 null;e2e `phase2_5_pr2` 移动视口用例改为断言 `.tm-action-panel` 不存在。

## Addendum 2026-04-21 (二)—— 删掉顶边下拉手势,改 TopBar 显式按钮

**决定**:移除 `useTopEdgePull` hook 与 `useCoarsePointer` hook;`ActionPanel` 里手机专属的 `⌨` 卡片也一并去掉。唤出 `KeyOverlay` 的唯一入口改成 **TopBar 右侧的 `⌨` 按钮**,用 `md:hidden` 限定只在移动视口显示(桌面端有物理键盘,不需要)。

**动机**:

1. 真机验证发现,移动端下滑默认被滚动容器吞掉(原生 kinetic scroll),用户根本不知道存在"顶边 20 px 起手 → 下拖 60 px"这个手势——**手势零发现性**。
2. `⌨` 卡片藏在 ActionPanel 的末尾,和其他状态卡片挤在一起,用户也无法识别它是"打开键盘"。
3. TopBar 右侧原本空着(只在 direct-mode 可用时才有 button),移一个 `⌨` 进去视觉成本几乎为零,却给了手机用户**一个明确的"软键盘入口"**。

**实现**:`TopBar` 新增 `onRequestKeyOverlay` prop;渲染 `⌨` 按钮 `className="... md:hidden"`,`aria-label="打开按键层"`,`data-testid="topbar-key-overlay"`。桌面通过 Tailwind `md:hidden` 隐藏(`display: none` 在 ≥820 px)。`ActionPanel` 不再接收 `onRequestKeyOverlay`;原 `.tm-card-kbd-toggle` 样式一并删除。

## Addendum 2026-04-21 — 拆除 `action_first` debug flag

**决定**:移除 `useActionFirstFlag()` hook、`?action_first=` URL 参数、`tm-agent_action_first` localStorage 开关。`ActionPanel` / `KeyOverlay` / `PromptCaptureBanner` 不再被 flag 门控。~~顶部下拉手势改由 `matchMedia("(pointer: coarse)")` 自动判定~~(**已被上一条 addendum 取代**:手势整个删掉,改成 TopBar 按钮)。桌面端的 Direct Mode 独立于此,继续由自己的 `directMode.available` 门控。

**动机**:

1. PR1–6 全部 merge 后,flag 实际只在 gate 一件事——`useTopEdgePull` 的启用。`ActionPanel` 等视图已经是无条件渲染了。flag 萎缩成"手势开关",原本的灰度回滚意义早已消失。
2. **这违背了 Design Principle #1 的精神**:用户体验应该由设备自动决定,而不是由一个隐藏 URL 参数 / localStorage 开关决定。个人工具不该有面向维护者自己的"部署开关"。
3. `matchMedia("(pointer: coarse)")` 是 CSS Media Queries Level 4 的标准 API,覆盖 iOS Safari 13+、Android Chrome 58+——本项目支持的所有移动浏览器。鼠标+触摸屏的笔电会被判为 coarse,这正是我们想要的行为(用户能拉手势就让他拉)。
4. Phase 2.5 的 DoD 要求"flag 翻开后 Playwright 8 态全绿"。拆 flag = 把"翻 flag + QA 通过"合并成一步。个人项目 + 已在 main 跑了多日,接受"就这么是了"、没有回滚按钮。

**副作用**:

- `docs/plans/0006-phase-2.5-plan.md` 与 `docs/design/0006-mobile-action-first-tech-design.md` 中关于 `useActionFirstFlag()` 的章节留作历史。今后读的人以本 addendum 与当前代码为准。
- 原 ADR「回滚方案」一节里的 `action_first: false` 回退路径**不再存在**。Phase 1 compose-bar-primary UI 已无退路——如果 action-first 方案出致命问题,只能在 commit 历史里 revert 具体 feature,不能一键回滚。

## 遗留问题(暂缓)

- **Q1 — pin 卡片持久化。** v1 内存 Zustand。v2 服务端 JSON。等使用证明有必要再做。
- **Q2 — 密码字段隔离。** 密码发送的字节**不得**写入 compose 历史或草稿暂存。专项测试覆盖。
- **Q3 — 多 pane 状态。** 每个 pane 独立状态;动作面板跟随焦点 pane。切 pane 时以新 pane 的信号重跑分类器。
- **Q4 — 无障碍。** 覆盖层 focus trap + 方向键在按键间导航(平板横屏配蓝牙键盘场景)。尊重 `prefers-reduced-motion`。
- **Q5 — 卡片学习来源。** v1 机会性拉 `~/.bash_history`;每 pane `HISTFILE` 识别是 v2。
- **Q6 — 桌面对称。** `⌨` 覆盖层在桌面上可以充当 Ctrl-/ 命令面板。本 ADR 不涵盖,见 ROADMAP #8。
