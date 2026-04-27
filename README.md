# TM-Agent

[English](./README.en.md) · **简体中文**

> **智能体时代的精准控制台** —— 随时随地，精准驾驭多个 AI Agent，节省 Token，提高效率。

TM-Agent 是一个用户体验优先的 tmux Web 客户端，为 Claude Code、Codex、Gemini CLI、Aider、Hermes 等 Agent 工作流深度优化。相比 OpenClaw、Hermes 等完全托管的智能体应用，TM-Agent 不把你的浏览器、仓库和上下文再次交给另一个上层 Agent，而是让你直接进入远端 tmux 会话，精确观察和指挥多个正在运行的 AI Agent：看清每一行输出、只在需要时介入、少转述、少浪费 Token。

> Status: **Public preview / v0.1.0** · 手机触屏终端 · 桌面多 session 平铺 · 文件面板 · Direct Mode · i18n。规划日志见 [`docs/ROADMAP.md`](./docs/ROADMAP.md)。

---

## ✨ 核心亮点

- 📱 **手机友好** —— 触屏滚动，长按复制，竖屏优化
- 📎 **附件直投 Agent** —— 输入框直接**粘贴 / 拖入**图片、PDF、代码，上传后自动注入 prompt，告别 `scp`
- 🪟🪟 **多 Session 同屏** —— 最多 2×2 布局，四个 Agent 并行精准观察指挥
- 📜 **原生滚屏 tmux** —— 滚轮 / 拖选 / Cmd-C 直接复制
- 🗂️ **文件管理** —— 工作成果即时可看，浏览 / 预览 / 上传 / 下载 / 删除
- ⚡ **Agent 优化** —— 直接新建 Claude Code / Codex / Gemini / Hermes 会话，智能 Slash 补全
- 🚀 **Direct Mode 直通模式** —— 传统 webshell 所有功能，键盘事件原生穿透 PTY，vim 全可用
- 📈 **系统状态** —— CPU / 内存 / Load 双 sparkline 实时观察

---

## 🎯 做对了的事

- 🖱️ 原生滚条滚 tmux 历史
- 📋 拖选即复制纯文本
- 👆 长按冻结取词
- 🌊 浏览器原生惯性滚动
- ⌨️ 虚拟键盘不挤压终端
- 🀄 中文输入不丢字
- 🔌 关 tab 不丢 Agent
- 🖼️ 粘贴 / 拖图免 `scp` 投喂 Agent
- ⚡ 敲 `/` 智能补全
- 🪟 桌面 2×2 多 Agent 平铺
- 🚀 Direct Mode 键盘直通
- 🗂️ 内置 Files 浏览 / 预览
- 📈 CPU / 内存 sparkline
- 🔣 QR code 半块字不错位

---

## 功能详解

### 📎 附件直投 —— 粘贴 / 拖一张图，Agent 看图 Debug

普通 webshell 想让 Agent 看一张图？要么 `scp` 上传、要么自己拷路径。**TM-Agent 把这步消掉了**：

- **截屏 → Cmd-V** 一键粘贴进 Compose Bar
- **任何文件**（图片 / PDF / 视频 / 代码）拖进来或点附件按钮
- 后端落到 `msg-upload/<时间戳>-<文件名>`，消息末尾自动追加 `本消息对应的文件路径为: msg-upload/...`
- Claude Code / Codex / Aider 收到就能直接用相对路径 `Read`

截图 → bug 报告 → Agent 看图 debug，一气呵成，全程不离开浏览器。

### ⚡ 智能 Slash 补全 —— 不用背命令

在 Compose Bar 敲 `/`，前端自动识别当前 pane 是 shell-idle 还是 TUI，并进一步判断 TUI 是 Claude Code / Codex / Gemini CLI / Hermes / Aider 中的哪个，弹出对应的 slash 命令面板（`/help`、`/clear`、`/resume`、`/compact`...）。常用命令免背，新接入的 Agent 也能秒上手。

### 🪟🪟 多 Session 同屏平铺（桌面）

TopBar 的 ⊞ 布局按钮切换 1×1 / 1×2 / 2×2 三档。每格独立连一条 tmux session —— 一个 Claude Code、一个 Codex、一个 logs tail、一个 Aider，**四个 Agent 并行不打架**。每 slot 绑位置色（cyan / amber / violet / rose），焦点格加粗描边 + Compose Bar 上方 `→ session-name` 显式标注“下条发给谁”。`Ctrl+1..4` 快捷切焦点。关 slot 自动 pack + 降档（4→3→2→1）。Direct Mode 的呼吸光跟着焦点走。背后是后端 per-(client, slot) 独立 PTY，tmux 本身 0 改动。详见 [ADR-0013](./docs/adr/0013-multi-pane-desktop-tiling.zh.md)。

### 🚀 Direct Mode —— 桌面键盘 100% 直通 PTY

