# 0009. Compose Bar 智能补全:slash 触发的状态感知候选面板

- 状态:**accepted**(2026-04-22)
- Deciders:@ChuangLee
- 关联:research/0009、design/0009-product-spec、design/0009-tech-design、plans/0009-phase-2.6
- 接续:ADR-0006(shell-state classifier 已经做完;本 ADR 复用,不改 classifier)
- 范围:Phase 2.6 — Compose Bar 智能化(在 ROADMAP 里插于 2.5 之后、3a 之前)

## 1. 背景

Phase 2.5 落地后,**功能键**已经按 shell 状态自适应(KeyOverlay/ContextualBand);但 Compose Bar 的**输入内容**完全没智能化:

- 在 shell idle 敲 `cl` 不会提示 `claude` / `clear`。
- 敲 `/` 不会弹 slash 命令清单(类比 Claude Code、Codex 等 AI CLI 的 `/help` `/model`)。
- vim 命令模式 `:` 不会提示 `:wq` `:set paste` 等长命令。

手机端打字成本高(无 Tab 补全、无方向键 / 历史回看),这块 UX 缺口比 PC 大一个量级。

同时 PC 端今天(2026-04-22)刚把上方的 ActionPanel(`⏹ Ctrl+C` 那一栏)整个去掉 —— PC 主路径回归 Compose Bar + Direct Mode 两条线,Compose Bar 上加智能补全的 ROI 比之前高得多。

## 2. 决策

引入 **Compose Bar Suggestions** 组件:

> 当 Compose Bar 的 textarea **第一个非空字符**是 `/` 或 `:` 且当前 shellState 命中触发白名单时,在 textarea 上方弹出**最多 6 条候选**的悬浮列表;候选来自一份按 `(trigger, state, cmd)` 索引的**静态 catalog**;点击/Enter 把候选**填入** textarea(不发送),用户可继续编辑或 Enter 发送。

关键约束:

- **slash-only 起步**:typeahead(任意字符触发)推到 v1.1。理由见 §3。
- **完全前端**:不新增任何后端 RPC、不改协议、不改 classifier。
- **触发后锁定**:候选模式由"触发瞬间"的 `(trigger, state, cmd)` 决定,之后即使 classifier 抖动也不切表(避免用户敲到一半候选闪变)。
- **隐私闸门**:`password_prompt` / `confirm_prompt` 状态强制关闭,与 ComposeBar 既有的密码态闸门同源。
- **与 KeyOverlay 让位**:KeyOverlay 打开时 Suggestions 强制关闭(KeyOverlay 是手机重操作,优先级更高)。
- **填入而非直发**:点击候选 = 替换 textarea 值;发送仍走老 `send_compose` 路径(`set-buffer + paste-buffer + 120ms sleep + send-keys Enter`)。
- **Direct Mode 不参与**:Direct Mode 的设计前提是"键盘字节直通 shell",插一层补全违背初心。

## 3. 备选方案与权衡

### A. 一上来就做全 typeahead(每字符触发)

**优势**:覆盖面最大,接近 Warp/Fig 体验。
**劣势**:

- 必须有候选源(MRU 历史 + 二进制清单),v1 都没有,只能干吃 catalog,实际触发率低。
- 每字符触发会和 classifier 200ms debounce 抖动叠加,UX 上"闪"。
- 失败成本高 —— 用户在 textarea 里写正常文本(commit message)也会被打扰。

**结论**:延后到 v1.1,等 MRU 落地再上。

### B. 接 bash 真补全(把 readline 状态过来)

**优势**:最高保真度。
**劣势**:需要 PTY 嗅探、模拟 Tab 键往返、解析 readline 输出帧 —— 工程量是本方案的 10×,而且 bash/zsh/fish 各一份。手机端 ROI 不成立。

**结论**:不做,可能永远不做。Direct Mode 用户用真键盘 Tab 即可。

### C. 接 LLM 做意图补全

**优势**:候选最贴。
**劣势**:违反"无 AI 特化路径"原则(CLAUDE.md);要发请求、要超时降级、要鉴权、要算钱;手机离线就废。

**结论**:不做。

### D. 当前选定方案(slash + 静态 catalog + 锁定)

**优势**:

- 工程量最小 —— 一个 hook + 一个组件 + 一份 TS 表。
- 与 ADR-0006 的 classifier 复用,零基础设施新增。
- 触发显式(`/` 是用户主动按出来的),不会打扰正常文本输入。
- 可演进:v1.1 在同一接口加 MRU/typeahead,不破坏 v1 行为。

**劣势**:

- catalog 是写死的,要新增条目需 PR + 重新部署。可接受 —— 本来就该团队 review。
- 不能学习用户偏好。v1.1 解决。
- 不感知 cwd / git 仓库状态。v1.2 解决(需要后端 `query_pane_path`)。

## 4. 影响

### 必须做的

- 新建 `src/frontend/features/compose/completion/`(Suggestions、catalog、use-completion、types)。
- ComposeBar.tsx 改 6 处(import + 容器 className + 弹层挂点 + 4 个键拦截分支)。
- App.tsx 把 `overlayOpen` 透传给 ComposeBar(让 KeyOverlay 让位生效)。
- tokens.css 新增 `.tm-compose-wrap` / `.tm-suggestions` 等若干规则。
- 新增单测 4 个文件 + 1 个 e2e spec。

### 不动的

- 后端协议、tmux gateway、classifier、KeyOverlay、shell-state 8 状态枚举、Direct Mode、SessionDrawer。

### 风险

- **iOS 软键盘晃动**:点击候选时若 textarea 失焦,iOS 会把键盘收起再弹起。靠 `pointerdown.preventDefault` 阻止失焦。Tech Design §6.4 已规定,e2e 用真实设备 viewport 验。
- **catalog 维护漂移**:`/model` `/init` 这种 slash 命令是各 CLI 自己的,他们改了我们就过期。**对策**:catalog 文件单独一个 PR 改,review 门槛低,任何人都能补;后续若需要可加版本号但 v1 不必。

## 5. 取消的选项与永不做

- 不做模糊匹配("gst" → "git status")—— v1 前缀匹配足够,模糊匹配的相关性算法手机屏太小看不出差别。
- 不做候选学习 —— v1.1 用 MRU 先,真正的"学习"等有数据再说。
- 不做 LLM 意图补全 —— 见备选 C。
- 不做 Direct Mode 补全 —— 见决策。

## 6. 验证

- 单测全过(`npm test`)。
- e2e 跑 `tests/e2e/phase2_6_compose_completion.spec.ts` 全过。
- 手机 iOS Safari 真机:敲 `/`,选中候选,键盘不重弹。
- 在 live 站点上手动验三个状态(idle / vim / claude),必要时用 Playwright/diagnostic 脚本辅助。

## 7. 开关 / 回滚

无 feature flag。回滚 = revert PR。catalog 是单文件,出问题改回空数组即可立即停用所有候选(`useCompletion` 看到空表会保持 active=false)。
