# 0008 — Web Shell 项目中的文件传输与系统状态面板调研

> 日期: 2026-04-21
> 作者: @ChuangLee
> 状态: 结论沉淀，未排期（挂到 ROADMAP Post-v1）

## 1. 背景

TM-Agent 现阶段是纯 tmux 客户端。随着手机端 Phase 2.5 (Action-First UI) 稳定，开始讨论 v2 可能的能力外延。两个被反复提到的方向：

- **浏览器 ↔ 服务器的文件上传/下载**（不依赖 scp/sz/rz）
- **主机系统状态面板**（CPU、内存、磁盘、网络实时指标）

先摸清同类项目的做法，避免闭门造车。

## 2. 对比

| 项目                      | 终端        | 文件传输          | 实现方式                | 系统状态       | Star  | License    |
| ------------------------- | ----------- | ----------------- | ----------------------- | -------------- | ----- | ---------- |
| ttyd                      | ✓           | ✓                 | ZMODEM / trzsz over tty | ✗              | 11.5k | MIT        |
| Wetty                     | ✓           | 半 (只下载)       | lrzsz                   | ✗              | 5.2k  | MIT        |
| Gotty (sorenisanerd fork) | ✓           | ✗                 | —                       | ✗              | 2.5k  | MIT        |
| Shellinabox               | ✓           | ✗                 | —                       | ✗              | 3.0k  | GPL-2      |
| code-server               | ✓ (VS Code) | 半 (拖拽有 bug)   | HTTP                    | ✗              | 77k   | MIT        |
| Tabby Web                 | ✓           | ✓                 | SFTP                    | ✗              | 70k   | MIT        |
| **Cockpit**               | ✓           | ✓ (cockpit-files) | HTTP                    | **✓ 实时图表** | 13.9k | LGPL       |
| **Webmin**                | ✓           | ✓ (filemin)       | HTTP                    | **✓**          | 5.7k  | BSD-3      |
| Next Terminal             | ✓           | ✓                 | SFTP                    | 半 (会话审计)  | 5.5k  | Apache-2 † |
| JumpServer                | ✓           | ✓                 | SFTP + 审计             | 半 (资产视角)  | 30k   | GPL-3      |
| Apache Guacamole          | ✓           | ✓                 | SFTP (拖拽 + `guacctl`) | ✗              | 3.8k  | Apache-2   |
| KasmVNC                   | ✓ (VNC)     | ✓                 | HTTP                    | ✗              | 4.9k  | GPL-2      |
| Sshwifty                  | ✓           | ✗                 | —                       | ✗              | 3.0k  | AGPL-3     |
| tmux-mobile               | ✓           | ✗                 | —                       | ✗              | 10    | MIT        |

† Next Terminal v2.0.0 起后端闭源。

## 3. 观察

- **纯终端派** (ttyd/Wetty/Sshwifty/Gotty/Shellinabox)：大多不做文件，少数靠 zmodem/trzsz 在 tty 字节流里偷跑。
- **堡垒审计派** (JumpServer/Next Terminal/Guacamole)：文件功能成熟 (SFTP + 审计 + 录像)，系统监控弱。
- **IDE 派** (code-server/Tabby Web)：文件靠拖拽或内置 SFTP，无系统面板。
- **系统管理派** (Cockpit/Webmin)：三件齐全。Cockpit 的实时指标图 + 日志联动是标杆。

**真正做到"终端 + 文件传输 + 系统状态"三合一的只有 Cockpit 和 Webmin。**

## 4. 如果我们做，值得参考哪几个点

### 4.1 文件传输

- **Apache Guacamole 的 `guacctl` 模式** —— 用户在 pane 里敲一条命令触发浏览器下载 (`guacctl download <path>`)；上传走浏览器拖拽。优点：下载由 shell 命令触发，天然解决"浏览器怎么知道用户想下哪个文件"的问题，且和 tmux 的会话模型契合 (你已经在 pane 里,为什么还要切 UI)。
- **SFTP (JumpServer / Next Terminal / Tabby Web)** —— 能力最全但需独立的文件服务连接，UI 复杂度上一个台阶。
- **ttyd 的 trzsz over tty** —— 轻量，复用现有 WebSocket 字节流；但会和 tmux pane 的字节流冲突 (tmux 不透传 zmodem 字节序列)。**我们不能用这条路。**

