# 0017. 工作区根目录沙箱 + 安装体验优化

- 状态:**accepted**(2026-04-23)
- Deciders:@ChuangLee
- 关联:ADR-0014(新建 session wizard)、feedback_product_north_star(智能体时代的智能体控制工具,不是极客 webshell)、project_live_deployment(your-host.example 生产环境)
- 范围:ADR-0014 遗留的两个体验缺口 —— picker 可越界浏览 + 手动 5 步安装

## 1. 背景

两个互相独立但都被"产品定位是智能体控制工具,不是极客 webshell"拉到同一层优先级的问题:

### 1.1 目录选择器可越界浏览

ADR-0014 §6 落地的 `fs-picker` 只受 auth 中间件保护,浏览器能跳到 `/` 甚至 `/etc` —— 这对单机单用户场景是"通过认证的用户就是有 shell 权限的用户,本来就能 `cd` 到任何地方"的合理设计,但对下列场景就太宽:

- **共享账户 VPS**:一家多口共用同一个 unix 用户,每人期望只在自己的项目子树里起 session。
- **误操作防护**:手机上手抖点进 `/etc/nginx` 起了一个 session,发现已经 `rm -rf *` 跑过去了。产品"精准控制"的定位要求这类场景的默认答案是"拦住",不是"文档里写清楚"。
- **多租户演示**:给同事或客户看 live 演示时,不希望他们看到完整的文件系统树。

后端 fs-picker router 还有个**已经存在的 bug**:`buildFsPickerRouter` 从未被 `server.ts app.use(...)` —— ADR-0014 本地开发期间通过 Vite proxy 临时路径走通,合入主干后就 404 了。本 ADR 顺便修掉。

### 1.2 5 步部署劝退新用户

`docs/deployment/README.md` 当前流程:

1. `git clone && npm install --omit=dev && npm run build`
2. `openssl rand -hex 16`(token)
3. `openssl rand -base64 12 | tr -d '/+=' | cut -c1-16`(password)
4. `sudo tee /etc/tm-agent/env <<EOF ... EOF` + `chmod 600`
5. `sudo cp docs/deployment/systemd.service.example /etc/systemd/system/tm-agent.service` + `daemon-reload` + `enable --now` + nginx + TLS

每一步都合理,组合起来就是一道劝退墙。"极客 webshell"可以接受这个,"智能体时代的智能体控制工具"不该。

## 2. 决策

### 2.1 `workspaceRoot` 作为 picker 的虚拟根

- 后端 `RuntimeConfig.workspaceRoot: string`(绝对路径,默认 `os.homedir()`)
- CLI `--workspace-root <path>` + env `TM_AGENT_WORKSPACE_ROOT`。`cli.ts` 的 `resolveWorkspaceRoot()` 展开 `~` 然后 `path.resolve`。
- `fs-picker/routes.ts`:
  - `isWithinRoot(candidate, root)` 用 `path.relative(root, candidate)` → 以 `..` 起头或返回绝对路径即判定越界。
  - `/browse` 空 path 返回根目录;任何 path 先跑 `isWithinRoot`,不合规 403。
  - `parent === null` **仅**在 `resolved === workspaceRoot` 时出现 —— picker 的 `↑ 上级` 按钮读这个字段自动禁用。
  - `/mkdir` 的 `parent` 也跑 `isWithinRoot`。
  - 响应字段重命名 `home` → `root`,含义更直白。
- `server.ts` 终于 `app.use("/api/fs-picker", buildFsPickerRouter(...))` 把路由挂上。
- `/api/config` 响应带 `workspaceRoot`;前端 `ServerConfig.workspaceRoot` 变可选。
- `src/frontend/stores/server-config-store.ts`(新)持有 `workspaceRoot`;`App.tsx` mount 时从 `/api/config` 读进来。
- `NewSessionSheet` 的 `DEFAULT_CWD` 改成 `workspaceRoot ?? "~"`(pre-0017 后端向下兼容)。
- `DirectoryPicker`:
  - breadcrumb 以 root 为起点(basename 当 "/"),crumb 不再显示 root 之上的段。
  - `⌂ Home` → `⌂ 根目录 / ⌂ Root`(`picker.root` key)。
  - `↑ 上级` 在 root 处自动 disable(已经借助 `parent === null` 生效)。

**信任边界清晰表态**:这是 **UX 护栏,不是安全边界**。一旦 session 跑起来,shell 本身能 `cd` 去后端用户能到的任何地方 —— 本 ADR 不改变这一点。workspace root 买到的是"防止通过 picker 误入歧途",不是"把 shell 关进笼子"。Security 提问的正确答案仍然是"认证用户 = 后端 unix 用户权限"(参见 `SECURITY.md`)。

### 2.2 `scripts/install.sh` 一键部署

- **幂等**:已有 `/etc/tm-agent/env` 保留 token + password(书签 URL 不失效),只补齐缺失的 `TM_AGENT_WORKSPACE_ROOT`。首次运行才 `openssl rand`。
- **只做系统能确定性做的事**:`npm install --omit=dev` + `npm run build` + env 文件 + systemd unit + `enable --now`。
- **刻意不做** nginx + TLS:每家环境差异过大(acme.sh / certbot / Caddy / Cloudflare Tunnel / 无 TLS 纯内网...),强行一刀切只会更劝退。脚本尾部打印 `nginx.conf.example` 路径指引用户自己配。
- **刻意不做** Docker / Node 引导:我方 README 假设用户已有 Node 20+,再套 Docker 是换一层门槛。
- 交互式确认一次,`--non-interactive` 给 CI / Ansible 自动化用。
- systemd unit 模板里 `User=$SERVICE_USER` + `Environment=HOME=$SERVICE_HOME`,确保 tmux 用对 per-user socket 目录。

