# 0014. 新建 Session Wizard:工作路径 + 启动命令 + 用户命令库

- 状态:**accepted**(2026-04-23)
- Deciders:@ChuangLee
- 关联:ADR-0013(slot / sheet-store)、feedback_product_north_star(智能体时代的智能体控制工具)、feedback_compose_send_keys_pattern(paste-buffer 发送模式)
- 范围:Phase 3+ 体验打磨 —— 新建 session 交互

## 1. 背景

当前新建 session 复用 `RenameSheet`,只有一个"session 名"输入框。后端 `TmuxGateway.createSession(name)` 只跑 `tmux new-session -d -s NAME`——既不能指定工作目录,也不能预置启动命令。

这条路径对**智能体控制工具**定位来说是硬缺口:

- 新建 session 的最高频目的是"在某个项目目录跑某个 agent CLI"——而当前每次都是 `cd /path/to/project && claude` 两步。
- 手机端打这条命令痛苦:路径长 + flag 难记 + 复制粘贴跨 app。
- 多个常用 agent(claude / codex / gemini / hermes / 自研)的启动命令都需要记忆。

用户的心智模型是"我要起一个**去做什么的** session",不是"我要起一个 tmux session"。产品定位要求把这层心智模型变成一等公民。

## 2. 决策

引入独立组件 **`NewSessionSheet`**,取代复用 RenameSheet 的临时路径。表单三段式:

1. **Session 名**(必填)——沿用现有文本输入。
2. **工作目录**(可选,默认 `~`)——文本输入 + 最近使用下拉(localStorage,最多 5 条,去重)。
3. **启动命令**(可选)——两级选择:
   - **命令**:`(无 / 仅打开 shell)` / `claude` / `codex` / `gemini` / `hermes` / 用户命令库条目 / `+ 自定义…`
   - **参数 chips**:按所选命令联动显示常用 flag,用户点击 toggle。首批预设:
     - `claude`: `--continue`、`--resume`
     - `codex`: (无预设,v1 留空)
     - `gemini`: (无预设,v1 留空)
     - `hermes`: (无预设,v1 留空)
   - **"加入我的命令库"**:自定义命令可一键保存,出现在命令下拉顶部。

勾选命令后,点击"创建"会:

1. WS 发送 `new_session { name, cwd?, startupCommand? }`(`cwd` 为空或默认 `~` 时按空处理;`startupCommand` 为拼好的整行)。
2. 后端 `createSession` 解析 `~` 为 `os.homedir()`,跑 `tmux new-session -d -s NAME [-c CWD]`。
3. 若有 `startupCommand`,**复用 `sendKeys` 的 paste-buffer 发送模式**(`set-buffer` + `paste-buffer -dpr` + 120ms sleep + `send-keys Enter`)把整行投喂给新 session 的 shell。**不走** `tmux new-session ... SHELL_COMMAND` 原生启动参数——原生参数把命令当作 session 的"主进程",命令退出会把 session 一起干掉,违反 agent 重启/崩溃后用户预期"shell 还在,我再起一次"。
4. 现有的 `attachControlToBaseSession` 流程不变。

存储:

- 最近使用路径:`localStorage["tm-agent.new-session.recent-cwds"]`,JSON 数组,上限 5。
- 用户命令库:`localStorage["tm-agent.new-session.custom-commands"]`,JSON 数组,每条 `{ id, label, command }`。
- 上次表单值:`localStorage["tm-agent.new-session.last"]`,用于下次打开预填(不含 session 名)。

## 3. 备选方案与权衡

### A. 继续复用 RenameSheet,只在其中加字段

- 拒绝。RenameSheet 是严格单字段组件,rename 路径只需要名字。硬塞字段会让两条路径(rename / new)共用同一个复杂组件,后续改任一方都要考虑另一方。

### B. 命令库存后端(JSON 文件或 tmux options)

- v1 拒绝。后端存储要考虑多用户、权限、持久化路径;localStorage 在"单用户单浏览器"场景下够用,换设备不同步是可接受代价。
- 未来若出现"多端同步"需求再升级到后端 JSON,ADR-0014.1 追加。

### C. 命令选择器写成"可配置文件 catalog"(类似 ADR-0009 的 slash catalog)

