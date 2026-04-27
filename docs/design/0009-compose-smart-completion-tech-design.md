# 0009 — Compose Bar 智能补全 · 技术设计

> 状态:Proposed
> 日期:2026-04-22
> 关联:research/0009、design/0009-product-spec、ADR-0009
> 覆盖:v1 切片(slash-only,纯前端)

## 1. 设计目标

把产品方案落到代码。约束:

- **不动后端**:零新 RPC、零协议变更。
- **不动 ComposeBar 既有发送路径**:候选只**填值**,Enter 还是走老的 `send_compose`。
- **不动 ShellState classifier**:消费现有 `useShellStateStore.current`,只读不写。
- **不动 KeyOverlay**:Suggestions 是另一组件,层级低于 KeyOverlay,KeyOverlay 打开时让位。
- 新增代码全部落 `src/frontend/features/compose/completion/`,可独立删。

## 2. 模块结构

```
src/frontend/features/compose/
├── ComposeBar.tsx              ← 改动:挂 <Suggestions /> + 暴露 setValue ref
└── completion/                 ← 新建
    ├── Suggestions.tsx         ← 弹层组件(向上展开,贴 textarea)
    ├── catalog.ts              ← 静态候选表(state, cmd) → entries[]
    ├── use-completion.ts       ← 状态机 hook:trigger / lock / candidates / pick / dismiss
    └── types.ts                ← Entry / Trigger / Mode 类型
```

不新建 store。补全是局部 UI 状态,挂在 `useCompletion()` 内部 `useState` 即可,不污染 Zustand。

## 3. 数据流

```
ComposeBar.value (本地 state)
        │
        ▼
useCompletion(value, shellState)
        │ 派生:
        │   - active: boolean        是否显示弹层
        │   - mode:   "slash" | "ex" 触发模式(锁定)
        │   - entries: Entry[]       候选列表(<= 6)
        │
        ▼
<Suggestions
  entries={entries}
  onPick={(e) => {
    setValue(e.insert)         // 填回 ComposeBar
    completion.dismiss("pick") // 关闭面板
    textareaRef.current.focus()
  }}
  onDismiss={completion.dismiss}
/>
```

ComposeBar 把现有 `value` / `setValue` 通过 prop / ref 共享给 Suggestions。无新全局状态。

## 4. Hook 状态机:`useCompletion`

```ts
type Trigger = "/" | ":" | null;

interface CompletionState {
  active: boolean;
  /** 触发时锁定;之后即使 shellState 变化也不切表。 */
  lockedTrigger: Trigger;
  lockedState: ShellState;
  lockedCmd: string;
  entries: Entry[];
  highlightIndex: number;
}
```

转换规则:

| 当前 active | 输入变化                                                       | shellState 变化                              | 转换                                                                |
| ----------- | -------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| false       | `value` 第一个非空字符 ∈ {`/`,`:`} 且当前 state 允许该 trigger | —                                            | active=true,锁定 (trigger, state, cmd),计算 entries                 |
| true        | `value` 不再以 lockedTrigger 开头(被删了 / 改了)               | —                                            | active=false,reason="delete-trigger"                                |
| true        | `value` 持续以 lockedTrigger 开头                              | —                                            | 用 `value` 之后的部分做前缀过滤,刷新 entries(锁定的 state/cmd 不变) |
| true        | —                                                              | state → `password_prompt` / `confirm_prompt` | active=false,reason="state-locked"(强制隐私关闭)                    |
| true        | 其它 state 变化                                                | —                                            | **不变**(锁住)                                                      |

**触发字符 → state 白名单**(在 catalog 里维护,见 §5.2):

| Trigger | state 白名单        |
| ------- | ------------------- |
| `/`     | `shell_idle`、`tui` |
| `:`     | `editor`、`pager`   |

不在白名单 → 不触发。这避免了"用户在 long_process 里随便敲 `/` 弹出无意义清单"。

## 5. Catalog 数据结构

### 5.1 Entry

```ts
interface Entry {
  /** 在弹层中显示的主文本,例如 "claude --resume" / ":wq"。 */
  label: string;
  /** 选中后**写回 textarea 的完整内容**(覆盖,不追加)。 */
  insert: string;
  /** 可选副标题,小字灰色,例如 "Resume last claude session"。v1 不强求填。 */
  hint?: string;
}
```

