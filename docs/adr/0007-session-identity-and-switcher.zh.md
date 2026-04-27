# 0007. 会话身份协议与 TopBar 切换器

- 状态:accepted
- 日期:2026-04-21
- 决策者:@ChuangLee
- 英文伴生:[`0007-session-identity-and-switcher.md`](./0007-session-identity-and-switcher.md)(中文为权威)。

## 背景

控制信道的 `attached` 消息只携带了"grouped 客户端会话名"(`tm-agent-client-<clientId>`)。前端用启发式反推真实 base session——"扫 snapshot,挑第一个非托管的"——这在服务端存在多个 base session 时会失效:TopBar 顶部的 session 名会锁死在 tmux 第一个枚举出来的那个,`SessionList` 的 `aria-current` 高亮也不可靠。

表现:每次通过 `https://your-host.example/?token=...` 进入,TopBar 永远显示 `mtmux`,点侧边栏切到 `work` 也不变。切换 session 后顶部文字不更新,等于前端根本不知道用户选了谁。

同时还有一个次要问题:多 session 时后端发 `session_picker`,前端 `use-control-session.ts` 无脑 `sessions[0]` 自动 attach——因此一上来永远是 `mtmux`。

## 决策

### 1. 协议扩展

`attached` 消息新增 `baseSession: string` 字段。后端在 `attachControlToBaseSession`(`src/backend/server.ts`)同时持有两个名字,顺手传出来即可。旧的 `session` 字段保留(托管 grouped 会话名,传输层仍需要)。

```ts
| { type: "attached"; session: string; baseSession: string }
```

### 2. Store 直接存 base session

`sessions-store` 加一个 `attachedBaseSession` 字段。

- `setAttachedSession` 改为同时写入 `session`(托管名)+ `baseSession`(真实 base 名)。
- `selectBaseSession` 启发式函数删除,调用方(TopBar、SessionList)从 snapshot 里按 `attachedBaseSession` 精确查表即可。

### 3. TopBar 版式重构

原版:状态灯左侧独占一列 12px;中间一个大按钮显示 session 名(mobile 可点);右侧 Direct Mode。

问题:session 名被放在 "产品名 logo" 的视觉位置,读者会把它当成"这个网站叫 mtmux"。

新版:

- **左侧成组**:状态灯 + session 名 + 可选 chevron 合并为同一个按钮,整体左对齐。状态灯在前表示"连接态",紧跟 session 名表示"当前 session"。
- **切换 affordance**:`⌄`(Heroicons chevron-down)只在 `baseSessionsCount >= 2` 时出现。单 session 时不显示,避免虚假指示。
- **交互**:移动端点击 → 调用 `onRequestSessionDrawer`;桌面端按钮为 pointer-inert(常驻 sidebar 已经列出来了,再给点击反馈反而困惑)。
- **中间**:留给 window 数等次要元信息,或者干脆留白。
- **右侧**:保持 Direct Mode / Reconnect 按钮。

### 4. 上次选择的 session 记忆

在 `session_picker` 路径上,客户端优先读 `localStorage['tm-agent:lastSession']`:

```ts
const remembered = localStorage.getItem("tm-agent:lastSession");
const pick =
  (remembered && msg.sessions.find((s) => s.name === remembered)?.name) ?? msg.sessions[0]?.name;
```

在每次成功收到 `attached` 时写入 `baseSession` 到该 key。

## 影响

- TopBar 切换 session 即时更新——这是正确性修复。
- SessionList 的 `aria-current` 高亮也随之修正,因为它从同一个 `attachedBaseSession` 读。
- 删除一个启发式。`selectBaseSession` 整个函数消失。
- localStorage 记忆是 per-browser-profile 的。手机 + 电脑共用 token 的用户可能看到"两端默认 session 不同"——比"两端都默认 mtmux"强。
- 协议兼容性:新字段可选加(Zod additive),但后端前端需要一起部署(旧后端发不出新字段,旧前端会退回 `sessions[0]`)。我们单机部署,没有客户端版本偏差问题。

## 非目标

- 不改 tmux grouped session 的创建方式,传输层原样保留。
- 不做跨设备 session 记忆。那需要服务端持久化,v1 不做。
- 不改 `session_picker` 在单 session 时的行为(单 session 时后端根本不发 picker,直接 attach,TopBar 的 chevron 也就不出现——这是一致的)。

## 实施顺序

1. `src/shared/protocol.ts`:在 `attached` message schema 加 `baseSession`。
2. `src/backend/server.ts`:`attachControlToBaseSession` 发 `{ session, baseSession }`。
3. `src/frontend/stores/sessions-store.ts`:加 `attachedBaseSession`,删 `selectBaseSession`。
4. `src/frontend/hooks/use-control-session.ts`:处理新字段 + 写 localStorage + `session_picker` 读 localStorage。
5. `src/frontend/features/shell/TopBar.tsx`:重构成 dot+name+chevron 左对齐。
6. `src/frontend/features/sessions/SessionList.tsx`:精确比对 `attachedBaseSession`。
7. 跑 `npm run typecheck && npm test`,修挂掉的测试。
8. 重新构建 + `sudo -n systemctl restart tm-agent.service` 线上验证。