**倾向**：如果做，优先 Guacamole 式的 shell-triggered 下载 + 浏览器拖拽上传。独立于 tmux 字节流，走单独的 HTTP 端点。

### 4.2 系统状态面板

- **Cockpit** —— PCP 指标 + SVG 实时流图 + 和 journal 关联。模块化架构 (每个模块一个 package) 也值得借鉴。
- 粒度要**做小**：我们不是 server management 工具，sidebar 顶部一条 CPU / mem / load sparkline (过去 60s) 就够，不做磁盘/网络/服务面板；那是和 Cockpit 正面竞争，做不过也不该做。

### 4.3 明确不抄的部分

- **会话录像 + 传输审计** (JumpServer / Next Terminal)：对个人单用户 overkill，合规场景才有意义。
- **全主机管理** (Cockpit 改服务、改网络、改防火墙)：不是我们的 scope，也会引入巨大的 auth / sudo / 系统调用表面。

## 5. 结论

两项能力都有清晰的 prior art，方案路径可行但**都不是 v1 的战场**：

1. 现阶段 TM-Agent 的差异化是**触屏优先的 tmux 交互 + AI agent 陪伴场景**。文件传输和系统面板是锦上添花，不是差异化。
2. 文件传输强依赖于一个"独立 HTTP + 鉴权"的模块，引入 auth、路径遍历防御、大文件流、进度条 UI；做之前先确认用户真的缺这个 (很多人已经有 scp/rsync 习惯)。
3. 系统面板是"单向只读"功能，比文件传输安全得多，但没有文件传输的高频使用理由。

→ 挂到 ROADMAP Post-v1，排在"side-by-side 面板、session pinning、跨会话搜索、语音输入、push 通知"之后，**不列入短期迭代**。

真要做的时候：

- 文件传输：一份 ADR，方案默认 Guacamole 式 (shell 命令触发下载 + 拖拽上传)。
- 系统面板：一份 ADR，参考 Cockpit 的指标采集模型 (PCP 或直接读 `/proc`) + sparkline UI。

## 6. 更新 — 2026-04-22

系统面板部分提前实施。理由：`/proc` 读取成本极低、侧栏有现成的空间、对 long-running agent 陪跑场景高价值低成本。方案完全落在本调研 §4.2 的设想内（只读 sparkline、不做主机管理）。见 [ADR-0011](../adr/0011-sidebar-system-status.zh.md)。

~~文件传输仍留在 Post-v1，本次不动。~~

## 7. 更新 — 2026-04-22（同日，晚）

**文件传输也提前，且 scope 扩大**。见 [ADR-0012](../adr/0012-sidebar-file-panel.zh.md)。

关键转向：**主要 upload 场景不是"传大文件"，而是"把截图甩给 AI agent"**。这改变了方案选型：

- §4.1 里倾向的 "Guacamole `guacctl` shell-triggered 下载" 模式**不再是主路径**——它解决的是"浏览器怎么知道要下哪个文件"的问题，而在 AI 陪跑场景里，用户的意图是把东西**发给 shell 里的 agent**，方向相反。
- 新主路径是 **ComposeBar 附件**：仿 Claude Desktop / ChatGPT 的粘贴附件体验，文件自动写到 `./msg-upload/`，并在消息文本后附带相对路径，agent 在 shell 里 `cat msg-upload/...` 即可读到。
- FilePanel 拖拽 + 浏览 + 预览 作为次路径一并做，侧栏多一个 tab。scope 从"纯传输"扩到"浏览 + 预览 + 传"。
- 浏览器内置 viewer 能覆盖 PDF / 视频 / 图片 / HTML，加 `react-markdown` + `shiki` 覆盖 markdown 和代码，**office 明确不做预览**（太重、替代成本低——下载到本地用原生应用打开）。

本调研 §4.1 里的其他 prior art 引用依然成立，只是权重变了（SFTP / trzsz 仍然不用，Guacamole 仅作为下载语义参考）。