`insert` 是完整 textarea 值,不只是"trigger 之后的部分"。即用户敲 `/`,选中 `claude` → textarea 变成 `claude`(注意:**不带** 前导 `/`,因为 `/` 只是触发符,不是命令的一部分;唯一例外是 ex 命令 `:wq` 这种,它本身就以 `:` 开头,所以 insert 就是 `:wq`)。

### 5.2 Catalog 形态

```ts
// catalog.ts
type Bucket = {
  trigger: "/" | ":";
  state: ShellState;
  /** 可选:仅在 paneCurrentCommand 匹配此 cmd 时启用(精确匹配)。
   *  缺省 = 该 state 下所有 cmd 都用。 */
  cmd?: string;
  entries: Entry[];
};

export const CATALOG: Bucket[] = [
  {
    trigger: "/",
    state: "shell_idle",
    entries: [
      { label: "claude", insert: "claude" },
      { label: "claude --resume", insert: "claude --resume" },
      { label: "codex", insert: "codex" },
      { label: "git status", insert: "git status" },
      { label: "git log --oneline -10", insert: "git log --oneline -10" },
      { label: "htop", insert: "htop" }
    ]
  },
  {
    trigger: "/",
    state: "tui",
    cmd: "claude",
    entries: [
      { label: "/help", insert: "/help" },
      { label: "/model", insert: "/model" },
      { label: "/clear", insert: "/clear" },
      { label: "/exit", insert: "/exit" },
      { label: "/init", insert: "/init" },
      { label: "/review", insert: "/review" }
    ]
  },
  {
    trigger: "/",
    state: "tui",
    cmd: "codex",
    entries: [
      { label: "/help", insert: "/help" },
      { label: "/model", insert: "/model" },
      { label: "/clear", insert: "/clear" },
      { label: "/exit", insert: "/exit" }
    ]
  },
  {
    trigger: ":",
    state: "editor",
    cmd: "vim",
    entries: [
      { label: ":w", insert: ":w" },
      { label: ":wq", insert: ":wq" },
      { label: ":q!", insert: ":q!" },
      { label: ":set paste", insert: ":set paste" },
      { label: ":set nopaste", insert: ":set nopaste" },
      { label: ":vsplit ", insert: ":vsplit " }
    ]
  },
  {
    trigger: ":",
    state: "editor",
    cmd: "nvim",
    entries: [
      /* 同 vim */
    ]
  },
  {
    trigger: ":",
    state: "pager",
    entries: [
      { label: ":n", insert: ":n" },
      { label: ":p", insert: ":p" },
      { label: ":q", insert: ":q" }
    ]
  }
];
```

**查找算法**(`resolveBucket(trigger, state, cmd)`):

1. 精确匹配 `trigger + state + cmd`。
2. 退化到 `trigger + state`(无 cmd 字段的 bucket)。
3. 都没有 → 返回空数组(=不触发)。

**前缀过滤**:用户敲 `/cl` → 过滤出 `claude`、`claude --resume`(label 以 `cl` 开头,大小写不敏感)。
**截断**:过滤后取前 6 条。

## 6. Suggestions 组件

### 6.1 props

```tsx
interface SuggestionsProps {
  entries: Entry[];
  highlightIndex: number;
  onPick(entry: Entry): void;
  onHighlight(index: number): void;
  onDismiss(reason: "outside" | "esc"): void;
  /** 用于把面板锚定到 textarea 上方。 */
  anchorRef: React.RefObject<HTMLElement>;
}
```

### 6.2 定位

不用 portal,直接相对 ComposeBar 容器定位。ComposeBar 容器加 `position: relative`,Suggestions 用 `position: absolute; bottom: 100%;` 贴在 textarea 顶边正上方,`left: 0; right: 0;`(同宽)。

z-index = 999(KeyOverlay 是 1000,SessionDrawer 是 40)。

### 6.3 交互

