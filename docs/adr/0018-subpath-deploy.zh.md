# 0018. 子路径反代部署(不再限死子域名)

- 状态:**accepted**(2026-04-24)
- Deciders:@ChuangLee
- 关联:ADR-0017(一键安装 + 工作区沙箱)、project_live_deployment(your-host.example 生产环境)
- 范围:运行时 base-path 注入,前端所有 REST/WS 路径改为相对 URL

## 1. 背景

此前 TM-Agent 只能挂在独立子域名下(例如 `https://tmux.host.example/`)。前端写死了绝对路径:

- `fetch("/api/config")`,`fetch("/api/files/...")`,`fetch("/api/fs-picker/...")`,`fetch("/api/shell-history/...")`
- `new WebSocket("wss://host/ws/control" | "/ws/terminal")`
- `buildAuthedMediaUrl("/api/files/download", ...)`

后端也把所有路由挂在 `/`,upgrade handler 硬匹配 `/ws/control` / `/ws/terminal`。结果:反代用 `location /tmux/ { proxy_pass http://127.0.0.1:8767; }` 时,浏览器拿到 HTML 后发起的 `GET /api/config` 根本不会带 `/tmux/` 前缀,nginx 命中另一个 `location /` 或者 404,服务起不来。

**定位影响**:一台 VPS 上常常已有别的服务占着 `/` 或独立子域名。"要装 TM-Agent 就得给它一个专属子域名"这个限制在"智能体时代的控制工具"这个人群里劝退新用户 —— 他们希望跟 Grafana、Vault、内部 admin 面板一样,塞进 `/tmux/` 就行。

## 2. 方案:运行时 base-path + 相对 URL

**核心**:前端所有路径改成相对 `document.baseURI`,后端启动时接 `--base-path`,HTML 服务时动态改写 `<base href="/tmux/">`。一次 build,任意路径部署,无需重新 build 前端。

### 2.1 后端

- `RuntimeConfig.basePath?: string`,规范化为空串或 `/foo[/bar]`(前导斜杠,无尾斜杠)。
- CLI 加 `--base-path` + `TM_AGENT_BASE_PATH` env。
- 所有 REST 路由 `mount(suffix) = basePath + suffix`。
- `express.static` 和 SPA fallback 挂在 basePath 下;前缀外的请求返回 404(让反代去路由别的 app)。
- upgrade handler 匹配 `basePath + /ws/control` / `basePath + /ws/terminal`。
- `index.html` 服务时用 `fs.readFile` + regex 改写 `<base href="...">`(只读一次,缓存)。

### 2.2 前端

- `index.html` 加 `<base href="/">` 占位。
- `vite.config.ts`:`base: command === "build" ? "./" : "/"` —— build 时 asset URL 是 `./assets/xxx.js`,配合动态 `<base href>` 解析到正确前缀;dev 保持 `/` 让 HMR + proxy 正常。
- 新增 `lib/base-url.ts` 暴露 `apiUrl(path)` / `wsUrl(path)`,内部用 `new URL(stripLeadingSlash(path), document.baseURI)`。
- 改写 9 处硬编码调用点:`config-api`、`files-api`(含 `buildAuthedMediaUrl`)、`fs-picker-api`、`shell-history-api`、`control-ws`、`terminal-ws`。

### 2.3 反代

新增 `docs/deployment/nginx.conf.example.subpath`。关键点:`location /tmux/ { proxy_pass http://127.0.0.1:8767; }` —— **proxy_pass 末尾不带斜杠**,这样 nginx 不剥前缀,后端收到的路径和它启动时 `--base-path /tmux` 对齐。

## 3. 不做什么

- 不改成 build-time base(例如 `VITE_BASE_PATH=/tmux npm run build`)。一次 build 多处部署的运维友好度远大于前端资源命中率的微小差异。
- 不实现前缀剥离模式(nginx `proxy_pass http://.../;` 带斜杠)。两条路子给运维增加选择负担,选一条即可。
- 不动 auth、session、workspace-root 语义。这是纯粹的 URL 重写层。

## 4. 取舍 & 风险

- **依赖 `document.baseURI`**:老浏览器理论上支持得早(IE 6+),实际问题不大。
- **`<base href>` 的副作用**:`<a href="#foo">` 会根据 base 解析成 `https://host/tmux/current#foo` 而不是当前 URL + fragment。代码里没有依赖 fragment-only 链接的地方;如果以后有,用 `new URL(..., location.href)` 显式绕开。
- **子域名部署不受影响**:`basePath = ""` 时所有路径塌回原始形态,现有 `docs/deployment/nginx.conf.example` 无需动。
- **SPA 路由**:目前没有 client-side router,index.html fallback 只服务一个页面。未来接 router 时要确保 router 的 `basename` 读 `document.baseURI` 而不是硬编码。

## 5. 验证

- 新增 `server-route.test.ts` 里的 `normalizeBasePath` 全路径 + `isWebSocketPath(path, basePath)` 测试。
- 现有 486 个测试(多数走 `basePath: undefined` → 空串)全绿,证明 root-mount 零回归。
- 生产 your-host.example 继续以 root-mount 运行;子路径部署留给需要的新用户。

## 6. 后续

- 如果运营上真的出现"同一进程同时挂在 root 和子路径"的诉求,再考虑支持多 basePath。目前 YAGNI。
