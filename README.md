# TM-Agent

[English](./README.en.md) · **简体中文**

> **智能体时代的精准控制台** —— 在手机上,用 tmux 的方式同时驾驭多个 AI Agent。

TM-Agent 是一个**触屏优先**的 tmux Web 客户端。它不是又一个 SSH-in-the-browser,也不是把桌面 UI 套层移动样式;它从手机端**反向重写**每一个交互,让你在地铁、咖啡馆、被窝里都能精准多路控制 Claude Code / Codex / Aider / Gemini CLI 等长跑型 agent —— 同一份代码在桌面端自然 reflow 成两栏专业布局,毫无割裂。

后端 fork 自 [DagsHub/tmux-mobile](https://github.com/DagsHub/tmux-mobile),前端完全重写。

> Status: **Phase 2 已完成** · 实时终端 · 原生惯性滚动 · 长按取词复制。下阶段计划见 [`docs/ROADMAP.md`](./docs/ROADMAP.md)。

---

## ✨ 核心亮点

- 📎 **附件直投 Agent** —— Compose Bar 直接**粘贴 / 拖入**图片、PDF、代码,自动注入 prompt,**告别 `scp`**
- ⚡ **智能 Slash 补全** —— 识别 Claude Code / Codex / Gemini / Aider,弹对应命令面板
- 🪟🪟 **多 Session 同屏平铺** —— 桌面 1×1 / 1×2 / 2×2 三档,四个 agent 并行不打架
- 🚀 **Direct Mode 直通模式** —— 桌面所有键盘事件原生穿透 PTY,vim / Ctrl-C / tmux prefix 全可用
- 📜 **浏览器原生滚屏 tmux 历史** —— 滚轮 / 拖选 / Cmd-C 复制就是文本,不是另一个假滚动条
- 📱 **真·原生触屏** —— 浏览器自带 kinetic 惯性滚动 + 长按冻结取词复制,不写一行 `touchmove`
- 🗂️ **内置文件管理** —— 浏览 / 上传 / 下载 / 预览(图片 · PDF · 视频 · 音频 · Markdown · 代码)
- 📈 **系统状态贴脚** —— CPU / 内存 / Load 双 sparkline 实时刷,谁吃爆机器一眼可见
- 🔐 **生产可部署** —— 一行 `curl` 安装,systemd + nginx + TLS 模板齐全

---

## 🎯 做对了的事

- 🖱️ 原生滚条滚 tmux 历史
- 📋 拖选即复制纯文本
- 👆 长按冻结取词
- 🌊 浏览器原生惯性滚动
- ⌨️ 虚拟键盘不挤压终端
- 🀄 中文输入不丢字
- 🔌 关 tab 不丢 agent
- 🖼️ 粘贴 / 拖图免 `scp` 投喂 Agent
- ⚡ 敲 `/` 智能补全
- 🪟 桌面 2×2 多 agent 平铺
- 🚀 Direct Mode 键盘直通
- 🗂️ 内置 Files 浏览 / 预览
- 📈 CPU / 内存 sparkline
- 🔣 QR code 半块字不错位

---

## 为什么不是又一个 webshell

把整个浏览器交给一个 agent(Claude.ai、ChatGPT Atlas、Comet 这类 "agentic browser"),看似酷炫,实则灾难:

- **Token 巨亏** —— 每次刷新、每棵 DOM 树都要喂给模型,账单和延迟同步起飞。
- **不够精准** —— 一个 tab、一个 agent、一根线程。无法同时盯三个任务、两个仓库、四个分支。
- **状态脆弱** —— tab 一关、网络一抖、电量一没,agent 上下文全部蒸发。
- **手机绝望** —— 移动端体验近乎不可用,而你 70% 的碎片时间都在手机上。

**真正的答案是 tmux。** 一个 agent 一个 session,多开、并行、可 detach、可 reattach、按需切换。tmux 用几十年证明了它的 session 模型本来就是为长跑型进程设计的 —— 而现代 agent 恰恰就是长跑型进程。

TM-Agent 把这种精准多路控制能力,搬到你口袋里那块**竖屏**上。完整设计动机见 [`docs/PRD.md`](./docs/PRD.md) 与 [`docs/DESIGN_PRINCIPLES.md`](./docs/DESIGN_PRINCIPLES.md)。

> 它**不是** AI 专用工具,但它**懂 AI**。一个跑 `claude` / `codex` / `aider` / `vim` / `htop` / 裸 shell 的 tmux session,在仓库眼里结构完全等价 —— 但 Compose Bar 会针对当前 pane 里跑的是哪个 agent 给出对应的快捷命令。核心通用、外围贴心,见 [Design Principle 4](./docs/DESIGN_PRINCIPLES.md)。

---

## 功能详解

### 📎 附件直投 —— 粘贴 / 拖一张图,Agent 看图 Debug

普通 webshell 想让 agent 看一张图?要么 `scp` 上传、要么自己拷路径。**TM-Agent 把这步消掉了**:

- **截屏 → Cmd-V** 一键粘贴进 Compose Bar
- **任何文件**(图片 / PDF / 视频 / 代码)拖进来或点附件按钮
- 后端落到 `msg-upload/<时间戳>-<文件名>`,消息末尾自动追加 `本消息对应的文件路径为: msg-upload/...`
- Claude Code / Codex / Aider 收到就能直接用相对路径 `Read`

截图 → bug 报告 → agent 看图 debug,一气呵成,全程不离开浏览器。

### ⚡ 智能 Slash 补全 —— 不用背命令

在 Compose Bar 敲 `/`,前端自动识别当前 pane 是 shell-idle 还是 TUI,并进一步判断 TUI 是 Claude Code / Codex / Gemini CLI / Hermes / Aider 中的哪个,弹出对应的 slash 命令面板(`/help`、`/clear`、`/resume`、`/compact`...)。常用命令免背,新接入的 agent 也能秒上手。

### 🪟🪟 多 Session 同屏平铺(桌面)

TopBar 的 ⊞ 布局按钮切换 1×1 / 1×2 / 2×2 三档。每格独立连一条 tmux session —— 一个 Claude Code、一个 Codex、一个 logs tail、一个 aider,**四个 agent 并行不打架**。每 slot 绑位置色(cyan / amber / violet / rose),焦点格加粗描边 + Compose Bar 上方 `→ session-name` 显式标注"下条发给谁"。`Ctrl+1..4` 快捷切焦点。关 slot 自动 pack + 降档(4→3→2→1)。Direct Mode 的呼吸光跟着焦点走。背后是后端 per-(client, slot) 独立 PTY,tmux 本身 0 改动。详见 [ADR-0013](./docs/adr/0013-multi-pane-desktop-tiling.zh.md)。

### 🚀 Direct Mode —— 桌面键盘 100% 直通 PTY

桌面端(≥820px + 鼠标设备)TopBar 有 Direct Mode 开关。打开后,**所有键盘事件**(含 Ctrl / Alt / Shift / 组合键)直通 PTY,绕过 Compose 流程 —— vim、tmux prefix、Ctrl-C 全部 native。视觉上 Compose Bar 模糊、终端外发出呼吸光、顶部脉冲提示当前在 Direct Mode。退出:`Ctrl+]` / 双击 Esc / 再按一次按钮。

> 手机端**故意没做** Direct Mode —— 虚拟键盘没物理修饰键,做了也是残废。是有意识的取舍,不是漏做。

### 📱 手机端做对了什么

- **原生惯性滚动**。`.scroller` 是真实滚动容器;`.spacer` 与 tmux 缓冲长度对齐;`.viewport` 顶部吸附。一个 `scroll` 监听器驱动 `term.scrollToLine(n)`,kinetic 让浏览器自己算。详见 [ADR-0004](./docs/adr/0004-native-scroll-via-virtual-container.md)。
- **长按冻结取词**。canvas 之上叠一层 `color: transparent` 的 DOM 镜像承载真实文本;长按 500ms / 漂移 < 10px 即把当前帧捕获进 `FreezeLayer`(Copy / Select line / Exit),live PTY 输出再也不会把选区抢走。详见 [ADR-0003](./docs/adr/0003-freeze-and-select.md)。
- **历史 = 滚屏**。attach 时后端先推 10 000 行 `capture-pane -e`,再开 live socket。往上滚历史和往上滚最近输出是**同一个手势** —— 没有"历史视图"这种割裂概念。
- **虚拟键盘不挤压终端**。`VisualViewport` API + CSS 把 Compose Bar 钉在键盘上沿。不用 `position: fixed`(那个在 iOS 上会跟虚拟键盘打架)。

### 🗂️ 内置文件管理

侧栏 Files 面板 = 完整文件浏览器:面包屑导航、点文件 toggle、上传 / 下载 / 删除 / 重命名、图片 / PDF / 视频 / 音频 / Markdown / 代码原生预览(视频音频支持 range request 拖动定位)。后端做了符号链接逃逸与路径穿越防护。Agent 帮你写好的产物,顺手就能拿走。

### 📈 系统状态贴脚

侧栏脚部常驻 CPU% / 内存% / load1 双 sparkline,2 秒一刷,60 秒历史 hover 可看。折叠状态退化为三个阈值色点(绿 / 黄 / 红)。多个 agent 并行时,谁把机器吃爆一眼可见。Linux only。

### ⌨️ Compose 直注 tmux —— IME 友好

文本输入全程走系统 IME(中文 / 拼音 / emoji 全 OK),提交时用 `set-buffer` + `paste-buffer -dpr` 整段注入 tmux,而非逐字符按键流 —— 避免 agent 在你打字过程中误读半截 prompt。

### 🪟 桌面 Two-column Reflow

同一份代码:手机是抽屉 + 单 pane 全屏;桌面是常驻 sidebar(Sessions / Files / Sysinfo)+ 主区终端。不是两套代码,不是 responsive 套皮,是真的同一棵组件树跟着断点 reflow。

---

## Quick Start

```bash
git clone https://github.com/ChuangLee/TM-Agent.git
cd TM-Agent
npm install
npm run dev
```

`npm run dev` 并发起后端(`tsx watch`)和 Vite。Vite 把 `/ws/*` 与 `/api/*` 代理到后端。后端默认每次启动随机生成 token,从日志读出来,打开 `http://localhost:5173/?token=<token>`。

```bash
npm test            # vitest unit + integration
npm run test:e2e    # playwright(builds first)
npm run typecheck   # tsc --noEmit(backend + frontend)
npm run lint        # eslint
npm run build       # frontend via vite, backend via tsc
```

---

## 部署

**一行入场(推荐)**:

```bash
curl -fsSL https://raw.githubusercontent.com/ChuangLee/TM-Agent/main/scripts/bootstrap.sh | sudo bash
```

带参数:

```bash
curl -fsSL https://raw.githubusercontent.com/ChuangLee/TM-Agent/main/scripts/bootstrap.sh \
  | sudo bash -s -- --workspace-root /root/repos
```

`bootstrap.sh` 把仓库 clone 到 `/opt/tm-agent` 再 hand off 给 `scripts/install.sh`(幂等,重跑 = 升级)。`install.sh` 自动:`npm install` → `npm run build` → `npm prune --omit=dev` → 随机生成 token / password → 写 `/etc/tm-agent/env`(600)→ 装 systemd unit → `systemctl enable --now`。`--workspace-root` 把 session wizard 的目录选择器限制在该路径以下(ADR-0017)。

脚本不做的只有 nginx + TLS —— 每家反代配置差异太大,保留手动。模板:

- 独立子域名(`https://tmux.host.example/`):[`docs/deployment/nginx.conf.example`](./docs/deployment/nginx.conf.example)
- 子路径(`https://host.example/tmux/`):[`docs/deployment/nginx.conf.example.subpath`](./docs/deployment/nginx.conf.example.subpath) —— 搭配安装时加 `--base-path /tmux`(ADR-0018)

**已 clone 过仓库**直接 `sudo ./scripts/install.sh --workspace-root ~/repos` 即可;**完整手动步骤**见 [`docs/deployment/README.md`](./docs/deployment/README.md)。

---

## 架构

- [`docs/PRD.md`](./docs/PRD.md) — user stories & success criteria
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — 模块边界、wire protocol、state shape
- [`docs/DESIGN_PRINCIPLES.md`](./docs/DESIGN_PRINCIPLES.md) — 五条统辖 UX 决策的原则
- [`docs/ROADMAP.md`](./docs/ROADMAP.md) — phased delivery,当前 phase marker
- [`docs/adr/`](./docs/adr/) — architectural decision records;非 trivial 的结构变更先落这里

```
src/
├── backend/           # Node + Express + ws + node-pty + tmux gateway
├── frontend/          # Vite + React 19 + Tailwind + xterm.js
│   ├── app/           # AppShell
│   ├── features/
│   │   ├── auth/      # password prompt
│   │   ├── compose/   # ComposeBar
│   │   ├── shell/     # TopBar
│   │   └── terminal/  # Surface, ScrollMirror, FreezeLayer, use-terminal
│   ├── hooks/         # control-session, visual-viewport inset
│   ├── lib/ansi/      # xterm buffer cells → HTML
│   ├── services/      # control-ws / terminal-ws clients, config api
│   ├── stores/        # zustand(auth, sessions, terminal, freeze)
│   └── styles/        # tokens.css = single source of truth for cell metrics
└── shared/            # wire protocol types
```

---

## 进度

| Phase | Ships                                        | State    |
| ----- | -------------------------------------------- | -------- |
| 0     | Repo bootstrap, CI, backend port             | done     |
| 1     | Live terminal + compose + auth               | done     |
| 2     | Native scroll, DOM mirror, freeze-and-select | **done** |
| 3     | Session drawer + window navigation           | next     |
| 4     | Command sheet + smart keys                   |          |
| 5     | Panes as cards (horizontal swipe carousel)   |          |
| 6     | Polish pass                                  |          |

---

## 贡献

工作流、commit 规范、PR checklist 见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

## 致谢

本项目站在这些项目的肩膀上 —— 没有它们,TM-Agent 不会存在。

- **[DagsHub/tmux-mobile](https://github.com/DagsHub/tmux-mobile)** —— 后端 fork 的直接上游。Node + `ws` + `node-pty` + tmux CLI 网关、password / token 双因子认证、`FakeTmuxGateway` / `FakePtyFactory` 测试替身,都是从这里继承并保留的。TM-Agent 把前端完全重写,后端几乎原样留用。感谢 DagsHub 团队把这层扎实的基础做出来并开源。
- **[tmux](https://github.com/tmux/tmux)** —— 事实后端。session / window / pane 模型几十年如一日地正确,以至于"把 agent 当长跑进程跑"这件事根本不需要我们发明新概念。
- **[xterm.js](https://github.com/xtermjs/xterm.js)** —— 当作 headless ANSI 解析 + buffer 维护引擎使用(ADR-0005),渲染层自己写。没有 xterm 成熟的 VT 解析,live pane 这条路根本走不通。
- **[shadcn/ui](https://ui.shadcn.com/)** + **[Radix UI](https://www.radix-ui.com/)** —— sidebar、dialog、popover 等 a11y primitive 的来源。
- **React 19 · Vite 7 · Tailwind v4 · motion · @use-gesture/react · @tanstack/react-virtual** —— 现代 web 栈的其它基石;具体选型理由散见于 `docs/adr/`。

## License

MIT. 后端 fork 自 [DagsHub/tmux-mobile](https://github.com/DagsHub/tmux-mobile)(亦为 MIT);上游版权声明保留在原文件中。前端是全新代码。