| 事件                         | 行为                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| 点击候选项                   | `onPick(entry)`                                                                        |
| 鼠标悬停候选项               | `onHighlight(index)`(PC)                                                               |
| 触屏:点击面板外              | `onDismiss("outside")`(用 `pointerdown` 在 `document` 上一次性监听,active=true 时才挂) |
| ComposeBar textarea 上 ↑↓    | 拦截,改 highlightIndex(active 时);否则放行(光标在 textarea 内移动)                     |
| ComposeBar textarea 上 Enter | active 时 → `onPick(entries[highlight])`;否则原生发送                                  |
| ComposeBar textarea 上 Esc   | active 时 → `onDismiss("esc")`;否则原生                                                |
| ComposeBar textarea 上 Tab   | **始终放行**(不抢)                                                                     |

注意 ↑↓ Enter 拦截**只在 active=true 时**。这避免破坏既有 ComposeBar 行为。

### 6.4 渲染

```tsx
<ul className="tm-suggestions" role="listbox" aria-label="suggestions">
  {entries.map((e, i) => (
    <li
      key={e.label}
      role="option"
      aria-selected={i === highlightIndex}
      data-active={i === highlightIndex}
      onPointerDown={(ev) => {
        ev.preventDefault();
        onPick(e);
      }}
      onMouseEnter={() => onHighlight(i)}
    >
      <span className="tm-suggest-label">{e.label}</span>
      {e.hint && <span className="tm-suggest-hint">{e.hint}</span>}
      <span className="tm-suggest-enter" aria-hidden>
        ⏎
      </span>
    </li>
  ))}
</ul>
```

`onPointerDown + preventDefault` 是关键:阻止 textarea 失焦,避免选中时键盘弹起又落下(手机 iOS 尤其敏感)。

### 6.5 样式(tokens.css 增量)

```css
.tm-compose-wrap {
  position: relative;
} /* ComposeBar 顶层容器 */

.tm-suggestions {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100%;
  margin-bottom: 6px;
  z-index: 999;
  background: var(--bg-elev, #14171d);
  border: 1px solid var(--line, #232832);
  border-radius: 8px;
  box-shadow: 0 -4px 12px rgb(0 0 0 / 0.35);
  max-height: calc(6 * 44px);
  overflow-y: auto;
  animation: tm-suggest-in 80ms ease-out;
}
.tm-suggestions li {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 12px;
  font-family: var(--term-font-family);
  font-size: 13px;
  cursor: pointer;
}
.tm-suggestions li[data-active="true"],
.tm-suggestions li:hover {
  background: var(--bg-elev-hi, #1c2029);
}
.tm-suggest-label {
  flex: 1;
  color: var(--ink, #e7ecf3);
}
.tm-suggest-hint {
  font-family: -apple-system, sans-serif;
  font-size: 11px;
  color: var(--ink-dim, #8891a0);
}
.tm-suggest-enter {
  font-size: 11px;
  color: var(--ink-dim, #8891a0);
}

@keyframes tm-suggest-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

## 7. 与 KeyOverlay 的协调

KeyOverlay 已是 `z: 1000`,Suggestions `z: 999`。两者**理论上可以共存**(KeyOverlay 在上面,Suggestions 在下面),但视觉乱。简单办法:

- ComposeBar 订阅 `overlayOpen`(已经在 App.tsx 有了),通过新加 prop `keyOverlayOpen` 传给 `useCompletion`。
- 当 `keyOverlayOpen === true`,`useCompletion` 强制 active=false。

不需要在 KeyOverlay 内部做任何改动。

## 8. ComposeBar 改动清单

ComposeBar.tsx 的最小侵入:

```diff
+ import { Suggestions } from "./completion/Suggestions.js";
+ import { useCompletion } from "./completion/use-completion.js";

  export function ComposeBar({ onSend, keyOverlayOpen }: Props) {
    const [value, setValue] = useState(...);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const shellState = useShellStateStore((s) => s.current);

+   const completion = useCompletion({
+     value,
+     shellState,
+     disabled: keyOverlayOpen
+   });

    const handleKeyDown = (e) => {
+     if (completion.active) {
+       if (e.key === "ArrowDown") { e.preventDefault(); completion.moveHighlight(+1); return; }
+       if (e.key === "ArrowUp")   { e.preventDefault(); completion.moveHighlight(-1); return; }
+       if (e.key === "Enter" && !e.shiftKey) {
+         e.preventDefault();
+         pickAndContinue(completion.entries[completion.highlightIndex]);
+         return;
+       }
+       if (e.key === "Escape")    { e.preventDefault(); completion.dismiss("esc"); return; }
+     }
      if (e.key === "Enter" && !e.shiftKey) { /* 原有发送 */ }
    };

+   const pickAndContinue = (entry) => {
+     setValue(entry.insert);
+     completion.dismiss("pick");
+     textareaRef.current?.focus();
+   };

    return (
-     <div className="...">
+     <div className="tm-compose-wrap ...">
+       {completion.active && (
+         <Suggestions
+           entries={completion.entries}
+           highlightIndex={completion.highlightIndex}
+           onPick={pickAndContinue}
+           onHighlight={completion.setHighlight}
+           onDismiss={completion.dismiss}
+           anchorRef={textareaRef}
+         />
+       )}
        <textarea ref={textareaRef} value={value} ... />
      </div>
    );
  }
