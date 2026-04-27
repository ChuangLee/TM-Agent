# 0010. 统一 session 切换器 + 可折叠侧栏

- 状态:accepted
- 日期:2026-04-22
- 决策者:@ChuangLee
- 相关:ARCHITECTURE §11 Q4(桌面侧栏是否可折叠)、ADR-0007(session 身份协议)、DESIGN_PRINCIPLES §4(tmux state 是一级导航)。

## 背景

`TopBar` 和桌面 `aside > SessionList` 同时显示"当前 session"与"可选 session"。拆两块的副作用:

1. **语义重复**:顶栏左上显示 `status-dot + session-name + windowCount`,旁边侧栏顶部写 `Sessions` 然后列出同一批 session——"current session" 在屏幕上出现两次。
2. **桌面视觉臃肿**:侧栏始终 `minmax(240px, 300px)` 常驻,`mtmux`/`work` 这种 2–3 个 session 的场景,侧栏 80% 空白,抢走 terminal 横向空间。
3. **无法让路**:无折叠入口。 ARCHITECTURE Q4 明文留着"是否可折叠,视打扰情况再议"——已经到了"议"的时候。

## 决策

### 1. 一份数据源,两种尺寸呈现

"session 列表" 只有一个可视组件 `<Sidebar>`。它有两种尺寸:

| 尺寸      | 宽度  | 内容                                     | 触发           |
| --------- | ----- | ---------------------------------------- | -------------- |
| expanded  | 272px | 状态灯 + 标题 + 折叠键 + 完整 session 卡 | 默认           |
| collapsed | 56px  | 垂直图标条:每个 session 显示首字母徽章   | 用户点击折叠键 |

移动端完全不渲染 `<Sidebar>`;继续走 `SessionDrawer`(底部 sheet)。`SessionDrawer` 内部复用 expanded 版的卡片列表。

### 2. TopBar 瘦身

- 桌面 sidebar **expanded** 时:`TopBar` 左侧**不再**重复 `status-dot + session-name`——只留一个 `☰` sidebar 折叠按钮 + 下一 PR 要加的 window strip 占位。状态/session 身份归属 sidebar 顶部。
- 桌面 sidebar **collapsed** 时:`TopBar` 接手显示 `status-dot + session-name`(因为此刻 sidebar 只是图标条,session 名看不到)。
- 移动端:`TopBar` 逻辑沿用 ADR-0007——点击 session 名开 `SessionDrawer`。保持不变。

即:**session 身份在屏幕上只显示一次**,由当前布局决定由谁承载。

### 3. 折叠状态持久化 + 键盘快捷

- `useUiStore` 新增 `sidebarCollapsed: boolean`,写入 `localStorage['tm-agent:sidebarCollapsed']`。
- 快捷键 `Ctrl/⌘+B` 切换(ARCHITECTURE §3.4 早已预留该 binding,本 PR 正式绑)。
- 窄桌面(< 900px)默认折叠;宽桌面默认展开。第一次访问无存储时用该启发式。

### 4. 折叠态视觉语言

- 每个 session 一个 40×40 的方块徽章,内容为 session 名首字母(最多 2 字符),mono 字体。
- 当前 attached 的 session 方块带 accent ring。
- hover/focus 弹出 tooltip 展示全名 + window 数。
- 点击切换 session(等同 expanded 卡片点击)。

### 5. 非目标(本 PR 不做)

- session 卡片 last-active / preview 行 → PR B(Phase 3b)。
- rename / kill / 窗口 strip → PR B。
- 颜色 token、motion 过渡、toast → PR C(Phase 6 polish)。
- 移动端侧栏常驻(违反 DESIGN_PRINCIPLES §4 的"drawer on mobile")。

## 影响

- 解决 ARCHITECTURE §11 Q4,可关闭该开放问题。
- `TopBar` 组件的 session pill 变成**上下文感知**:桌面展开时不显示,折叠或移动时显示。
- 原 `aside` 节点被 `<Sidebar>` 替换;现有 e2e `phase3a.spec.ts` 仍依赖 `data-testid="session-list"` / `session-list-item` / `session-drawer`——新组件必须保留这些 testid。
- localStorage key 新增:`tm-agent:sidebarCollapsed`。

## 实施清单

1. `src/frontend/stores/ui-store.ts`:加 `sidebarCollapsed` + `toggleSidebar` + 持久化。
2. 新建 `src/frontend/features/sessions/Sidebar.tsx`:包含 expanded header + SessionList + 折叠键。
3. 新建 `src/frontend/features/sessions/SessionRail.tsx`:折叠态图标条。
4. 改 `src/frontend/features/shell/TopBar.tsx`:加 `showSessionPill` prop、`onToggleSidebar` prop。
5. 改 `src/frontend/app/App.tsx`:grid cols 动态;挂 `Ctrl+B` 监听;把 `aside` 换成 `<Sidebar>`。
6. 单测 `ui-store.test.ts` 验证折叠状态持久化;组件测试 `Sidebar.test.tsx` 覆盖两种尺寸切换。
7. 手工 + Playwright 回归 `phase3a.spec.ts`。
