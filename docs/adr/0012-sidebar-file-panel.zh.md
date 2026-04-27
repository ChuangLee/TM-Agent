# 0012. 侧栏文件面板(当前 pane cwd 下的浏览 / 预览 / 上传 / 下载)

- 状态:accepted
- 日期:2026-04-22
- 决策者:@ChuangLee
- 相关:[research/0008](../research/0008-web-shell-file-transfer-and-sysinfo.md)、ADR-0010(侧栏两尺寸)、ADR-0011(SysinfoPanel 挂法)、ROADMAP Post-v1 #10(Guacamole 式文件传输)、DESIGN_PRINCIPLES §4(tmux state 是一级导航)、SECURITY.md(auth + 路径遍历)。

## 背景

Research/0008 把文件传输挂在 Post-v1 #10,默认方案是 "Guacamole 的 shell-triggered 下载 + 拖拽上传"。2026-04-22 改变主意,把它提前到当前阶段,原因:

1. **陪 agent 跑长作业的典型场景是"看一眼刚产出的东西"**——Claude Code 生成了一个 SVG、aider 改了一批文件、npm build 出了一份报告——都需要「打开看看 + 偶尔下载 + 偶尔把本地文件甩回去」。目前流程是 `scp` 往返,上下文切换代价远高于这个能力本身的复杂度。
2. **浏览器内置能力覆盖了绝大多数 MIME**。图片、PDF、视频、音频、HTML 浏览器自己会渲染——我们不需要 pdf.js / pdfjs-dist,不需要 video.js;把 `<img>` / `<iframe>` / `<video>` 喂到合适的 URL 就行。纯文本 + 代码 + markdown 三类需要前端库,但体量都在 KB 级(`react-markdown`、`shiki` 按需加载)。**office 文档**(docx/xlsx/pptx)浏览器无内置能力,相关库(mammoth / sheetjs)都是 MB 级——本 ADR **不做 office 预览**,只允许下载。
3. **和 Post-v1 #10 合并**。原 #10 的范围是"上传下载",本 ADR 直接包含浏览 + 预览 + 上传 + 下载四件套,#10 因此关闭。
4. **侧栏有现成的位置**。ADR-0010 后 sidebar expanded 是 272px 宽、ADR-0011 后底部 72px 挂 SysinfoPanel,中间一段 flex 区现在只放 SessionList——用户 session 通常只有 2–5 个,浪费纵向空间。把 session 压到上方 tab,把文件树放在主视区,是自然选择。

## 决策

在桌面侧栏**展开态**的 `Sidebar` 中新增 `FilePanel`,采用 **tab 切换**在 `SessionList` 与 `FilePanel` 之间切换;`SysinfoPanel` 作为底部常驻条不变。

```
┌─ Sidebar (expanded, 272px) ────────┐
│ SidebarHeader: ● session + ⟨⟨      │  48px
├─ Tabs: [Sessions] [Files]          │  36px
│                                    │
│  <SessionList> 或 <FilePanel>      │  flex
│                                    │
├─ SysinfoPanel                      │  72px
└────────────────────────────────────┘
```

- 移动端**不上** `FilePanel`;`SessionDrawer` 保持纯 session 视图。文件浏览在手机上是低频二级需求,等 follow-up ADR 评估是否做成独立 sheet。
- 折叠态(SessionRail)不显示 `FilePanel` 入口,用户必须展开 Sidebar 才能访问——简化 rail 语义,与 ADR-0011 系统状态条的 rail 降级策略一致。

### 1. FilePanel 结构

```
FilePanel
├── 路径面包屑(root 基准)
├── FileTree(react-arborist 或手写虚拟列表)
│   ├── 目录节点:点击展开/折叠子目录
│   ├── 文件节点:单击打开 Viewer
│   └── 右键/长按:下载 / 删除 (v1 不做删除)
├── 工具条:⟲ 刷新  ⬆ 上传  📁 新建目录(v1 不做)
└── 拖拽上传区:整个面板作为 drop target(react-dropzone)
```

