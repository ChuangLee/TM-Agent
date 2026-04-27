# 0009 — Compose Bar 智能补全调研

> 状态:Research(为产品方案做准备)
> 日期:2026-04-22
> 关联:ADR-0006(shell-state classifier)、design/0006-mobile-action-first-product-spec.md

## 1. 问题陈述

当前手机端 Compose Bar 是一个"裸 textarea":用户敲什么就发什么,没有任何上下文提示。
KeyOverlay 已经按 shell 状态出**功能键**(`:w`、`Ctrl+C`、`y/n`),但**输入内容本身**完全没有智能化:

- 在 shell idle 下输入 `cl` 不会提示 `claude` / `clear`。
- 输入 `/` 不会弹出 slash-command 面板(类似 Claude Code 的 `/help`、`/model`)。
- 在 vim 命令模式下输入 `:` 不会提示 `:w` `:wq` `:q!`。
- 在 git 子命令(`git ` 之后)不会提示 `status` / `commit` / `push`。

手机端打字成本高(无 Tab 补全、无方向键回看历史),这块的 UX 缺口比 PC 大一个量级。

## 2. 现有管道(为方案找接入点)

> 详细文件路径见 `src/frontend/features/compose/ComposeBar.tsx` 与 `src/backend/tmux/cli-executor.ts`。

| 关注点        | 当前实现                                                                                                                                               | 改造空间                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 输入控件      | `<textarea>`,受控,值存 `useComposeDraftStore`(per-session draft)。`ComposeBar.tsx:27`                                                                  | 在 textarea 上方加一层悬浮 `<Suggestions />`,不动现有结构                                |
| 发送路径      | Enter(无 Shift)→ `onSend(trimmed)` → WS `send_raw` → 后端 `set-buffer + paste-buffer -dpr + sleep(120ms) + send-keys Enter`。`cli-executor.ts:166-191` | 选中建议 = 替换 textarea 值,不改发送路径                                                 |
| Shell 状态    | `useShellStateStore.current` 已有 `state` / `paneCurrentCommand` / `altScreen` / `tailSample`。`shell-state-store.ts`                                  | 直接订阅,作为补全策略的输入                                                              |
| 历史          | 占位符 `CardContext.history` 已存在,但**无 RPC**填数据。`state-definitions.ts:72-77`                                                                   | 新增持久化层(IndexedDB)或后端 RPC `query_history`                                        |
| 二进制可用性  | 完全不知道远端装了什么。`protocol.ts` 无 introspection 消息                                                                                            | 需新增 RPC 或采取启发式                                                                  |
| Pane 工作目录 | tmux 支持 `#{pane_current_path}`(tmux ≥ 3.1),但当前 `PANE_FMT` 没采集。`cli-executor.ts:8-12`                                                          | 加一个字段即可                                                                           |
| 弹层位置      | KeyOverlay `z-1000` `top: 3rem` fixed。`tokens.css:333-358`                                                                                            | Suggestions 应**贴在 textarea 顶边**,不复用 KeyOverlay 模式(它是全宽下拉,不适合候选列表) |

**结论**:接入点干净,不需要重构。Compose Bar 加一层 Suggestions 子组件 + 一份补全策略表 + (可选)新增 1 个后端 RPC,就能落地 v1。

## 3. 对标:他人怎么做的

### 3.1 Claude Code / OpenCode / Aider(AI CLI)

- **触发**:输入开头 `/` → 弹出 slash 命令面板(`/help`、`/model`、`/clear` 等)。
- **关键**:候选列表是**完全静态**的(应用自带的命令清单),不是 shell 补全。
- **导航**:↑↓ 选,Enter / Tab 接受,Esc 关闭。手机端通常是点选。
- **可借鉴**:slash 模式是最适合手机的低成本入口 —— 不打字,从清单里挑。

### 3.2 Warp / Fig(终端 IDE)