桌面端（≥820px + 鼠标设备）提供 Direct Mode 开关。打开后，**所有键盘事件**（含 Ctrl / Alt / Shift / 组合键）直通 PTY，绕过 Compose 流程 —— vim、tmux prefix、Ctrl-C 全部 native。视觉上 Compose Bar 模糊、终端外发出呼吸光、顶部脉冲提示当前在 Direct Mode。退出：`Ctrl+]` / `Shift+Esc` / 顶部指示条按钮 / 再按一次开关。

> 手机端**故意没做** Direct Mode —— 虚拟键盘没物理修饰键，做了也是残废。是有意识的取舍，不是漏做。

### 📱 手机端做对了什么

- **原生惯性滚动**。`.scroller` 是真实滚动容器；`.spacer` 与 tmux 缓冲长度对齐；`.viewport` 顶部吸附。一个 `scroll` 监听器驱动 `term.scrollToLine(n)`，kinetic 让浏览器自己算。详见 [ADR-0004](./docs/adr/0004-native-scroll-via-virtual-container.md)。
- **长按冻结取词**。canvas 之上叠一层 `color: transparent` 的 DOM 镜像承载真实文本；长按 500ms / 漂移 < 10px 即把当前帧捕获进 `FreezeLayer`（Copy / Select line / Exit），live PTY 输出再也不会把选区抢走。详见 [ADR-0003](./docs/adr/0003-freeze-and-select.md)。
- **历史 = 滚屏**。attach 时后端先推 10 000 行 `capture-pane -e`，再开 live socket。往上滚历史和往上滚最近输出是**同一个手势** —— 没有“历史视图”这种割裂概念。
- **虚拟键盘不挤压终端**。`VisualViewport` API + CSS 把 Compose Bar 钉在键盘上沿。不用 `position: fixed`（那个在 iOS 上会跟虚拟键盘打架）。

### 🗂️ 内置文件管理

侧栏 Files 面板 = 完整文件浏览器：面包屑导航、点文件 toggle、上传 / 下载 / 删除 / 重命名、图片 / PDF / 视频 / 音频 / Markdown / 代码原生预览（视频音频支持 range request 拖动定位）。后端做了符号链接逃逸与路径穿越防护。Agent 帮你写好的产物，顺手就能拿走。

### 📈 系统状态贴脚

侧栏脚部常驻 CPU% / 内存% / load1 双 sparkline，2 秒一刷，60 秒历史 hover 可看。折叠状态退化为三个阈值色点（绿 / 黄 / 红）。多个 Agent 并行时，谁把机器吃爆一眼可见。Linux only。

### ⌨️ Compose 直注 tmux —— IME 友好

文本输入全程走系统 IME（中文 / 拼音 / emoji 全 OK），提交时用 `set-buffer` + `paste-buffer -dpr` 整段注入 tmux，而非逐字符按键流 —— 避免 Agent 在你打字过程中误读半截 prompt。

### 🪟 桌面 Two-column Reflow

同一份代码：手机是抽屉 + 单 pane 全屏；桌面是常驻 sidebar（Sessions / Files / Sysinfo）+ 主区终端。不是两套代码，不是 responsive 套皮，是真的同一棵组件树跟着断点 reflow。

---

## Quick Start

```bash
git clone https://github.com/ChuangLee/TM-Agent.git
cd TM-Agent
npm install
npm run dev
```

`npm run dev` 会同时启动后端（`tsx watch`）和 Vite。Vite 把 `/ws/*` 与 `/api/*` 代理到后端。后端默认每次启动随机生成 token，从日志读出来，打开 `http://localhost:5173/?token=<token>`。

```bash
npm test            # vitest unit + integration
npm run test:e2e    # playwright(builds first)
npm run typecheck   # tsc --noEmit(backend + frontend)
npm run lint        # eslint
npm run build       # frontend via vite, backend via tsc
```

---

## 部署

**一行入场（推荐）**:

```bash
curl -fsSL https://raw.githubusercontent.com/ChuangLee/TM-Agent/main/scripts/bootstrap.sh | sudo bash
```

带参数:

```bash
curl -fsSL https://raw.githubusercontent.com/ChuangLee/TM-Agent/main/scripts/bootstrap.sh \
  | sudo bash -s -- --workspace-root /root/repos
```

`bootstrap.sh` 会在缺少 `git` 时自动安装，然后把仓库 clone 到 `/opt/tm-agent` 再 hand off 给 `scripts/install.sh`（幂等，重跑 = 升级）。`install.sh` 会在常见 Linux 发行版上自动补齐 tmux、openssl、原生构建工具和 Node.js 20+，然后执行：`npm install` → `npm run build` → `npm prune --omit=dev` → 随机生成 token / password → 写 `/etc/tm-agent/env`（600）→ 装 systemd unit → `systemctl enable --now`。`--workspace-root` 把 session wizard 的目录选择器限制在该路径以下（ADR-0017）。

