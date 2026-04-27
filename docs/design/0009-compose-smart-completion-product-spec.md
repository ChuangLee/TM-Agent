# 0009 — Compose Bar 智能补全 · 产品方案

> 状态:Proposed(等评审 → 升级为 ADR + Tech Design)
> 日期:2026-04-22
> 依赖:Research/0009、ADR-0006(shell-state classifier)
> 不依赖:后端新 RPC(v1 全前端)

## 0. TL;DR

在 Compose Bar 上方加一层悬浮 **Suggestions** 面板,根据 `shellState.state` + `paneCurrentCommand` + 用户输入前缀,从一份**分模式的候选表**中筛出 ≤ 6 条建议。
**v1 只做 slash 触发**(输入第一个字符是 `/` 或 `:`,弹面板;其它字符不触发),最低成本拿到最大收益。
**v1.1 加 typeahead**(任何字符都触发,带 MRU 历史)。

## 1. 目标 / 非目标

### 目标(v1)

- 手机端用户在 shell idle 状态打 `/` → 弹出"常用命令"清单(`claude` / `codex` / `git status` / `htop` / ...)。
- 在 vim 状态打 `:` → 弹出 vim 命令(`:w` / `:wq` / `:q!` / `:vsplit` / ...)。
- 在 claude/codex(tui)状态打 `/` → 弹出该 CLI 的 slash 命令(`/help` / `/model` / `/clear`)。
- 一次点击就把候选**填入** textarea(不直接发送,留用户编辑或确认)。
- PC 端同样工作(键盘 ↑↓ + Enter 选)。

### 非目标(v1)

- 不做 bash Tab 补全的等价物(每字符 typeahead 留 v1.1)。
- 不模拟 readline,不嗅探 PATH,不接后端 RPC。
- 不做模糊搜索(`gst` → `git status`),v1 是**前缀匹配**。
- 不持久化跨设备(MRU v1.1 才上,且只在本地 IndexedDB)。
- 不替代 KeyOverlay。两者职责不同:KeyOverlay 出**键**(`Ctrl+C`、方向键),Suggestions 出**字符串**(`git status`、`/model`)。

## 2. 用户故事

1. **AI 玩家**:我在手机端用 tmux 跑 claude / codex,经常想新开一个 session 起 `claude --resume`。现在要切到 KeyOverlay 找字母敲全。**期望**:打 `/` → 看到 `claude` `claude --resume` `codex`,点一下就填好。
2. **vim 重度用户**:vim 内做完编辑要 `:wq`。KeyOverlay 已有 `:wq` 按钮,但我有时想 `:set paste` `:vsplit foo.ts`。**期望**:打 `:` → 候选里有这些长命令。
3. **进入 claude 自身**:claude tui 里打 `/` 想看 slash 命令。**期望**:Suggestions 知道当前是 `claude`,出 claude 的 slash 命令(我们自己维护一份小清单,缺的就缺,不接 claude 内部 API)。
4. **PC 桌面**:坐电脑前我也用 Compose 模式(Direct Mode 没开),想用 ↑↓ Enter 走 Suggestions。**期望**:键盘和触屏一致。

## 3. 触发与候选模型

### 3.1 触发字符 → 模式

| 触发字符                     | 仅在以下 shellState 启用              | 候选模式     |
| ---------------------------- | ------------------------------------- | ------------ |
| `/`(textarea 第一个非空字符) | `shell_idle`、`tui`                   | "slash 命令" |
| `:`(textarea 第一个非空字符) | `editor`(vim/nano)、`pager`(less/man) | "ex 命令"    |
| 其它                         | (v1 不触发)                           | —            |

> "第一个非空字符"很重要:用户在写 `echo "hello / world"` 时不该弹面板。

**关闭条件**:

- 用户删掉触发字符(textarea 第一个字符不再是 `/` 或 `:`)。
- 点选某个候选(填入后立即关)。
- Esc(PC)/ 点 Suggestions 外部(手机)。
- shellState 切到 `password_prompt` / `confirm_prompt`(强制关,避免在密码框里弹候选)。

### 3.2 候选表(v1 的具体内容)

候选表是**静态的**,放在 `src/frontend/features/compose/completion/catalog.ts`。结构与 KeyOverlay 的 `key-layout.ts` 同构(`(state, cmd) → entries[]`)。

| state + cmd              | 候选(按相关性,不超过 6 条)                                                 |
| ------------------------ | -------------------------------------------------------------------------- |
| `shell_idle`,任意        | `claude`、`codex`、`git status`、`git log --oneline -10`、`htop`、`ls -la` |
| `tui`,`claude`           | `/help`、`/model`、`/clear`、`/exit`、`/init`、`/review`                   |
| `tui`,`codex`            | `/help`、`/model`、`/clear`、`/exit`                                       |
| `tui`,`htop` / `lazygit` | (空,KeyOverlay 已覆盖,关闭面板)                                            |
| `editor`,`vim` / `nvim`  | `:w`、`:wq`、`:q!`、`:set paste`、`:set nopaste`、`:vsplit `               |
| `editor`,`nano`          | (空,nano 没有 ex-style 命令)                                               |
| `pager`,任意             | `:n`、`:p`、`:q`                                                           |

> 维护成本低:一个文件,一个 PR 就能加新条目。
> 后续接入 MRU 时,在每张表前面**插入** MRU 命中的条目(不替换静态表)。

### 3.3 排序

v1 按表里的写死顺序展示,不做动态打分。
v1.1 引入 MRU 后:

- MRU 命中条目前置(最多 3 条)。
- 静态条目按表顺序补齐到 6 条。
- 同一字符串去重。