- v1 拒绝。首批 4 个 agent 预设 + 每个命令 1~3 个 flag 的数据量非常小,直接当前端常量即可。做成独立 catalog 文件会引入构建/加载复杂度而没有明显收益。
- 用户添加的条目走 localStorage,不进 catalog。

### D. `tmux new-session -d -s NAME CMD` 原生启动参数

- 拒绝(见 §2.3)。命令进程 = session 主进程时,`claude` 崩溃/退出会把整个 session 干掉,用户需要重建。paste-buffer 路径下 `claude` 只是 shell 的子进程,退出后 shell 还在,用户可以 `claude` 再起。

## 4. 实施清单

- [ ] `src/shared/protocol.ts`:`new_session` 消息加 `cwd?: string`、`startupCommand?: string`。
- [ ] `src/backend/tmux/types.ts`:`createSession(name, options?: { cwd?: string })` 签名升级。
- [ ] `src/backend/tmux/cli-executor.ts`:实现 `-c` 支持 + `~` 展开(用 `os.homedir()`)。
- [ ] `src/backend/server.ts`:`new_session` 分支读 `cwd` / `startupCommand`,成功创建后若有 `startupCommand` 调 `sendKeys(NAME, startupCommand)` 注入。
- [ ] `tests/harness/fakeTmux.ts`:`createSession` 签名同步,调用记录带上 `cwd`。
- [ ] `src/frontend/stores/new-session-store.ts`(新):localStorage-backed 最近路径 + 命令库 + 上次表单。
- [ ] `src/frontend/features/sessions/NewSessionSheet.tsx`(新):表单 UI。
- [ ] `src/frontend/features/sessions/SheetHost.tsx`:把 `new-session` 分支从 RenameSheet 切到 NewSessionSheet。
- [ ] 单元测试:`new-session-store` 的最近路径裁剪 + 命令库去重。
- [ ] Playwright 冒烟:选命令+勾 flag 创建 session,断言 `new_session` payload 正确。
- [ ] 部署 your-host.example 真机自测。

## 5. 不做(v1 范围外)

- 带值参数(如 `--model <model>`)——v1 只支持 boolean flag。
- 每个 agent 的"常用项目路径"绑定——v1 全局一份最近路径。
- session 启动后自动展开某个面板/视图的联动——v1 保持"创建+attach"原语。
- 目录浏览器里列出/选择文件——picker 专注目录,文件列出来会成为噪声(删除功能也不做,避免在"建 session"场景下暴露破坏性动作)。

## 6. 追加(2026-04-23):目录浏览器

用户要求在 "工作目录" 字段旁边加一个**可浏览任意目录 + 新建文件夹**的选择器,mirror 左侧 FilePanel 的视觉语言(breadcrumb / 上级 / 隐藏显示)但不共享后端接口——现有 `/api/files/*` 沙箱在 pane cwd 下,不能在建 session **前**用。

新增:

- `src/backend/fs-picker/routes.ts`:两个端点。
  - `GET /api/fs-picker/browse?path=...`:列**任意目录**下的**子目录**(不含文件),服务端展开 `~`,返回 `{ path, parent, home, entries: [{ name, isHidden, isSymlink }] }`。
  - `POST /api/fs-picker/mkdir { path, name }`:在 `path` 下创建文件夹;名字通过简单白名单(禁 `/ \ \0 .. .`)。
- 安全模型:auth 中间件保护,**不做路径沙箱**。理由:这个工具的信任边界是 "通过 token+password 认证的用户 = 能在 VPS 上起 shell 的用户";他本来就能 `cd` 任何地方。再加一层沙箱反而会让"在 /etc/nginx/ 下建 session 看日志"这类正当场景失效。
- `src/frontend/services/fs-picker-api.ts`:API client。
- `src/frontend/features/sessions/DirectoryPicker.tsx`:breadcrumb、↑ 上级、⌂ Home、👁 显示/隐藏 dotfiles、＋ 新建文件夹 (inline 表单)、"使用此目录" / "取消"。只列目录。删除**不做**(与用户明确要求一致)。
- NewSessionSheet 新增 `view: "form" | "picker"` 状态,**内部视图切换**而非嵌套 BottomSheet——手机上堆叠 sheet 的 focus / 键盘 UX 很差。"📁 浏览" 按钮在 cwd 输入框右侧。