脚本不做的只有 nginx / Caddy + TLS —— 每家反代配置差异太大，保留手动。后端默认监听 `http://127.0.0.1:8767/?token=<token>`，反代模板：

- 独立子域名（`https://tmux.host.example/`）：[`docs/deployment/nginx.conf.example`](./docs/deployment/nginx.conf.example)
- Caddy 独立子域名：[`docs/deployment/Caddyfile.example`](./docs/deployment/Caddyfile.example)
- 子路径（`https://host.example/tmux/`）：[`docs/deployment/nginx.conf.example.subpath`](./docs/deployment/nginx.conf.example.subpath) —— 搭配安装时加 `--base-path /tmux`（ADR-0018）
- Caddy 子路径：[`docs/deployment/Caddyfile.example.subpath`](./docs/deployment/Caddyfile.example.subpath)

**已 clone 过仓库**直接 `sudo ./scripts/install.sh --workspace-root ~/repos` 即可；**完整手动步骤**见 [`docs/deployment/README.md`](./docs/deployment/README.md)。

---

## 架构

- [`docs/PRD.md`](./docs/PRD.md) — user stories & success criteria
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — 模块边界、wire protocol、state shape
- [`docs/DESIGN_PRINCIPLES.md`](./docs/DESIGN_PRINCIPLES.md) — 五条统辖 UX 决策的原则
- [`docs/ROADMAP.md`](./docs/ROADMAP.md) — 历史规划日志与后续方向
- [`docs/adr/`](./docs/adr/) — architectural decision records；非 trivial 的结构变更先落这里

```
src/
├── backend/           # Node + Express + ws + node-pty + tmux gateway
├── frontend/          # Vite + React 19 + Tailwind + xterm.js
│   ├── app/           # AppShell
│   ├── features/
│   │   ├── action-panel/
│   │   ├── auth/      # password prompt
│   │   ├── compose/   # ComposeBar
│   │   ├── direct-mode/
│   │   ├── files/     # sidebar file browser + preview
│   │   ├── key-overlay/
│   │   ├── sessions/
│   │   ├── shell/     # TopBar + shell chrome
│   │   ├── sysinfo/
│   │   └── terminal/  # MultiSurface, SlotFrame, xterm wiring
│   ├── hooks/         # control-session, terminal/session lifecycle
│   ├── lib/ansi/      # xterm buffer cells → HTML
│   ├── services/      # control-ws / terminal-ws clients, config api
│   ├── stores/        # zustand(auth, sessions, layout, terminal, files, sysinfo, ui)
│   └── styles/        # tokens.css = single source of truth for cell metrics
└── shared/            # wire protocol types
```

---

## 当前状态

| Area                         | State                          |
| ---------------------------- | ------------------------------ |
| Live terminal / auth / send  | shipped                        |
| Mobile scroll / freeze / IME | shipped                        |
| Sessions / Files / Sysinfo   | shipped                        |
| Multi-session tiling         | shipped                        |
| Direct Mode                  | shipped                        |
| i18n / install / deploy docs | shipped                        |
| Post-v0.1 focus              | polish, packaging, performance |

---

## 贡献

工作流、commit 规范、PR checklist 见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

## 致谢

本项目站在这些项目的肩膀上 —— 没有它们，TM-Agent 不会存在。

- **[DagsHub/tmux-mobile](https://github.com/DagsHub/tmux-mobile)** —— 后端 fork 的直接上游。Node + `ws` + `node-pty` + tmux CLI 网关、password / token 双因子认证、`FakeTmuxGateway` / `FakePtyFactory` 测试替身，都是从这里继承并持续扩展的。TM-Agent 把前端完全重写，并在后端增加了多 slot、文件、sysinfo、安装部署等能力。感谢 DagsHub 团队把这层扎实的基础做出来并开源。
- **[tmux](https://github.com/tmux/tmux)** —— 事实后端。session / window / pane 模型几十年如一日地正确，以至于“把 Agent 当长跑进程跑”这件事根本不需要我们发明新概念。
- **[xterm.js](https://github.com/xtermjs/xterm.js)** —— 当作 headless ANSI 解析 + buffer 维护引擎使用（ADR-0005），渲染层自己写。没有 xterm 成熟的 VT 解析，live pane 这条路根本走不通。
- **[shadcn/ui](https://ui.shadcn.com/)** + **[Radix UI](https://www.radix-ui.com/)** —— sidebar、dialog、popover 等 a11y primitive 的来源。
- **React 19 · Vite 7 · Tailwind v4 · motion · @use-gesture/react · @tanstack/react-virtual** —— 现代 web 栈的其它基石；具体选型理由散见于 `docs/adr/`。

## License

MIT. 后端 fork 自 [DagsHub/tmux-mobile](https://github.com/DagsHub/tmux-mobile)（亦为 MIT）；上游版权声明保留在原文件中。前端是全新代码。