## 4. UI 形态

### 4.1 位置

- 容器贴在 textarea **上边**(向上展开),不向下,避免被软键盘遮。
- z-index = 999(比 KeyOverlay 1000 低,KeyOverlay 打开时 Suggestions 让位关掉)。
- 宽度 = textarea 宽度,左对齐。
- 最大高度 = 6 条 × 44px,超出滚动(实际 v1 内容上限 6 条,不会触发滚动)。

### 4.2 候选项视觉

```
┌─────────────────────────────┐
│ /claude              ⏎      │   ← 主文本左,小灰色 ⏎ 提示"点击会填入"
│ /codex               ⏎      │
│ /git status          ⏎      │
└─────────────────────────────┘
[ /                    ] [→]  ← textarea(只显示用户已敲的 `/`)
```

- 触发字符是 `/` 时,候选显示"完整命令"(包含触发字符之后的内容,但不重复 `/`)。这一条要在视觉上和后端实际填入保持一致。
- 选中交互:**单击 = 填入并关闭**。不要二次确认 —— 用户还能在 textarea 里继续编辑或删字。
- PC 端键盘:↑↓ 高亮、Enter 填入、Esc 关闭。Tab 不抢(Tab 留给 textarea 默认行为以备未来扩展)。

### 4.3 动效

- 入场:80ms ease-out,opacity 0→1,translateY(4px)→0。比 KeyOverlay 的 200ms 快(KeyOverlay 是大面板,Suggestions 是小贴片)。
- 不加 backdrop blur(保持终端清晰,与 KeyOverlay 同策)。

### 4.4 与现有元素的层叠关系

| 层             | z-index | 何时关掉 Suggestions                           |
| -------------- | ------- | ---------------------------------------------- |
| Toast / dialog | 9999    | 是                                             |
| KeyOverlay     | 1000    | **是**(KeyOverlay 是手机端"重"操作,优先级更高) |
| Suggestions    | 999     | —                                              |
| SessionDrawer  | 40      | 否(抽屉打开通常会盖住 Compose 区)              |

## 5. 行为边界 / 防抖

| 场景                                 | 行为                                         |
| ------------------------------------ | -------------------------------------------- |
| 候选填入后,用户继续打字              | Suggestions 不再触发(只看"第一次"输入字符)   |
| classifier 在用户已经打字后切换状态  | **不切换**候选表(锁定到首字符触发时的 state) |
| 用户清空 textarea 又打 `/`           | 重新走一遍触发逻辑,候选表用**当前** state    |
| `password_prompt` / `confirm_prompt` | 强制关闭面板,该次输入不能弹                  |
| 离线 / WebSocket 断开                | 不影响(候选完全是前端)                       |

## 6. 可观测性

埋点(只在前端,先 console.debug,不接后端):

| 事件                  | 字段                                                                    |
| --------------------- | ----------------------------------------------------------------------- |
| `suggestions_open`    | `state`, `cmd`, `trigger` (`/` or `:`), `candidate_count`               |
| `suggestions_pick`    | 同上 + `index`, `picked`                                                |
| `suggestions_dismiss` | 同上 + `reason` (`esc` / `outside` / `delete-trigger` / `state-locked`) |

成功指标(等接入正式分析后):

- 触发后**点选率** ≥ 40%(低于此说明候选表选错)。
- 触发到点选 **中位时长** ≤ 1.5s(高于此说明列表顺序不对)。

## 7. 实施切片(给 Tech Design / Plan 参考)

| Slice       | 内容                                                          | 价值           |
| ----------- | ------------------------------------------------------------- | -------------- |
| S1          | Suggestions 容器 + 静态 catalog + slash 触发(只 `shell_idle`) | 最小可用       |
| S2          | 接入 `editor` `pager` `tui` 的 catalog                        | 覆盖主要场景   |
| S3          | PC 键盘交互(↑↓ Enter Esc)                                     | 桌面体验对齐   |
| S4          | 埋点 + 文档                                                   | 可观测、可迭代 |
| **v1 截止** | —                                                             | —              |
| S5(v1.1)    | MRU(IndexedDB)+ 排序混合                                      | 个性化         |
| S6(v1.1)    | typeahead 触发(任何字符 ≥ 1)                                  | 全场景         |
| S7(v1.2)    | 后端 RPC `query_pane_path` 注入 git 子命令上下文              | 工程化补全     |

## 8. 待评审决策点

1. **slash-only 还是首发就上 typeahead?** 我倾向 slash-only(范围小、价值密度高、不抖)。typeahead 留 v1.1。
2. **catalog 维护:写死代码还是 JSON 配置?** 倾向写死 TS,小修改不值得加配置层。
3. **MRU 存哪?** IndexedDB(per-host),不要 localStorage(易爆)。
4. **PC Direct Mode 是否也要 Suggestions?** 否。Direct Mode 的设计前提是"键盘字节直通 shell",插一层补全违背初心。

## 9. 不在本方案内

- 远端 binary 探测(需要 RPC)
- 跨设备同步 MRU(需要后端存储)
- 模糊匹配 / fuzzy search(可后续)
- 多光标 / 行内补全(VSCode 风格,不适合手机)
- 上下文学习"用户在 `/repo` 下常打什么"(需要 cwd,延后)

---

**下一步**:评审通过后 → 写 `docs/design/0009-compose-smart-completion-tech-design.md`(组件树、状态机、Zustand store 增量)+ `docs/adr/0009-compose-smart-completion.md`(决策定稿)+ `docs/plans/0009-phase-2.6-plan.md`(切片落地排期)。