- **Root = 当前 attached pane 的 `pane_current_path`**(下文 §2 详述)。面包屑始终以 root 为起点,绝对路径不暴露。
- **虚拟列表**:`@tanstack/react-virtual`(已在依赖里)——大目录(node_modules 级 1 万文件)不卡。
- **排序**:目录在前,同类按名字 `localeCompare`。v1 不提供自定义排序。
- **刷新**:手动按钮 + 当 `pane_current_path` 变化时自动 rehome 到新 root。

### 2. Root 语义:跟随 active pane 的 `pane_current_path`

- 后端 tmux 快照 format 新增 `#{pane_current_path}`,`TmuxPaneState` 加 `currentPath: string` 字段。
- 前端 `FilePanel` 订阅 `useSessionsStore` 的 **active pane** 的 `currentPath`:
  - 切 session / 切 window / 切 pane → root 变 → 面板 rehome 到新 root,面包屑复位。
  - 用户在 pane 里 `cd somewhere` → 下一个 2s 快照拿到新 path → 面板 rehome。有 ≤2s 延迟,可接受。
- **根不跟随会破坏访问约束**——如果用户已经打开 `/old/cwd/sub` 的视图,pane cwd 变到 `/new/cwd`,后端每次请求都用当前 pane cwd 作为 root 校验,旧 view 的后续请求会 403。前端检测到 root 变化时主动 rehome,避免连续 403。

### 3. 安全边界(非协商)

- **根只能是当前 pane 的 cwd 及子目录**。每个 HTTP 请求(list/read/upload/download)携带 `paneId` + `relPath`;后端:
  1. 用 tmux 查 `paneId` 当前 `pane_current_path` → 绝对 root。
  2. `path.resolve(root, relPath)` → 候选 abs。
  3. `fs.realpath(candidate)` → 解析后的真实路径。
  4. `fs.realpath(root)` → 真实 root。
  5. 断言 `realCandidate === realRoot || realCandidate.startsWith(realRoot + path.sep)`。否则 403。
- **Symlink 逃逸**由上面 `realpath` 吃掉——指向 root 外的软链接被拒。**拒绝原则**:宁可误杀指向 root 内部的循环软链,也不放出去。
- **路径遍历**(`../../../etc/passwd`)被第 2–5 步的规范化 + 前缀断言兜住。
- **Auth**:所有 `/api/files/*` 端点复用现有 token(header)+ password(query 或 header)的双重鉴权,**和 control WS 同源**。未鉴权请求一律 401。
- **大小上限**:
  - 上传:单文件 ≤ 100 MB(可通过 `TM_AGENT_FILES_MAX_UPLOAD_MB` 覆盖)。
  - 预览文本/代码:≤ 5 MB——超过就只给"下载"按钮,不渲染。
  - 下载:无软上限,流式响应。
- **隐藏文件**:默认展示(`.env` / `.git/` 也会列出)。这是 web shell,用户已经有 root 权限,隐藏反而是错觉安全。未来可在 UI 加过滤开关。
- **危险 MIME**:`.html` / `.svg` 预览必须放在 `sandbox` `<iframe>` 里(no script, no same-origin)——防止用户自己服务器里的恶意 HTML 拿到同源权限。

### 4. 后端 HTTP 端点

新 `src/backend/files/` 目录,导出 Express router,挂 `/api/files/*`。

| 方法 | 路径                                   | 职责                                                                              |
| ---- | -------------------------------------- | --------------------------------------------------------------------------------- |
| GET  | `/api/files/list?paneId=X&rel=...`     | 返回目录项数组:`{ name, kind, size, mtime, isSymlink }[]`                         |
| GET  | `/api/files/raw?paneId=X&rel=...`      | 原始字节流,`Content-Type` 用 `mime-types` 嗅探,支持 Range(PDF / video 走原生播放) |
| GET  | `/api/files/meta?paneId=X&rel=...`     | 单文件元信息(size / mtime / mime)——Viewer 决策前先 peek                           |
| POST | `/api/files/upload?paneId=X&rel=...`   | 多文件 multipart;成功返回写入的绝对 rel 列表                                      |
| GET  | `/api/files/download?paneId=X&rel=...` | 同 `raw` 但强制 `Content-Disposition: attachment`                                 |