### 2.3 CLI 启动 banner 打磨

- TTY 感知 ANSI(bold / dim / 颜色);journald / CI 日志自动退化为纯文本。
- 打印 `Workspace root` 和 URL / Password,再附一行"token 没固定时怎么固定"的提示(引导用户去 install.sh 或 env 文件)。
- **不加 QR 码依赖**。产品定位虽然是 mobile-first,但启动 banner 不是 runtime UX 路径 —— 用户扫一次 URL 进站后,后续交互都在浏览器里。QR 的边际效用 < 新增一个小 utility dep 的维护成本。留作未来可选 ADR。

## 3. 备选方案与权衡

### A. sandbox 做成真的安全边界(chroot / bwrap / 双进程隔离)

- 拒绝。真正的安全边界需要 PTY 也关起来,一旦 session 跑起来还能在沙箱里 `ls /etc` 就会让用户困惑("picker 不让我看,shell 能看?")。产品定位不是 multi-tenant SaaS,是"有 shell 权限的单个用户自用工具"。引入真沙箱等于承诺一份我方没打算履行的安全合同,反而危险。

### B. 用 `path.resolve` 一把 + 字符串前缀比较

- 拒绝。`/foo/bar-x` 会被误判为 `/foo/bar` 的子路径。必须 `path.relative` + `..` 检测。

### C. `install.sh` 把 nginx + TLS 也一并自动化

- v1 拒绝。acme.sh / certbot / Caddy / Traefik / Cloudflare 每家做法都不一样,域名管理方式也不一样。写一个假设 acme.sh 的脚本在 certbot 用户面前会失败,反而制造"脚本跑不通" 的第一印象。文档指路比代码全包更实际。
- 未来若出现明显一家独大的模式(比如 Caddy 内置 ACME),可追加 `install-nginx.sh` 作为独立脚本。

### D. `TM-Agent init` 子命令替代 install.sh

- 拒绝。init 需要 Node 已可运行,但部署机器上可能还没 build。install.sh 是 bash 唯一依赖,天然可在 `npm install` 之前运行。shell 脚本对运维也更透明(一眼看完)。

### E. 安装时用 Docker 而非 systemd

- 不互斥,可作为未来独立 ADR。当前用户池是 VPS + systemd 运维者,Docker 是多一层而非必然更简。

## 4. 实施清单

**后端 + 协议**:

- [x] `src/backend/config.ts`:`RuntimeConfig.workspaceRoot` + `CliArgs.workspaceRoot?`
- [x] `src/backend/cli.ts`:`--workspace-root` yargs 选项 + env 兜底 + `resolveWorkspaceRoot()` + banner 加一行 + TTY 感知 ANSI
- [x] `src/backend/fs-picker/routes.ts`:`workspaceRoot` 必填 + `isWithinRoot` + 响应字段 `home` → `root` + parent=null 条件改成"at root"
- [x] `src/backend/server.ts`:**挂载** `/api/fs-picker` 路由(修 ADR-0014 遗漏)+ `/api/config` 暴露 `workspaceRoot`

**前端**:

- [x] `src/frontend/services/config-api.ts`:`ServerConfig.workspaceRoot?`
- [x] `src/frontend/services/fs-picker-api.ts`:`BrowseResponse.home` → `.root`
- [x] `src/frontend/stores/server-config-store.ts`(新):zustand tiny store,App.tsx mount 时填入
- [x] `src/frontend/features/sessions/DirectoryPicker.tsx`:breadcrumb 在 root 处截断,`⌂ Home` → `⌂ Root`,`↑ 上级` 通过 `parent=null` 自动 disable
- [x] `src/frontend/features/sessions/NewSessionSheet.tsx`:`defaultCwd = workspaceRoot ?? "~"`

**i18n**:

- [x] 7 个 locale bundle 加 `picker.root` + `picker.outsideRoot`

**测试**:

- [x] `tests/backend/fs-picker/routes.test.ts`:root-escape 403 for `/browse` + `/mkdir`,空 path → root,`parent=null at root`
- [x] `tests/integration/server.test.ts`:`buildConfig` 加 `workspaceRoot` + `filesMaxUploadBytes`

**部署 + 文档**:

- [x] `scripts/install.sh`:新脚本,幂等,交互 + `--non-interactive`
- [x] `docs/deployment/env.example`:`TM_AGENT_WORKSPACE_ROOT` 注释
- [x] `docs/deployment/README.md`:Fast path 段落放最前
- [x] `README.md`:Deployment 段改成一键脚本优先
- [x] 此 ADR

## 5. 不做(v1 范围外)

- **Per-user workspace root**:单 backend 多 unix 用户 / auth 身份绑定不同根目录。产品当前是单用户自用工具,不走这条。
- **nginx + TLS 自动化**:理由见 §3.C。
- **Docker / docker-compose 发行**:理由见 §3.E。
- **QR 码 banner**:理由见 §2.3。
- **Picker 内打开的文件管理操作(删除 / 移动)**:picker 严守"选目录"的最小职责,避免在建 session 场景下暴露破坏性动作。
- **Shell 真的关进 workspace root**:理由见 §3.A。
