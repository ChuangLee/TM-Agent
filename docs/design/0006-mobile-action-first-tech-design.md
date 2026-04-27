# 移动端动作优先 UI 技术设计

> **状态(2026-04-21):已实施 + 部分过时。** Phase 2.5 PR1–6 已上线;`useActionFirstFlag()` 与 flag 相关章节(§调试 flag / §ActionPanel 的 `flag` 检查 / §CI flag=off 守护)**已过时**——flag 已拆除,详见 [ADR-0006 addendum](../adr/0006-mobile-action-first-ui.zh.md#addendum-2026-04-21-拆除-action_first-debug-flag)。其他章节(类型、wire 协议、状态机、按键层、compose)仍与当前代码一致。

ADR-0006 / Phase 2.5 的技术落地方案。本文件规定实现契约:类型、接口、模块边界、测试 fixture 结构。

**关联文档**:

- [ADR-0006](../adr/0006-mobile-action-first-ui.zh.md)(决策 & 背景)
- [研究报告](../research/0006-mobile-action-first-research.md)(信号与正则实证)
- [产品规格](0006-mobile-action-first-product-spec.md)(视觉 & 交互锁定)
- [执行计划](../plans/0006-phase-2.5-plan.md)(PR 序列)

---

## 1 · 模块边界与数据流

### 1.1 总览

```
┌────────────────────────────────────────────────────────────────┐
│  Backend (src/backend)                                         │
│                                                                 │
│  tmux-gateway ──► listPanes(format+#{pane_current_command}) ──► Control WS ──┐
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
                                                                                │
                                                                                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  Frontend (src/frontend)                                                     │
│                                                                               │
│  ┌── services/control-ws.ts ──────► stores/sessions-store.ts ──┐             │
│  │                                                              │             │
│  │                                                              ▼             │
│  │                                 features/shell-state/         │            │
│  │                                   use-shell-state.ts ─────► Zustand      │
│  │                                     │                         slice       │
│  │   ┌── features/terminal/use-terminal.ts ───► xterm.buffer + onWriteParsed │
│  │   │                                                           │            │
│  │   │                                                           ▼            │
│  │   │                                 classify() + debounce ──► { state,   │
│  │   │                                                             confidence}│
│  │   │                                                             │         │
│  │   └──────────────────────────────────────────────────────────┐ │         │
│  │                                                              ▼ ▼         │
│  │                                                    features/action-panel/ │
│  │                                                    features/key-overlay/  │
│  │                                                    features/compose/      │
│  │                                                                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 新增 / 修改模块清单

| 文件                                                         | PR  | 类型 | 说明                                         |
| ------------------------------------------------------------ | --- | ---- | -------------------------------------------- |
| `src/backend/tmux/tmux-gateway.ts`                           | PR1 | 修改 | `listPanes` 的 format string 扩展            |
| `src/shared/protocol.ts`                                     | PR1 | 修改 | `paneSummary` Zod schema 加字段              |
| `src/frontend/features/shell-state/classifier.ts`            | PR1 | 新增 | 纯函数分类器                                 |
| `src/frontend/features/shell-state/state-definitions.ts`     | PR1 | 新增 | 状态枚举 + 每状态卡片集(PR2-3 填充)          |
| `src/frontend/features/shell-state/use-shell-state.ts`       | PR1 | 新增 | Hook,产出 `ShellState`                       |
| `src/frontend/stores/shell-state-store.ts`                   | PR1 | 新增 | Zustand slice                                |
| `src/frontend/hooks/use-action-first-flag.ts`                | PR2 | 新增 | flag 门控                                    |
| `src/frontend/features/action-panel/ActionPanel.tsx`         | PR2 | 新增 | 横向卡片带                                   |
| `src/frontend/features/action-panel/Card.tsx`                | PR2 | 新增 | 单卡片                                       |
| `src/frontend/features/action-panel/PromptCaptureBanner.tsx` | PR3 | 新增 | confirm/password banner                      |
| `src/frontend/features/key-overlay/KeyOverlay.tsx`           | PR4 | 新增 | 顶部下拉层                                   |
| `src/frontend/features/key-overlay/key-layout.ts`            | PR4 | 新增 | 按状态决定上部状态键区内容                   |
| `src/frontend/hooks/use-top-edge-pull.ts`                    | PR4 | 新增 | 顶部下拉手势                                 |
| `src/frontend/hooks/use-sticky-modifier.ts`                  | PR4 | 新增 | 粘滞修饰键逻辑                               |
| `src/frontend/features/compose/history-store.ts`             | PR5 | 新增 | per-session 历史                             |
| `src/frontend/features/compose/draft-store.ts`               | PR5 | 新增 | per-session 草稿                             |
| `src/frontend/features/compose/ComposeBar.tsx`               | PR5 | 修改 | 加粘贴按钮 + 历史 + 快速插入托盘             |
| `src/frontend/lib/i18n.ts`                                   | PR2 | 新增 | 中文文案常量,英文 fallback                   |
| `src/backend/api/history.ts`                                 | PR5 | 新增 | `GET /api/history?session=<id>`              |
| `src/frontend/features/direct-mode/DirectModeProvider.tsx`   | PR6 | 新增 | Context + 状态机                             |
| `src/frontend/features/direct-mode/use-direct-mode.ts`       | PR6 | 新增 | 主 hook,暴露 `{active, enter, exit, toggle}` |
| `src/frontend/features/direct-mode/keydown-to-bytes.ts`      | PR6 | 新增 | 纯函数,KeyboardEvent → 字节 / 特殊信号       |
| `src/frontend/features/direct-mode/ime-bridge.tsx`           | PR6 | 新增 | 隐藏 textarea + composition 浮层             |
| `src/frontend/features/direct-mode/DirectModeIndicator.tsx`  | PR6 | 新增 | 顶部 accent 悬浮条                           |
| `src/frontend/features/shell/TopBar.tsx`                     | PR6 | 修改 | 桌面 TopBar 加"直通模式"按钮                 |
| `src/frontend/styles/direct-mode.css`                        | PR6 | 新增 | blur + glow 动画                             |

---

## 2 · 状态机 API

### 2.1 类型定义

```ts
// src/frontend/features/shell-state/state-definitions.ts

export const SHELL_STATES = [
  "shell_idle",
  "long_process",
  "editor",
  "tui",
  "repl",
  "pager",
  "confirm_prompt",
  "password_prompt"
] as const;

export type ShellState = (typeof SHELL_STATES)[number];
export type Confidence = "high" | "low";

export interface ShellStateResult {
  state: ShellState;
  confidence: Confidence;
  detectedAt: number; // Date.now() when this classification ran
  /** original tail (up to 5 lines) used for detection — debug aid, not shown in UI */
  tailSample: string;
  /** the pane_current_command that fed this result */
  paneCurrentCommand: string;
  altScreen: boolean;
}

export interface Signals {
  cmd: string; // pane_current_command, empty string if unknown
  altScreen: boolean; // term.buffer.active.type === 'alternate'
  tail: string; // last ≤ 5 rows, stripped of SGR escapes, joined with \n
  lastOutputTs: number; // Date.now() of most recent onWriteParsed
}
```

### 2.2 分类器纯函数

```ts
// src/frontend/features/shell-state/classifier.ts

const PASSWORD_RE = /(password|passphrase).*:\s*$/i;
const CONFIRM_RE =
  /(\[y\/n\]|\(y\/n\)|\(yes\/no\)|continue\?|proceed\?|remove\?|overwrite\?|are you sure\??)\s*$/i;
const REPL_PROMPT_RE = /(^|\n)(>>>|\.\.\.|> |In \[\d+\]:?)\s*$/m;
const PROMPT_RE = /[\$›#»❯]\s*$/;

const EDITOR_CMDS = new Set(["vim", "nvim", "nano", "micro", "hx"]);
const PAGER_CMDS = new Set(["less", "more", "man"]);
const TUI_CMDS = new Set([
  "claude",
  "aider",
  "htop",
  "btop",
  "lazygit",
  "ranger",
  "fzf",
  "k9s",
  "tig"
]);
const REPL_CMDS = new Set(["python", "python3", "node", "bun", "irb", "ghci", "deno"]);

const LONG_PROCESS_IDLE_MS = 3000;

export function classify(s: Signals): ShellStateResult {
  const base = {
    detectedAt: Date.now(),
    tailSample: s.tail,
    paneCurrentCommand: s.cmd,
    altScreen: s.altScreen
  };

  if (PASSWORD_RE.test(s.tail)) return { state: "password_prompt", confidence: "high", ...base };
  if (CONFIRM_RE.test(s.tail)) return { state: "confirm_prompt", confidence: "high", ...base };

  if (s.altScreen) {
    if (EDITOR_CMDS.has(s.cmd)) return { state: "editor", confidence: "high", ...base };
    if (PAGER_CMDS.has(s.cmd)) return { state: "pager", confidence: "high", ...base };
    if (TUI_CMDS.has(s.cmd)) return { state: "tui", confidence: "high", ...base };
    // git + alt → git spawned less; classify as pager
    if (s.cmd === "git") return { state: "pager", confidence: "high", ...base };
    return { state: "tui", confidence: "low", ...base };
  }

  if (REPL_CMDS.has(s.cmd) || REPL_PROMPT_RE.test(s.tail)) {
    return { state: "repl", confidence: "high", ...base };
  }
  if (PROMPT_RE.test(s.tail)) {
    return { state: "shell_idle", confidence: "high", ...base };
  }
  if (Date.now() - s.lastOutputTs < LONG_PROCESS_IDLE_MS) {
    return { state: "long_process", confidence: "high", ...base };
  }
  return { state: "shell_idle", confidence: "low", ...base };
}
```

### 2.3 Hook 签名

```ts
// src/frontend/features/shell-state/use-shell-state.ts

export interface UseShellStateArgs {
  terminal: Terminal | null; // xterm.js instance (from useTerminal)
}

export function useShellState(args: UseShellStateArgs): ShellStateResult;
```

内部:

- 订阅 `term.onWriteParsed` + `term.buffer.onBufferChange`,在 200ms debounce 内聚合变化。
- 从 `useSessionsStore` 读 `paneCurrentCommand`(PR1 扩展 store)。
- `lastOutputTs` 在每次 `onWriteParsed` 时更新。
- `classify()` 的调用由 `requestAnimationFrame` 节流。

Hook 返回最新 `ShellStateResult`,不做内部 ref 缓存——消费者按值订阅。

### 2.4 Zustand slice

```ts
// src/frontend/stores/shell-state-store.ts

interface ShellStateStore {
  current: ShellStateResult;
  /** previous state for transition detection */
  previous: ShellStateResult | null;
  set(result: ShellStateResult): void;
}

export const useShellStateStore = create<ShellStateStore>((set, get) => ({
  current: createInitialState(),
  previous: null,
  set(result) {
    const cur = get().current;
    // avoid churn: same state + same cmd → no-op
    if (cur.state === result.state && cur.paneCurrentCommand === result.paneCurrentCommand) {
      return;
    }
    set({ previous: cur, current: result });
  }
}));
```

UI 组件 subscribe 这个 store,而不是直接订阅 hook,避免多处重复分类。`use-shell-state.ts` 内部 push 到 store。

---

## 3 · Wire 协议 diff

### 3.1 `paneSummary` schema

在 `src/shared/protocol.ts` 的 `paneSummarySchema` 里追加字段:

```diff
 export const paneSummarySchema = z.object({
   paneId: z.string(),
   paneIndex: z.number(),
   active: z.boolean(),
+  paneCurrentCommand: z.string().default(""),
   title: z.string().optional(),
   ...
 });
```

- 字段名用 camelCase(前端惯例);后端序列化时从 tmux 的 `#{pane_current_command}` 映射。
- 默认值为空串,保证老客户端收到新协议不破,新客户端收到老协议(无此字段)也能安全降级。

### 3.2 后端 format string

`src/backend/tmux/tmux-gateway.ts` 的 `listPanes` 实现中 `-F` 格式字符串新增 `#{pane_current_command}`。解析器同步加字段提取。

### 3.3 协议推送时机

`paneCurrentCommand` 随 `sessionsSnapshot` 消息推送:

- 在 tmux pane 焦点变化 / 前台进程变化时,`sessionsSnapshot` 本就会重推(现有机制),带新字段即可。
- 不需要新的消息类型。

---

## 4 · Action-first flag 机制

### 4.1 flag 读取优先级

```ts
// src/frontend/hooks/use-action-first-flag.ts

export function useActionFirstFlag(): boolean {
  return useMemo(() => {
    // 1. URL 参数:?action_first=1 强制开;?action_first=0 强制关
    const urlParam = new URLSearchParams(location.search).get("action_first");
    if (urlParam === "1") return true;
    if (urlParam === "0") return false;

    // 2. localStorage
    const ls = localStorage.getItem("tm-agent_action_first");
    if (ls === "1") return true;
    if (ls === "0") return false;

    // 3. build-time env:开发环境默认开,生产默认关(直到 PR5 完成并双轨验证后翻开)
    if (import.meta.env.DEV) return true;
    return false;
  }, []);
}
```

### 4.2 组件门控

- `App.tsx`:根据 flag 渲染 `<ActionPanel />` + `<KeyOverlay />` 或不渲染。
- 旧 `<ComposeBar />` 所在位置始终渲染;flag 开时 compose bar 的高级功能(历史、草稿、粘贴)额外启用。
- 不要做运行时切换;flag 改变需要刷新(简化状态管理)。可在 PR5 加一个 "reload" 按钮的 dev sheet。

---

## 5 · ActionPanel 组件 API

### 5.1 接口

```ts
// src/frontend/features/action-panel/types.ts

export interface ActionCard {
  /** 显示 label,已国际化后的字符串 */
  label: string;
  /** 发送的 payload。字符串 = 直接 write;`__HISTORY__` = 特殊 action */
  payload: string;
  /** "cmd" = mono font, "special" = ui font (for 历史/Tab 等非命令 label) */
  kind?: "cmd" | "special";
  /** 危险命令黑名单标志;若 true,单击会改为填入 compose 而不是直接发送 */
  dangerous?: boolean;
}

export function cardsForState(
  state: ShellState,
  ctx: {
    cmd: string;
    history: string[];
    pinned: string[];
    /** 若 state 是 long_process,则 ctx.hints 来自最近 30 行的帮助提示提取 */
    hints?: Array<{ key: string; label: string }>;
  }
): ActionCard[];
```

### 5.2 响应式布局

`<ActionPanel />` 按视口宽度自适应:

| 视口            | 布局     | 卡片高 | 排布                                    |
| --------------- | -------- | ------ | --------------------------------------- |
| `< 820px`(移动) | 2 行横滚 | 44px   | 96px 容器 + 横向滚动                    |
| `≥ 820px`(桌面) | 1 行紧凑 | 28px   | 40px 容器 + 横向滚动 + `Alt+1-9` 快捷键 |

用 `window.matchMedia('(min-width: 820px)')` + `useSyncExternalStore` 订阅。同一组件,布局切换由 CSS `data-layout="mobile|desktop"` 属性驱动;卡片内容完全相同(内容不随尺寸变化,只变展示)。

**桌面开关**:桌面布局下组件额外订阅 `localStorage.action_panel_desktop`;值为 `'0'` 则组件返回 `null`,配合 `App.tsx` grid 的 `grid-template-rows: auto auto 1fr auto` 会自动压缩 40px。默认值 `'1'`。

### 5.3 桌面键盘快捷键

`Alt+1` … `Alt+9` 绑定到前 9 张卡片:

```ts
// src/frontend/features/action-panel/use-desktop-shortcuts.ts

export function useDesktopShortcuts(cards: ActionCard[], enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const n = parseInt(e.key, 10);
      if (!n || n < 1 || n > 9) return;
      const card = cards[n - 1];
      if (!card) return;
      e.preventDefault();
      emitCardTap(card);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cards, enabled]);
}
```

**与 Direct Mode 的冲突**:Direct Mode 的 `keydownToBytes` 遇到 `e.altKey && /^[1-9]$/.test(e.key)` 时,**先**查询 ActionPanel 是否有对应 slot;有则返回 `null`(让 use-desktop-shortcuts 的 listener 处理),无则走原来的 Alt+字母 逻辑。实现用一个 shared registry:

```ts
// src/frontend/features/action-panel/desktop-shortcut-registry.ts
let currentCards: ActionCard[] = [];
export function registerDesktopCards(cards: ActionCard[]): void {
  currentCards = cards;
}
export function getDesktopShortcutCard(digit: number): ActionCard | null {
  return currentCards[digit - 1] ?? null;
}
```

### 5.4 `<ActionPanel />`

```tsx
interface ActionPanelProps {}

export function ActionPanel(props: ActionPanelProps): React.ReactElement | null {
  const flag = useActionFirstFlag();
  const shellState = useShellStateStore((s) => s.current);
  const history = useHistoryForState(shellState);
  const pinned = usePinnedCommands();
  const hints = useDetectedHints(shellState);

  if (!flag) return null;
  if (shellState.state === "confirm_prompt" || shellState.state === "password_prompt") {
    return <PromptCaptureBanner state={shellState} />;
  }

  const cards = cardsForState(shellState.state, {
    cmd: shellState.paneCurrentCommand,
    history,
    pinned,
    hints
  });

  return (
    <div className="action-panel">
      <div className="action-panel-rows">
        {cards.map((c, i) => (
          <Card key={i} card={c} />
        ))}
      </div>
    </div>
  );
}
```

### 5.5 `<Card />`

```tsx
interface CardProps {
  card: ActionCard;
}

export function Card({ card }: CardProps): React.ReactElement {
  const send = useSendToTerminal();
  const fillCompose = useFillCompose();

  const onTap = () => {
    if (card.payload === "__HISTORY__") {
      openHistorySheet();
      return;
    }
    if (card.dangerous) {
      fillCompose(card.payload);
      return;
    }
    send(card.payload);
    vibrate(10);
  };

  const onLongPress = () => {
    fillCompose(card.payload);
    vibrate(30);
  };

  return (
    <button
      className={`card ${card.kind === "special" ? "special" : ""}`}
      {...bindLongPress({ onTap, onLongPress, threshold: 500 })}
    >
      {card.label}
    </button>
  );
}
```

---

## 6 · KeyOverlay 组件 API

### 6.1 接口

```tsx
interface KeyOverlayProps {
  /** 受控 open 状态,由父组件管理以便与 compose bar 互斥 */
  open: boolean;
  onClose: () => void;
  onOpenCompose: () => void;
}

export function KeyOverlay(props: KeyOverlayProps): React.ReactElement;
```

### 6.2 使用

在 `App.tsx`:

```tsx
const [overlayOpen, setOverlayOpen] = useState(false);
const [composeOpen, setComposeOpen] = useState(false);

// 互斥
const openOverlay = () => { setOverlayOpen(true); setComposeOpen(false); };
const openCompose = () => { setComposeOpen(true); setOverlayOpen(false); };

<KeyOverlay
  open={overlayOpen}
  onClose={() => setOverlayOpen(false)}
  onOpenCompose={openCompose}
/>
<ActionRail
  onOpenOverlay={openOverlay}
  onOpenCompose={openCompose}
/>
```

### 6.3 粘滞修饰键 hook

```ts
// src/frontend/hooks/use-sticky-modifier.ts

export type ModifierKey = "ctrl" | "alt" | "shift" | "meta";
export type ModifierState = "idle" | "armed" | "locked";

export function useStickyModifiers(): {
  state: Record<ModifierKey, ModifierState>;
  /** call on modifier key tap */
  tap(k: ModifierKey): void;
  /** call on modifier key long-press (500ms) */
  longPress(k: ModifierKey): void;
  /** call when a non-modifier key is pressed — releases armed modifiers */
  consume(): ModifierKey[];
};
```

- tap:`idle` → `armed`,`armed` → `idle`,`locked` → `idle`(用户主动关锁定)
- longPress:`*` → `locked`(已 locked 的再 longPress 也是 locked,用户可连点 tap 关闭)
- consume:返回当前 `armed` 的修饰键列表并把它们转 `idle`;`locked` 的不变。

### 6.4 顶部下拉 hook

```ts
// src/frontend/hooks/use-top-edge-pull.ts

export function useTopEdgePull(
  onTriggered: () => void,
  options?: {
    startYThreshold?: number; // default 20px
    distanceThreshold?: number; // default 60px
    maxDurationMs?: number; // default 300ms
  }
): void;
```

绑定 `pointerdown`/`pointermove`/`pointerup` 到 `document`,满足条件时 fire `onTriggered`。

---

## 7 · Compose bar 扩展

### 7.1 历史 store

```ts
// src/frontend/features/compose/history-store.ts

export interface HistoryEntry {
  text: string;
  state: ShellState | null;
  ts: number;
}

interface HistoryStore {
  bySession: Record<string, HistoryEntry[]>; // session id → entries
  push(sessionId: string, entry: HistoryEntry): void;
  pull(sessionId: string, stateFilter?: ShellState): HistoryEntry[];
  loadFromShellHistory(sessionId: string): Promise<void>;
}
```

- `push`:compose bar 发送时调用;**password_prompt 态跳过**。
- `pull`:按 `stateFilter` 过滤:`editor` 只显示 `text.startsWith(":")`,`pager` 只显示 `text.startsWith("/")`。
- `loadFromShellHistory`:首次使用时懒加载,调 `/api/history` 后端(PR5)。

### 7.2 草稿 store

```ts
interface DraftStore {
  bySession: Record<string, string>;
  set(sessionId: string, text: string): void;
  get(sessionId: string): string;
  clear(sessionId: string): void;
}
```

- `set`:compose bar `onChange` 每次触发;**password_prompt 态跳过**。
- 切 session 时保留;刷新清空(v1 不 persist)。

### 7.3 后端历史 API

```ts
// src/backend/api/history.ts

GET /api/history?session=<id>

Response (200 OK):
{
  "entries": string[],       // 每条一行,倒序(最新在前)
  "truncated": boolean,      // 文件太大被截了吗
  "source": "HISTFILE" | "bash_history" | null  // null 表示没找到
}
```

- 安全:
  - flag-gated(后端也有 env flag `TM_AGENT_HISTORY_API`,默认关闭,运维开启才暴露)。
  - 路径固定为 `$HOME/.bash_history` 或 `$HISTFILE`;不接受用户路径参数。
  - 大小上限 512KB,超过截断返回 `truncated: true`。
  - redact 规则:过滤看起来像密码/token 的行(正则 `(password|token|secret|api[_-]?key)=`)。
- 认证:沿用现有 token + password 的中间件。

---

## 8 · i18n 机制

```ts
// src/frontend/lib/i18n.ts

type Locale = "zh-CN" | "en";

const STRINGS: Record<Locale, Record<string, string>> = {
  "zh-CN": {
    "action.history.open": "↑ 历史",
    "confirm.yes": "是",
    "confirm.no": "否"
    // ... see 产品规格 §9
  },
  en: {
    "action.history.open": "↑ History",
    "confirm.yes": "Yes",
    "confirm.no": "No"
    // ...
  }
};

export function t(key: string): string {
  const locale = getLocale(); // 'zh-CN' default, 'en' if navigator.language starts with 'en'
  return STRINGS[locale]?.[key] ?? STRINGS["en"][key] ?? key;
}
```

- v1:硬编码 zh-CN + en 两份字符串,`t()` 从中选。
- 按 `navigator.language` 首选字母判定:`en` 开头 → `en`,其他 → `zh-CN`(因为项目主场在中文)。
- 未来可接 localStorage 让用户手动切换;v1 不做。

---

## 9 · 测试 fixture 结构

### 9.1 分类器单元测试

```
tests/frontend/shell-state/classifier.test.ts
  ├─ 18 条研究报告覆盖用例(table-driven)
  ├─ 12 条补充用例(PowerShell / nushell / fish / 宽字符 / etc.)
  └─ 5 条"抖动过渡"用例(git ↔ less,200ms 窗口内多次 classify,断言结果稳定)
```

### 9.2 集成测试:fake tmux + fake xterm buffer

沿用现有 `FakeTmuxGateway` 扩展,加 `paneCurrentCommand` 字段支持:

```ts
fakeTmux.setPaneCurrentCommand("session1", "pane1", "vim");
fakeBuffer.setAltScreen(true);
fakeBuffer.setTailRows(['"notes.md" 5L, 42C    3,8']);

// advance clock through debounce window
vi.advanceTimersByTime(200);

expect(useShellStateStore.getState().current.state).toBe("editor");
```

### 9.3 E2E Playwright

`tests/frontend/e2e/action-first.spec.ts`:

- `flag=off`:所有现有 Phase 1 用例照跑。
- `flag=on` × 8 状态 × 核心路径:
  1. shell_idle: 点 `ls` 卡 → terminal 有输出
  2. editor: 进 vim → `:wq` 卡出现 → 点击 → 文件保存 + 退出
  3. tui: claude → `y` 卡出现 → 点 → claude 收到 y
  4. repl: node → `.exit` 卡 → 点 → 退出 node
  5. pager: `man ls` → `Space` 卡 → 点 → 翻页
  6. confirm: 模拟 `[Y/n]` → banner 出现 → 点"是" → 流程继续
  7. password: 模拟 sudo → banner 出现 → 输密码 → send → 字符发出
  8. long_process: `npm run dev` → Ctrl+C 大卡 → 点 → SIGINT
- Overlay 路径:点 `⌨` → overlay 打开 → 点 `Ctrl` → armed → 点 `C` → PTY 收到 `\x03`、armed 自动释放。
- Compose 路径:长按 card → compose bar 被填;密码 banner 状态下输入不出现在 Zustand 的 history/draft store。

---

## 10 · 性能与度量

每 PR 在 PR 描述里报:

- Classifier 每次调用耗时(p50, p99)。
- onWriteParsed 触发频率(事件/秒)vs debounce 后分类器触发频率。
- ActionPanel 渲染时间。
- KeyOverlay 入场动画的帧率(target ≥ 55fps on iPhone 12+)。

用 `scripts/debug-*.mjs` 的 Playwright 运行 + `performance.measure()` 数据收集。PR5 合入后出一份 summary 写到 `docs/performance/0006-phase-2.5.md`。

---

## 11 · 回滚矩阵

| 单 PR revert 之后   | 前端表现                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------- |
| 只 revert PR5       | 卡片带 + overlay 正常,compose bar 回到 Phase 1 形态                                           |
| 只 revert PR4       | 卡片带 + banner 正常,`⌨` 按钮点击无反应(或隐藏)                                               |
| 只 revert PR3       | 卡片带只有 shell_idle + editor,其他 6 状态落入 shell_idle 默认,confirm/password 不显示 banner |
| 只 revert PR2       | 只有 classifier + 后端信号,UI 不变                                                            |
| Revert 全部 5 个 PR | 完全回到 Phase 1                                                                              |

所有 revert 操作必须保证 `action_first=off` 下视觉/行为与当前 `main` 分支一致。CI 里加一条 "flag=off Playwright" 守护。

---

## 12 · 待决项(从 ADR / 研究迁移)

| 编号 | 来源                | 问题                                                  | 解决阶段           |
| ---- | ------------------- | ----------------------------------------------------- | ------------------ |
| T1   | 产品规格 §11 签字栏 | 决策者真机过 HTML 原型并签字                          | 进入 PR1 之前      |
| T2   | 研究报告 §2.4       | fish shell 带 SGR 的 prompt 能否被 tail(已去 SGR)匹配 | PR1 集成测试       |
| T3   | 研究报告 §2.4       | 宽字符尾行边界处理                                    | PR1 tail 提取函数  |
| T4   | ADR-0006 §Open Q2   | 密码态 input 字节**绝对**不进 store 的断言            | PR3 集成测试 + E2E |
| T5   | 计划 §风险 R4       | `/api/history` 的 redact 规则清单                     | PR5 开发中拟定     |
| T6   | 计划 §风险 R1       | 多机型覆盖矩阵                                        | PR4 真机过机时决定 |

---

## 13 · 桌面直通模式 (Direct Mode)实现契约(PR6)

### 13.1 检测与状态机

```ts
// src/frontend/features/direct-mode/use-direct-mode.ts

export type DirectModeStatus = "idle" | "entering" | "active" | "exiting";

export interface UseDirectModeResult {
  available: boolean; // 是否满足 PC 检测条件
  status: DirectModeStatus;
  active: boolean; // status === "active"
  enter(): void;
  exit(source: "button" | "ctrl-bracket" | "double-esc"): void;
  toggle(): void;
}

export function useDirectMode(): UseDirectModeResult;
```

`available` 条件:`matchMedia('(min-width: 820px) and (pointer: fine)').matches`,用 `useSyncExternalStore` 订阅变化。URL 参数 `?direct_mode=1` 可无视 pointer 检查强制开(touch+mouse 混合设备逃生)。

状态机:

```
idle ──[enter()]──► entering ─(200ms)─► active
active ──[exit()]──► exiting ─(200ms)─► idle
```

`entering` / `exiting` 的 200ms 是 CSS 动画窗口;组件在进入期添加 `data-direct-mode="entering"` 让样式插值生效,在 `active` 最终稳态再添加 `data-direct-mode="active"`。

### 13.2 键盘抓取

```tsx
// src/frontend/features/direct-mode/DirectModeProvider.tsx

function useGlobalKeydown(active: boolean, sendBytes: (s: string) => void, exit: (src) => void) {
  useEffect(() => {
    if (!active) return;

    let lastEscTs = 0;

    const onKeydown = (e: KeyboardEvent) => {
      // 先判退出路径
      if (e.ctrlKey && e.code === "BracketRight") {
        e.preventDefault();
        e.stopPropagation();
        exit("ctrl-bracket");
        return;
      }
      if (e.key === "Escape") {
        const now = Date.now();
        if (now - lastEscTs < 300) {
          e.preventDefault();
          e.stopPropagation();
          exit("double-esc");
          return;
        }
        lastEscTs = now;
        // 第一次 Esc 仍发 PTY —— fall through
      }

      const bytes = keydownToBytes(e);
      if (bytes === null) return; // 浏览器保留键等,不处理
      e.preventDefault();
      e.stopPropagation();
      sendBytes(bytes);
    };

    document.addEventListener("keydown", onKeydown, { capture: true });
    return () => document.removeEventListener("keydown", onKeydown, { capture: true });
  }, [active, sendBytes, exit]);
}
```

粘贴类似,监听 `paste`:

```ts
useEffect(() => {
  if (!active) return;
  const onPaste = (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (text) {
      e.preventDefault();
      sendBytes(text);
    }
  };
  document.addEventListener("paste", onPaste, { capture: true });
  return () => document.removeEventListener("paste", onPaste, { capture: true });
}, [active, sendBytes]);
```

### 13.3 keydown → bytes 表

```ts
// src/frontend/features/direct-mode/keydown-to-bytes.ts

/** Return bytes to send, or null to skip (browser-reserved, ActionPanel shortcut, etc.) */
export function keydownToBytes(e: KeyboardEvent): string | null {
  // Ignore composition-driven events
  if (e.isComposing || e.keyCode === 229) return null;

  // Browser-reserved combos that browser grabs itself will never fire here,
  // but some do (e.g. Ctrl+N in some browsers) — skip these to avoid fighting the UA.
  if ((e.ctrlKey || e.metaKey) && ["t", "w", "r", "n", "q"].includes(e.key.toLowerCase())) {
    return null;
  }

  // Alt+1..9: yield to ActionPanel desktop shortcut if a card is registered
  if (e.altKey && /^[1-9]$/.test(e.key)) {
    const digit = parseInt(e.key, 10);
    if (getDesktopShortcutCard(digit)) return null;
  }

  const k = e.key;

  // Special keys
  switch (k) {
    case "Enter":
      return "\r";
    case "Tab":
      return "\t";
    case "Backspace":
      return "\x7f";
    case "Delete":
      return "\x1b[3~";
    case "Escape":
      return "\x1b";
    case "ArrowUp":
      return "\x1b[A";
    case "ArrowDown":
      return "\x1b[B";
    case "ArrowLeft":
      return "\x1b[D";
    case "ArrowRight":
      return "\x1b[C";
    case "Home":
      return "\x1b[H";
    case "End":
      return "\x1b[F";
    case "PageUp":
      return "\x1b[5~";
    case "PageDown":
      return "\x1b[6~";
  }

  // F1–F12
  if (/^F([1-9]|1[0-2])$/.test(k)) {
    const n = parseInt(k.slice(1), 10);
    if (n <= 4) return `\x1bO${"PQRS"[n - 1]}`;
    const codes = [15, 17, 18, 19, 20, 21, 23, 24];
    return `\x1b[${codes[n - 5]}~`;
  }

  // Single-char keys
  if (k.length === 1) {
    if (e.ctrlKey && /^[a-zA-Z]$/.test(k)) {
      return String.fromCharCode(k.toLowerCase().charCodeAt(0) - 96);
    }
    if (e.altKey) {
      return "\x1b" + k;
    }
    return k;
  }

  return null;
}
```

### 13.4 IME 桥接

```tsx
// src/frontend/features/direct-mode/ime-bridge.tsx

export function ImeBridge({
  active,
  sendBytes,
  cursorPx
}: {
  active: boolean;
  sendBytes: (s: string) => void;
  cursorPx: { x: number; y: number } | null;
}): React.ReactElement | null {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [composing, setComposing] = useState(false);
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!active) return;
    ref.current?.focus();
    const keepFocus = () => {
      if (active) ref.current?.focus();
    };
    document.addEventListener("click", keepFocus);
    return () => document.removeEventListener("click", keepFocus);
  }, [active]);

  if (!active) return null;

  return (
    <>
      <textarea
        ref={ref}
        aria-hidden="true"
        tabIndex={-1}
        onCompositionStart={() => setComposing(true)}
        onCompositionUpdate={(e) => setValue(e.data)}
        onCompositionEnd={(e) => {
          setComposing(false);
          if (e.data) sendBytes(e.data);
          setValue("");
          if (ref.current) ref.current.value = "";
        }}
        className="direct-mode-ime-sink"
        style={{ position: "fixed", top: -1000, left: -1000, width: 1, height: 1, opacity: 0 }}
      />
      {composing && cursorPx && (
        <div
          className="direct-mode-ime-floater"
          style={{ position: "fixed", left: cursorPx.x, top: cursorPx.y + 18 }}
          role="status"
          aria-live="polite"
        >
          {value}
        </div>
      )}
    </>
  );
}
```

`cursorPx` 由父组件计算:Surface 左上角坐标 + `term.buffer.active.cursorX * cellW` / `cursorY * cellH`。

### 13.5 发送通道

`sendBytes(s: string)` 借用 `TerminalWsClient.write(s)`(已有)。不经过 compose-bar,不写入 history/draft store。

### 13.6 视觉层 CSS

```css
/* src/frontend/styles/direct-mode.css */

body[data-direct-mode="entering"] .tm-scroller,
body[data-direct-mode="active"] .tm-scroller {
  box-shadow:
    0 0 0 2px var(--accent),
    0 0 32px rgba(125, 211, 252, 0.4);
  animation: direct-mode-pulse 3s ease-in-out infinite;
  position: relative;
  z-index: 1;
}

body[data-direct-mode="active"]
  *:not(.tm-scroller):not(.tm-scroller *):not(.direct-mode-indicator):not(
    .direct-mode-indicator *
  ):not(.direct-mode-ime-floater):not(.direct-mode-ime-sink) {
  filter: blur(4px) grayscale(30%) opacity(0.4);
  transition: filter 200ms ease-out;
}

body[data-direct-mode="entering"]
  *:not(.tm-scroller):not(.tm-scroller *):not(.direct-mode-indicator):not(
    .direct-mode-indicator *
  ):not(.direct-mode-ime-floater):not(.direct-mode-ime-sink) {
  transition: filter 200ms ease-out;
}

@keyframes direct-mode-pulse {
  0%,
  100% {
    box-shadow:
      0 0 0 2px var(--accent),
      0 0 24px rgba(125, 211, 252, 0.3);
  }
  50% {
    box-shadow:
      0 0 0 2px var(--accent),
      0 0 40px rgba(125, 211, 252, 0.55);
  }
}

@media (prefers-reduced-motion: reduce) {
  body[data-direct-mode="active"] .tm-scroller {
    animation: none;
  }
  body[data-direct-mode="active"] * {
    transition: none !important;
  }
}
```

**注**:`:not(.tm-scroller):not(.tm-scroller *)` 用 CSS 选择器排除后代是脆弱的——浏览器需要计算每个元素的祖先树。如果性能不好,改成在 body 上用 `data-direct-mode="active"` 对 `main > *` 以外的容器打独立 class `direct-mode-blurred`。v1 先用选择器,PR6 合入时在低端 Mac Safari 测一次帧率。

### 13.7 测试

- `keydown-to-bytes.test.ts`:表驱动,覆盖 A-Z、0-9、方向、F1-F12、Ctrl+组合、Alt+组合、保留键。
- `use-direct-mode.test.tsx`:`enter()` 切状态、`Ctrl+]` 触发 exit、双击 Esc 触发 exit(200ms 内第二次)。
- IME 集成:模拟 `compositionstart` → `update` → `end`,断言合成期 `sendBytes` 不被调;`compositionend` 时 payload 完整发送。
- E2E(Playwright desktop viewport):
  - 点入口按钮 → 断言 body `data-direct-mode="active"` 在 200ms 后出现。
  - 键入 `ls\n` → terminal DOM 有 `ls` 输出。
  - Ctrl+] → 断言 body attribute 清除。
  - 输入中文(Playwright 可用 `page.keyboard.insertText()` 配合 `composition` 事件模拟)。

---

## 14 · 实施顺序(链接到执行计划)

见 [执行计划 §里程碑](../plans/0006-phase-2.5-plan.md#里程碑)。本文件不重复 PR 边界,只定义实现契约。PR 作者以此为"合同",偏离必须更新本文档并在 PR 描述里注明。