- **触发**:每个字符都触发(typeahead),候选来自:历史 + 已知二进制 + 子命令 spec(`fig autocomplete spec`)。
- **关键**:候选是**树状的**(`git` → `commit` → `-m`),靠维护一个庞大的 spec 仓库。
- **不借鉴**:维护成本太高,手机端屏幕也撑不下。但 git/docker 几个高频命令的子命令清单可以静态抄一份。

### 3.3 Atuin(shell history search)

- **触发**:Ctrl+R 全局历史搜索。
- **关键**:每条命令带元数据(cwd、exit code、duration),按相似度+频率排序。
- **可借鉴**:本地 IndexedDB 存"曾经从 Compose Bar 发出的命令"做 MRU,够手机端用,不必接后端 shell history 文件。

### 3.4 vim/bash 内置

- **vim 命令模式 `:`**:`:w` `:q` `:wq` `:e` 是高频集,KeyOverlay 已经覆盖;Suggestions 可补充 `:set` `:vsplit` 等长命令。
- **bash Tab 补全**:不模拟,代价/收益比差(需要把 readline 状态搬到前端)。手机端宁可在 Suggestions 里给"高频命令清单",不追求完整 Tab 体验。

## 4. 信号源能力评估

| 信号                                            | 是否已有           | 用途                                            |
| ----------------------------------------------- | ------------------ | ----------------------------------------------- |
| `shellState.state`(8 类)                        | ✅                 | 决定**用哪一份候选表**                          |
| `paneCurrentCommand`(`bash` / `vim` / `claude`) | ✅                 | 进一步细分(`vim` vs `nano` 用不同表)            |
| `paneCurrentPath`                               | ❌ 需加字段        | 决定上下文(`/repo` 下显示 git 子命令)           |
| 用户历史(MRU)                                   | ❌ 需建            | 个性化排序、首屏候选                            |
| 远端 `$PATH` 里有哪些 binary                    | ❌ 需 RPC          | 排除"用户机器没装的工具"                        |
| tmux scrollback 文本                            | ✅(`capture-pane`) | 仅用于 classifier,不建议拿来抽 token 做补全(脏) |

**v1 范围建议**:只用前两个 + 一份新建的**本地** MRU(IndexedDB),先不引入后端 RPC 和 `pane_current_path`。后两者放 v1.1。

## 5. 风险与边界

- **键盘焦点**:手机软键盘已经占半屏,Suggestions 面板若挡住 textarea 就废了 → 必须**向上**弹,不能向下。
- **classifier 抖动**:`shellState` 在 200ms debounce,候选切换会闪 → Suggestions 自己再加 80ms throttle,且**首字符决定模式后锁定**(用户已经在敲 `/...`,classifier 中途变成 `tui` 也不该把 slash 面板换掉)。
- **隐私**:MRU 不能在 `password_prompt` / `confirm_prompt` 状态写入;`set-buffer` 已有此约束(ComposeBar.tsx:21),Suggestions 复用同一闸门。
- **Direct Mode**:PC 上的直通模式不走 Compose Bar,这个特性**只对手机和 PC 的 Compose 模式生效**。Direct Mode 用户拿真键盘 + bash Tab 即可。

## 6. 给产品方案的输入

下游 product spec 应当回答:

1. **触发模型**:slash 触发(显式)+ typeahead(隐式),v1 只做 slash?还是两个一起上?
2. **候选来源优先级**:静态命令表 vs MRU vs 后端 RPC,谁压谁。
3. **每个 shellState 的候选表内容**(可以参考 KeyOverlay 现有的 `key-layout.ts` 结构)。
4. **UI 形态**:是吸顶的 chip 横排,还是悬浮的列表?选中交互(点 vs 点+确认)?
5. **关闭/取消**:点击候选外、Esc、删完触发字符,谁负责关。
6. **可观测性**:命中率怎么衡量(发出 = MRU 写入,点选 = 命中)。

下一份文档 `docs/design/0009-compose-smart-completion-product-spec.md` 给出方案。