- **不实现 rename / delete / mkdir**。这些是「文件管理」范畴,超出"看 + 取 + 传"的 v1 scope。用户可以直接在 shell 里 `mv` / `rm` / `mkdir`——web shell 本就有终端。
- **POST 写入冲突**:目标已存在时默认 `409`,前端弹确认后带 `?overwrite=1` 重发。
- **路径在 URL 里**:`rel` 走 URL-encoded query。不用 JSON body 的 GET-hack,也不走 path segment(避免和 Express 路由解析打架)。

### 5. Viewer 选型

Viewer 按 MIME 分流,所有 viewer 走 **React.lazy** 动态导入——FilePanel 本体保持轻量,用户不点文件就不下载 viewer 依赖。

| MIME 分类          | 方案                                              | 依赖                                          | 加载时机 |
| ------------------ | ------------------------------------------------- | --------------------------------------------- | -------- |
| `image/*`          | `<img>`(SVG 进 sandboxed iframe)                  | 零                                            | 立即     |
| `video/*`          | `<video controls>` + Range 请求                   | 零                                            | 立即     |
| `audio/*`          | `<audio controls>`                                | 零                                            | 立即     |
| `application/pdf`  | `<iframe src>`,浏览器原生 viewer                  | 零                                            | 立即     |
| `text/markdown`    | `react-markdown` + `remark-gfm`                   | `react-markdown`(~40kB)、`remark-gfm`(~10kB)  | lazy     |
| `text/html`        | `<iframe sandbox>`(无 script 无 same-origin)      | 零                                            | 立即     |
| `text/*` + 代码    | `shiki`(按需加载 grammar + theme)                 | `shiki` core ~200kB gzipped,grammar on-demand | lazy     |
| `application/json` | 先尝试 `JSON.parse` + 格式化;失败回落 text viewer | 零                                            | 立即     |
| office / 其他未知  | **无 viewer**,只给「下载」按钮 + 文件信息卡       | 零                                            | —        |

- **office 明确不做预览**:docx 需 mammoth(~300kB)且公式/图形缺失严重,xlsx 需 sheetjs(~800kB)且只能做 grid-view,pptx 基本没有像样的开源 web viewer。为这三个 MIME 塞 1.5MB 代码换一个残缺体验,不划算。用户双击 → 浏览器下载 → 本机用原生应用打开,是合理路径。
- **Shiki 语言覆盖**:v1 白名单 30 种常见语言(ts/js/jsx/tsx/go/py/rust/json/yaml/md/sh/...)。未识别语言回落纯文本 + mono 字体。
- **终端 ANSI**:文件内容里有 ANSI 转义(比如 `output.log`)时,v1 不做高亮,按纯文本展示。Follow-up 可以复用现有 `src/frontend/lib/ansi/` 做染色。

### 6. 上传:两条路径,**ComposeBar 附件是主路径**

陪 AI 跑的时候"上传"的本质几乎都是**把截图/日志/片段甩给 agent**——不是文件管理。本 ADR 以 ComposeBar 附件为主路径,FilePanel 拖拽为次路径。后端 `/api/files/upload` 端点两者共用。

#### 6.1 主路径 —— ComposeBar 附件(为 AI 助手场景优化)

UI 仿现代 AI 助手(Claude Desktop / ChatGPT / Cursor)的输入框附件区:

```
┌─ ComposeBar ────────────────────────────────────┐
│ [📎] ┌─ attachments row (only when non-empty) ─┐│
│      │ [🖼 screenshot.png ×] [📄 log.txt ×]     ││
│      └──────────────────────────────────────────┘│
│      ┌─ textarea ───────────────────────────────┐│
│      │ 帮我看一下这张图里的报错                  ││
│      └──────────────────────────────────────────┘│
│                                          [Send →] │
└──────────────────────────────────────────────────┘
```

**触发方式(都要支持)**:

1. **剪贴板粘贴(killer feature)**:textarea `paste` 事件 → `clipboardData.items` 里的 `kind === "file"` → 自动附加。截图粘贴是最高频场景。
2. **📎 按钮**:隐藏 `<input type="file" multiple>`——移动端浏览器会自动给出 "拍照 / 相册 / 文件" 的系统选单。
3. **拖拽到 ComposeBar**:桌面用户把文件从 Finder/Explorer 拖进来。
4. **(可选)截屏快捷键**:桌面 `Ctrl/⌘+Shift+V` 直接触发 `navigator.clipboard.read()` 拿图——v1 不做,依赖系统截屏 → 粘贴就够了。

**落地目录与文件名**:

- **目录**:当前 attached pane 的 `pane_current_path` 下的 `msg-upload/` 子目录。
- **目录按需创建**:第一次上传时后端 `mkdir -p`。
- **文件名**:`<ISO-timestamp-去冒号>-<sanitized-orig-name>`,示例 `2026-04-22T14-35-01-screenshot.png`。
  - Sanitize 规则:非 `[A-Za-z0-9._-]` 字符替换为 `_`,避免 shell/路径特殊字符。
  - 粘贴来的截图没有原始文件名 → 用 `pasted-image.png` 或从 MIME 推断扩展名。
- **不做时间分桶**(`msg-upload/2026-04-22/...`):扁平结构简单,时间戳前缀天然排序;若积累到碍眼再开 follow-up ADR。

**上传时机**:

- **附件时立刻上传**,不是发送时。用户粘贴/拖拽后立即启动 POST,在附件 chip 上显示进度环。
- 发送按钮在所有附件 upload done 之前**禁用**——避免"先发了消息,文件后到,agent 看不见"。
- 用户在上传中点 ×,取消 `XMLHttpRequest` + 后端收尾(若已写入,rm 之)。

**发送时的消息改写**(前端完成,后端 `send_compose` 不感知):

- 0 附件:不改写,按现有 send 路径走。
- 1+ 附件:在用户文本后追加:

```
{用户原文}

本消息对应的文件路径为:
  msg-upload/2026-04-22T14-35-01-screenshot.png
  msg-upload/2026-04-22T14-36-12-log.txt
```

- 格式上:单个附件仍然用列表格式(保持一致,agent 解析更稳定);空行分隔保证 markdown-friendly。
- **路径是相对于当前 pane cwd 的**——agent 跑在同一个 cwd 里,`cat msg-upload/...png` 直接可用。
- **模板本地化**:附件前缀由 i18n 的 `compose.attachmentPrefix` 提供,跟随用户界面语言。

**错误态**:

- 上传失败 → chip 变红 + 重试按钮。用户可以点 × 删掉失败的继续发。
- 文件超 100MB → 附加时就拒,不启动 POST,toast 提示限额。

#### 6.2 次路径 —— FilePanel 拖拽上传(显式文件管理)

- **Drop zone = FilePanel 整个容器**。当 drag event 进入 FilePanel,显示半透明遮罩 + "释放以上传到 `<当前浏览目录>`"。
- 上传位置是用户当前在 FilePanel 面包屑所处的目录,**不是** pane cwd 根,也**不**自动写到 `msg-upload/`。
- **不改写任何消息**——这条路径是纯文件管理,与 compose 无关。
- **并发**:多文件一次性 POST;后端串行写。
- **进度条**:每个文件一条,走 `XMLHttpRequest.upload.onprogress`(fetch 的 upload 进度 API 仍未普及,XHR 更稳)。
- **冲突**:第一个冲突弹一次对话框让用户选「全部覆盖 / 全部跳过 / 逐个问」——别每个文件都弹。