```

App.tsx 把现有 `overlayOpen` 透传:

```diff
- <ComposeBar onSend={(text) => send({ type: "send_compose", text })} />
+ <ComposeBar
+   onSend={(text) => send({ type: "send_compose", text })}
+   keyOverlayOpen={overlayOpen}
+ />
```

## 9. 可观测性

`use-completion.ts` 内 emit `console.debug("[completion]", event, payload)`:

```
[completion] open    { state, cmd, trigger, count: 6 }
[completion] pick    { state, cmd, trigger, index: 2, picked: "git status" }
[completion] dismiss { state, cmd, trigger, reason: "esc" }
```

不接 backend、不存指标。后续切片可加。

## 10. 测试矩阵

### 10.1 单测(Vitest + jsdom)

`tests/frontend/compose/completion/`

| 文件                     | 覆盖                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `catalog.test.ts`        | `resolveBucket()` 精确 / 退化 / 缺失;前缀过滤大小写;截断 6 条                                                   |
| `use-completion.test.ts` | 触发(白名单内/外);锁定(state 变化不影响);删触发字符自动 dismiss;隐私 state 强制 dismiss;`disabled` 强制 dismiss |
| `Suggestions.test.tsx`   | 渲染条目;点击触发 onPick;`pointerdown.preventDefault` 阻止失焦;`role=listbox`/`option` 可访问性                 |
| `ComposeBar.test.tsx`    | 已有文件加新用例:`/` 弹面板;Enter 选中第一条填入(不发送);删 `/` 关闭;Esc 关闭;Tab 不抢                          |

### 10.2 e2e(Playwright)

`tests/e2e/phase2_6_compose_completion.spec.ts`(新建)

| 场景                                    | 期望                                          |
| --------------------------------------- | --------------------------------------------- |
| shell_idle 下敲 `/`                     | 弹层出现,首条 = `claude`                      |
| `/cl` 过滤                              | 弹层只剩 `claude` 系                          |
| 点击 `git status`                       | textarea 变成 `git status`,弹层消失           |
| 弹层期间按 Enter                        | textarea 被填,**不发送**(`pty.writes` 无新增) |
| 删除 `/`                                | 弹层消失                                      |
| 进入 alt-screen + cmd=vim,敲 `:`        | 弹出 vim ex 命令清单                          |
| password_prompt 状态(伪造 tail)+ 敲 `/` | 不弹(隐私闸门)                                |
| KeyOverlay 打开期间敲 `/`               | 不弹                                          |

## 11. 性能 / 大小

- catalog 体积 < 2KB(<30 条 entries)
- Suggestions 组件本身 < 3KB minify 后
- `useCompletion` 在 ComposeBar `value` 每次变化时跑一次,O(catalog.length) 线性扫描。catalog 小,纳秒级。
- 总 bundle 增量预计 < 6KB gzip。

## 12. 不在本设计内 / 留给 v1.1+

- MRU(IndexedDB)
- typeahead 触发(任何字符 ≥ 1)
- 模糊搜索
- 后端 RPC `query_pane_path` / binary 探测
- catalog 的 hot reload / 用户自定义
- 跨设备同步

## 13. 落地顺序

见 `docs/plans/0009-phase-2.6-plan.md`。