#### 6.3 共享的后端契约

两条路径都命中 `POST /api/files/upload?paneId=X&rel=<dir>`——唯一差别是 `rel` 的取值:

- 主路径:`rel=msg-upload`(目录),文件名由后端根据请求中每个 part 的 `filename` header 决定,带时间戳前缀。
- 次路径:`rel=<用户浏览到的目录>`,文件名保留原名(冲突走 6.2 的对话框流程)。

后端不关心"这次上传是给 AI 看的还是给人看的"——安全约束(§3)一视同仁。

### 7. 非目标(本 ADR 明确不做)

- **文件管理动作**(rename / delete / mkdir / chmod / chown)。用户有 shell,不需要重造。
- **跨 pane 访问**。每个面板只看当前 attached pane 的 cwd。要看别的 pane,先切过去。
- **远程 SSH 透传**。如果 pane 里跑的是 `ssh`,`pane_current_path` 是**本地**的 cwd,不是远端。本地 fs 视图没错;但用户可能会直觉以为在看远端——面包屑显示的是本地 abs path 的提示能缓解误解,真要透远端是另一个 ADR 的事。
- **office 文档预览**。见 §5。
- **搜索 / grep**。v1 不做。用户有 shell,`grep -r` 去。
- **Git 状态标记**(modified/untracked)。高价值但另立 ADR。
- **collapse 态下显示文件入口**。rail 只保留 session 切换。
- **`msg-upload/` 的自动清理 / 归档**。v1 永远不删;用户若觉得碍眼自己 `rm -rf`。Follow-up 可加 TTL 或 ".gitignore 提示"。
- **附件本地预览编辑器**。附件 chip 点一下只放大预览(图片),不允许"裁剪 / 画框 / 标注"。

### 8. 协议扩展

`src/shared/protocol.ts`:

```ts
// TmuxPaneState 加字段
export interface TmuxPaneState {
  // ...existing
  currentPath: string; // 空字符串表示 tmux 未能解析(极少见,如 pane 刚 dead)
}
```

文件 API 不走 WebSocket——走标准 HTTP,保持 control WS 的"控制信令"语义。

### 9. 实现约束

- **后端**:零额外重量依赖。路径规范化用 Node `path` + `fs`;MIME 嗅探用已有的 `mime-types`(或补 `mime` ~20kB)。Upload 多部件用 `busboy`(纯流式,比 multer 轻)。
- **前端**:tree 先手写 + `@tanstack/react-virtual`;复杂度涨了再考虑 `react-arborist`。Markdown/code viewer 走 `React.lazy`——首屏 bundle 不能因此涨超过 5kB。
- **e2e**:Playwright 覆盖「列表加载 → 点图片看预览 → 拖一个 txt 上传 → 下载它」的 golden path;加一条「`rel=../../etc` 被 403」的安全回归。

## 代价

- 协议一个新字段 + 5 个新 HTTP 端点 + 后端一个新模块 (~400 行)。
- 前端 Sidebar 多一个 tab、多一个 FilePanel feature (~800 行,含 tree + viewer lazy loaders)。
- 首屏 bundle 涨 **估计** < 15kB(tree + panel,viewer 全 lazy);预览 markdown 时再拉 ~50kB,预览代码时再拉 ~250kB(shiki + 首个 grammar)。
- 后端新攻击面:路径遍历、symlink 逃逸、上传写满磁盘。§3 的约束必须在 review 时逐条过。

## 撤销条件

1. 如果 `pane_current_path` 在 ssh / docker exec / nested tmux 场景下**基本没用**(root 永远解析成 `/home/user` 之类的"外壳 cwd"),降级成「用户手动输入 root path + 后端校验它是任意当前 pane cwd 的子目录」——这是小改,不撤 ADR。
2. 如果 shiki lazy chunk 在慢网下体验差(点了文件要等 2 秒才渲染),换 `highlight.js` (~30kB) + CSS themes——仍留在本 ADR 范围。
3. 如果审计发现 §3 的 `realpath` 前缀检查有遗漏(比如大小写不敏感 fs、NFC/NFD 规范化、Windows 路径分隔符)——打补丁,不撤 ADR。
4. 如果出现需要 **rename / delete / git 集成** 的压倒性需求——新开 ADR 扩 scope,不在本 ADR 内扩。

## 实施清单(落到 docs/plans/0012-\*)

分两个独立 track,可并行推进。Track A(ComposeBar 附件)**独立发布价值**,不依赖 FilePanel。Track B 是浏览 + 预览 + 显式文件管理。

### Track A — ComposeBar 附件(为 AI 场景的主路径)

**PR1 — 协议 + 后端基础**

- `TmuxPaneState.currentPath` + tmux format 字段 + parser。
- `src/backend/files/path-guard.ts` + 单测(覆盖 `..`、symlink 逃逸、大小写、trailing slash、`""`、`/abs/path`)。
- Auth 中间件复用 control WS 的双重鉴权。

**PR2 — 上传端点 + msg-upload 语义**

- `POST /api/files/upload?paneId=X&rel=<dir>`,支持目录按需 mkdir-p。
- `busboy` 流式 multipart;`TM_AGENT_FILES_MAX_UPLOAD_MB` 限额。
- 文件名冲突策略:主路径文件名由后端加时间戳前缀保证唯一,`?overwrite=1` 开关给次路径用。
- 集成测试覆盖:正常写入、`rel=../` 被 403、symlink 逃逸被 403、超限被 413。

**PR3 — ComposeBar 附件 UI + 发送改写**

- `useComposeAttachments` 状态(per-session,跟随现有 draft stash 同生命周期)。
- textarea `paste` / drop / 📎 按钮三种触发。
- 附件 chip 条:缩略图 + 文件名 + 进度环 + × 取消。
- 发送时消息改写(§6.1 格式);前缀读取当前 i18n 语言资源。
- 单测:改写模板、多附件、0 附件不改写。
- Playwright e2e:粘贴图 → 上传完成 → 点 Send → tmux pane 收到带路径的消息。

### Track B — FilePanel + 预览 + 显式上传/下载

**PR4 — FilePanel + tab 切换(浏览)**

- Sidebar 内部 tab;`useUiStore.sidebarTab: "sessions" | "files"` + localStorage 持久化。
- `GET /api/files/list` + `/api/files/meta` 端点。
- `FilePanel`:面包屑 + 虚拟列表(`@tanstack/react-virtual`) + 刷新按钮 + 空/错误态。
- `pane_current_path` 变化时自动 rehome。
- 单击文件打开占位 Viewer(v1 提示 "Viewer 待 PR5")。

**PR5 — Viewer 分发 + 零依赖 viewer**

- `GET /api/files/raw` + Range 支持。
- Viewer 打开在 Surface 区域的 overlay(理由见原 §PR4 注)。
- 图片 / PDF / 视频 / 音频 / sandboxed HTML / 纯文本 / JSON 全零依赖。

**PR6 — Markdown + 代码 viewer(lazy)**

- `react-markdown` + `remark-gfm`,`React.lazy` 打独立 chunk。
- `shiki` core + 30 语言 grammar lazy 加载,theme 跟随 `useUiStore.theme`。
- 代码 viewer fallback:未识别语言走纯文本 + mono。

**PR7 — 下载 + FilePanel 拖拽上传**

- `GET /api/files/download`(强制 attachment)。
- FilePanel drop zone + XHR 进度 + 冲突对话框。
- Playwright e2e:拖 txt 上传 → 列表出现 → 下载回来字节一致;`rel=../../etc/passwd` 被 403。
