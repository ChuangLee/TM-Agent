# 移动端动作优先 UI 产品规格

对应 ADR-0006 / Phase 2.5。本规格锁定每种状态的卡片集、点击区尺寸、文案与视觉细节。交付 PR 时以此为准。

配套可部署原型:[`docs/prototypes/mobile-action-first-v0.1.html`](../prototypes/mobile-action-first-v0.1.html)(本规格生效前可在 `/preview/mobile-action-first-v0.1.html` 路径看真机效果)。

---

## 1 · 视觉基线

### 1.1 设计 tokens(沿用 `src/frontend/styles/tokens.css`)

| token                | 值                    | 用途                     |
| -------------------- | --------------------- | ------------------------ |
| `--bg`               | `#0c0e12`             | 整屏背景                 |
| `--bg-elev`          | `#14171d`             | 卡片/banner 底           |
| `--bg-overlay`       | `rgba(12,14,18,0.78)` | 顶部下拉层背景           |
| `--line`             | `#232832`             | 分隔线                   |
| `--ink`              | `#e7ecf3`             | 主文本                   |
| `--ink-dim`          | `#8891a0`             | 辅助文本                 |
| `--accent`           | `#7dd3fc`             | 主题强调、默认 highlight |
| `--warn`             | `#fbbf24`             | 修饰键 armed             |
| `--err`              | `#f87171`             | 修饰键 locked、危险操作  |
| `--ok`               | `#4ade80`             | 成功状态                 |
| `--term-font-size`   | 14px                  | 终端字号(已存在)         |
| `--term-line-height` | 18px                  | 终端行高(已存在)         |

### 1.2 字体与行高

- 卡片 / 按键:`--ui-font`(系统 UI sans),14px,line-height 20px。
- 终端:现有 Nerd Font stack,不动。
- 等宽回退:`--mono-font`,用于卡片里的命令文字(如 `git status`)14px,line-height 18px。

### 1.3 间距

4 的倍数:`4 · 8 · 12 · 16 · 24 · 32`。卡片内 padding `12px 16px`;卡片之间 gap `8px`;动作区域之间分隔用 1px `--line`,不用阴影。

### 1.4 动画

- 状态切换卡片带:180ms crossfade。
- 顶部下拉层:180ms `transform: translateY(-100% → 0)` + `opacity 0 → 1` 并行。
- 按键按下:60ms scale(0.96) + opacity(0.8),松手回弹 120ms。
- 全部在 `prefers-reduced-motion: reduce` 时降级为瞬时切换(只留 opacity)。

---

## 2 · 区域布局

移动端(宽 < 820px)纵向分五层,自顶向下:

| 层                  | 高度             | 说明                                                                |
| ------------------- | ---------------- | ------------------------------------------------------------------- |
| TopBar              | 48px             | 连接状态点 / session 名 / `⌃` 菜单;`?` 徽章出现在 confidence=low 时 |
| Surface(终端)       | 1fr(不小于 40vh) | 终端主体,native scroll                                              |
| PromptBanner(条件)  | 0 或 80–120px    | 状态为 `confirm_prompt` / `password_prompt` 时替换 ActionPanel      |
| ActionPanel(卡片带) | 96px             | 上半行高频卡 + 下半行二级卡,横向滚动                                |
| ActionRail(永驻)    | 52px             | `⌨` / `✎` / 状态关键键(例如 editor 状态下的方向键)                  |

桌面端(≥ 820px)维持 Phase 1 布局不变;ActionPanel / KeyOverlay 不渲染。

---

## 3 · ActionPanel 规格

### 3.1 卡片物理规格

- 高度:44px(上下行各 44px,中间 gap 8px,总 96px)。
- 最小宽度:64px;最大宽度:180px(按 label 长度自适应)。
- 圆角:8px。
- 背景:`--bg-elev`;按下:`--bg-elev` 叠加 12% white overlay。
- 字号:14px。

### 3.2 卡片交互

- **单击**:发送 `payload` 并追加 `\r`(如 payload 是命名按键 `Escape`,发送对应转义)。触觉反馈 `navigator.vibrate(10)`。
- **长按 500ms**:不发送,把 payload 作为文字填入 compose bar 并 focus。触觉反馈 `vibrate(30)`。
- 单击即发送意味着**必须避免误发危险命令**。原则:学习历史卡不显示 `rm -rf` / `sudo rm` / `git push --force` 等 regex 黑名单条目(仅显示于长按菜单)。
- 滚动时按住不触发点击(和 iOS / Android 原生一致,pointer cancel 机制)。

### 3.3 每种状态的卡片集(锁定)

#### `shell_idle`

默认 8 张(按优先级)+ 剩余按频次。

| Slot | label         | payload                                   | 来源              |
| ---- | ------------- | ----------------------------------------- | ----------------- |
| 1    | `↑ 历史`      | `__HISTORY__` (特殊 payload,打开历史选择) | 固定              |
| 2    | `Tab`         | `\t`                                      | 固定              |
| 3    | `ls`          | `ls\r`                                    | 用户可 pin / 学习 |
| 4    | `clear`       | `clear\r`                                 | 学习              |
| 5    | `git st`      | `git status\r`                            | 学习              |
| 6    | `git diff`    | `git diff\r`                              | 学习              |
| 7    | `npm run dev` | `npm run dev\r`                           | 学习              |
| 8    | `cd ..`       | `cd ..\r`                                 | 学习              |

右侧固定:`⌨` / `✎`(在 ActionRail 层,不在卡片带)。

#### `editor`(vim / nvim / nano / micro / hx)

vim/nvim:

| Slot | label | payload   |
| ---- | ----- | --------- |
| 1    | `Esc` | `\x1b`    |
| 2    | `:w`  | `:w\r`    |
| 3    | `:q`  | `:q\r`    |
| 4    | `:wq` | `:wq\r`   |
| 5    | `i`   | `i`       |
| 6    | `/`   | `/`       |
| 7    | `gg`  | `gg`      |
| 8    | `G`   | `G`       |
| 9    | `dd`  | `dd`      |
| 10   | `yy`  | `yy`      |
| 11   | `p`   | `p`       |
| 12   | `u`   | `u`(undo) |

方向键永驻在 ActionRail(editor 状态下方向键高频)。

nano 替换:`Esc` / `^O` / `^X` / `^K` / `^U` / `^W` / `^G` / `^C`(发送 `\x1b` / `\x0f` / `\x18` / `\x0b` / `\x15` / `\x17` / `\x07` / `\x03`)。

#### `tui`(claude / aider / htop / btop / lazygit / ranger / fzf / k9s / 未知 alt)

| Slot | label    | payload |
| ---- | -------- | ------- |
| 1    | `Esc`    | `\x1b`  |
| 2    | `y`      | `y`     |
| 3    | `n`      | `n`     |
| 4    | `/`      | `/`     |
| 5    | `?`      | `?`     |
| 6    | `Enter`  | `\r`    |
| 7    | `Ctrl+C` | `\x03`  |
| 8    | `q`      | `q`     |

方向键永驻在 ActionRail。

#### `repl`(python / node / bun / irb / ghci)

| Slot | label        | payload                                    |
| ---- | ------------ | ------------------------------------------ |
| 1    | `↑ 历史`     | `__HISTORY__`                              |
| 2    | `Tab`        | `\t`                                       |
| 3    | `.exit`      | `.exit\r`(python: `exit()\r`)              |
| 4    | `.help`      | `.help\r`(python: `help()\r`)              |
| 5    | `.clear`     | `.clear\r`                                 |
| 6    | 语言关键字 1 | 如 node `const`,python `import`,ruby `def` |
| 7    | 语言关键字 2 | node `let`,python `def`,ruby `class`       |
| 8    | 语言关键字 3 | node `function`,python `class`             |

关键字卡长按 → 填 compose bar。

#### `pager`(less / more / man 或 git 派生 pager)

| Slot | label   | payload |
| ---- | ------- | ------- |
| 1    | `Space` | ` `     |
| 2    | `b`     | `b`     |
| 3    | `/`     | `/`     |
| 4    | `n`     | `n`     |
| 5    | `q`     | `q`     |
| 6    | `G`     | `G`     |
| 7    | `gg`    | `gg`    |
| 8    | `?`     | `?`     |

方向键在 ActionRail。

#### `long_process`

卡片带被单张大卡片替换:

```
┌────────────────────────────────────┐
│  ⏹  Ctrl + C                       │
│     停止当前进程                    │
└────────────────────────────────────┘
```

- 宽度撑满 ActionPanel 区域,高度 80px,`--err` 文字色,单击发送 `\x03`。
- 若最近 30 行检测到 `press ([a-z]) to ([^.\r\n]+)` 形式的帮助提示,**提取为右侧小卡**。比如 Vite 的 `press h to show help` → 小卡 `h`(payload `h`)。最多并列显示 3 张。

#### `confirm_prompt`

ActionPanel 被 PromptBanner 替换,规格见 §4。

#### `password_prompt`

ActionPanel 被 PromptBanner 替换,规格见 §4。

---

## 4 · PromptBanner 规格

`confirm_prompt` 或 `password_prompt` 时,ActionPanel 96px 区域被全宽 banner 取代。TopBar 的 `session 名` 右侧同步显示小红点提醒。

### 4.1 `confirm_prompt`

```
╭─── 脚本在等待: [Y/n] ───╮ ×关闭
│                         │
│ ┌────────┐  ┌────────┐  │
│ │  是    │  │  否    │  │
│ └────────┘  └────────┘  │
│                         │
│ 默认: 是 (按 Enter)      │
╰─────────────────────────╯
```

- "是 / 否" 按钮高度 48px,最小宽度 96px,圆角 8px,间距 16px。
- **默认选项**(大写那个)用 `--accent` 实心背景;另一个边框 + 透明背景。
- 点"是" = 发送 `y\r`;点"否" = 发 `n\r`(大小写映射按检测到的 `[Y/n]` vs `[y/N]`)。
- `×` 按钮关闭 banner 但不发送任何东西,ActionPanel 恢复。
- 文案细则:
  - Banner 标题:`脚本在等待: <检测到的原文>`(保留原文如 `[Y/n]` / `(yes/no)`)
  - 默认说明:`默认: <选项> (按 Enter)`
  - 按钮:中文"是/否"+ 原文字母副标签 `y` / `n`(双语可读性)

### 4.2 `password_prompt`

```
╭─── 请输入密码 ───╮
│                 │
│ ┌─────────────┐ │
│ │ ••••••••    │ │ ← <input type=password>
│ └─────────────┘ │
│                 │
│ [👁显示] [🗙取消] [发送 →]
│                 │
│ 提示: <原 prompt 文字> │
╰─────────────────╯
```

- `<input>` 高 48px,字号 16px(避免 iOS 自动 zoom),圆角 8px。
- **安全约束**:
  - `autocomplete="off"`,`spellcheck="false"`,`name="tm-agent-password"`。
  - 按键事件**不进**任何 Zustand store;`draft-store` / `history-store` 明确跳过 password 状态。
  - 发送后立即清空 input value。
  - DevTools 下 Zustand snapshot 里不应能看到密码。
- "显示"按钮切 `type=text` ↔ `type=password`;"取消"发送 `\x03`(Ctrl+C);"发送"按钮流式发送当前 value 的每个字符 + `\r`。
- "提示"文字用 `--ink-dim`,截断显示超过 40 字符的原 prompt。

---

## 5 · ActionRail 规格

固定在屏幕最底(compose bar 之上)。高度 52px。始终可见。

结构:

```
[左:方向键(editor/tui/pager 状态下显示)] [右:⌨ ✎]
```

- 方向键簇只在 `editor` / `tui` / `pager` 状态下出现,排四个按钮 40×40px,紧凑在左侧。其他状态下左侧显示 `↑历史` + `Tab`。
- 右侧 `⌨` 和 `✎` 按钮 48×48px,间距 8px,距右边 12px padding。
- `⌨` 按下打开 KeyOverlay;`✎` 按下打开 compose bar(和系统键盘)。互斥——一个打开时自动关另一个。

---

## 6 · KeyOverlay 规格

### 6.1 视觉

- 固定定位:`position: fixed; top: 0; left: 0; right: 0;`
- 高度:`68vh`。
- 背景:`--bg-overlay` + `backdrop-filter: blur(6px)`。
- 按键自身背景不透明:`rgba(34,38,46,0.95)`,圆角 10px,内部 padding `10px 14px`。
- 字号:功能键 14px,字母/数字键 16px,F-keys 12px。
- `z-index: 1000`。

### 6.2 区块布局(自上而下,逆优先级——拇指区在下)

1. **把手区(~5vh)**:中央一条 32×4px 圆角条做可见的"拖拽把手",点击也可关闭。
2. **状态相关键(~12vh)**:label 稍小(36px 按钮),按当前 `ShellState` 展示 6–10 个;内容即 §3.3 对应状态的前 8 条卡片,不重复 ActionRail 里已有的。
3. **修饰键(~10vh)**:`Ctrl` / `Alt` / `Shift` / `Fn`,4 个按钮并排,等宽。粘滞状态:
   - 未触发:`--bg-elev` 底
   - armed(单点):`--warn` 边框 2px
   - locked(长按 500ms):`--warn` 实心背景 + 文字加粗
4. **方向键(~14vh)**:经典田字格加中央。
5. **高频键(~20vh,拇指区)**:
   - 行 1:`Esc` / `Tab` / `Enter` / `Backspace`,每键 56×44px。
   - 行 2:`|` / `~` / `/` / `\`,同尺寸。
6. **底部行**:左 `Fn` 切换按钮(折叠 / 展开 F1–F12);右 `✎ 文字输入`。F1–F12 展开后在此区域上方插入 2 行 6 列 = 12 个 F 键,48×36px 每个。
7. **空隙 / 透视层**:底部 32vh 对应的画面区域完全透出终端(覆盖层不覆盖这一片)。

### 6.3 交互细节

- **唤起**:`⌨` 按钮点按,或从屏幕顶边(y=0 起)向下拖拽 ≥ 60px / ≤ 300ms。
- **关闭**:
  - 点击底部 32vh 的透出区(事件直通到终端,但终端对"单击"无响应,所以只关 overlay 不引起副作用)。
  - 在 overlay 内上滑 ≥ 60px。
  - 点 `✎ 文字输入`(切换到 compose)。
- **粘滞修饰键**:
  - 单点:armed 状态。下一个非修饰键按下后,修饰键自动释放,发送组合。
  - 长按 500ms:locked。连续发送任意多个组合,直到再次长按同一键解锁。
  - 点击一个已 armed 的修饰键:释放(取消)。
- **F-keys 折叠区域**:默认折叠。`Fn` 切换;展开时 overlay 的高频键区域向上推 16px,F 键在下方 2 行呈现。

---

## 7 · Compose bar 规格(扩展)

### 7.1 基本结构

```
┌─────────────────────────────────────┐
│ [PromptBanner(条件)]                │ ← 状态 confirm/password 时显示
├─────────────────────────────────────┤
│ ┌─────────────────────┐ [📋] [↑] [✎↑]│
│ │ <textarea>          │              │
│ └─────────────────────┘              │
└─────────────────────────────────────┘
```

- `<textarea>` 自动 1–3 行,高度随内容增长(最多 108px,超过滚动)。
- `[📋]`:粘贴按钮(权限失败时显示 tooltip,不崩)。
- `[↑]`:历史回溯。
- `[✎↑]`:发送按钮,移动端高 48px 最小 48px 宽,满足 a11y。

### 7.2 历史

- 数据源:内存 `history-store` + 首次懒加载 `/api/history?session=<sid>`(后端 512KB 上限、路径校验、flag-gated)。
- 按当前 `ShellState` 过滤:
  - `editor`:只显示 `:` 前缀。
  - `pager`:只显示 `/` 开头的搜索。
  - `repl`:只显示本次 session 内的 compose 历史(不拉 .bash_history)。
  - 其他:不过滤。
- 交互:
  - 在**空** compose bar 按 `↑` / `↓` 步进。
  - 在有内容 compose bar 按 `↑` → 不触发,避免误删草稿。
  - swipe up(textarea 内垂直上滑 ≥ 40px)也触发历史。

### 7.3 草稿

- 每 session 一份,`{sessionId: string}` 为 key。
- 切 session 保留;刷新/重启丢失。
- `password_prompt` 状态下**草稿不写入**(避免把密码写入草稿 store)。

### 7.4 快速插入托盘(长按 compose bar 500ms)

托盘弹出小 sheet,显示三类候选(各一行,最多 3 条):

- 最近 URL:正则 `https?://[^\s]+`(最近 50 行)
- 最近路径:`/[^\s]{3,}` 不含常见非路径字符(最近 50 行)
- git 分支名:最近 30 行里 `On branch (\S+)` 或 `* (\S+)`

点一条插入到光标位置。长按 compose 的手势和"获取焦点"手势要做好区分——短按只 focus,500ms 后才弹托盘。

### 7.5 粘贴按钮

- 点按 → `navigator.clipboard.readText()` → 插入光标位置。
- 权限失败 / 浏览器不支持 → toast `"无法读取剪贴板,请长按文本框粘贴"` 并 fallback 到 `execCommand('paste')`。
- iOS Safari 首次使用会原生弹权限 sheet,属正常行为,不需额外引导。

---

## 8 · TopBar 变化

ActionPanel 所在行 + `?` 徽章 + red dot:

```
┌──────────────────────────────────────┐
│ ◉ sessions  main · vim notes.md [?]⌃ │
└──────────────────────────────────────┘
```

- 连接点 `◉`:沿用 Phase 3a 的颜色规则(绿/黄/红/灰)。
- Session 名之后显示 `· <paneCurrentCommand> <?如 altScreen 显示 . 屏幕模式>`。长度超 26 字符时截断中间。
- `[?]` 徽章:`classify()` 返回 `confidence: 'low'` 时出现,点按弹说明 sheet(解释"应用无法判断当前终端状态,已回落到通用面板")。
- 右上 `⌃` 菜单:保留 Phase 3a 的 session 菜单。

---

## 9 · 文案清单(中文,v1)

| Key                           | 文案                            |
| ----------------------------- | ------------------------------- |
| `action.panel.loading`        | 加载动作…                       |
| `action.panel.empty`          | 无可用动作                      |
| `action.history.open`         | ↑ 历史                          |
| `action.tab`                  | Tab                             |
| `overlay.pull_hint`           | 从顶部下拉打开                  |
| `overlay.compose_transfer`    | 文字输入                        |
| `overlay.modifier.armed`      | 已预备                          |
| `overlay.modifier.locked`     | 已锁定                          |
| `confirm.title`               | 脚本在等待: {prompt}            |
| `confirm.yes`                 | 是                              |
| `confirm.no`                  | 否                              |
| `confirm.default`             | 默认: {choice} (按 Enter)       |
| `confirm.close`               | × 关闭提示                      |
| `password.title`              | 请输入密码                      |
| `password.show`               | 显示                            |
| `password.hide`               | 隐藏                            |
| `password.cancel`             | 取消                            |
| `password.send`               | 发送                            |
| `password.hint`               | 提示: {prompt}                  |
| `compose.paste`               | 粘贴                            |
| `compose.paste_failed`        | 无法读取剪贴板,请长按文本框粘贴 |
| `compose.history`             | 历史                            |
| `compose.send`                | 发送                            |
| `compose.quick_insert.url`    | URL                             |
| `compose.quick_insert.path`   | 路径                            |
| `compose.quick_insert.branch` | 分支                            |
| `state.badge.unknown`         | 无法识别终端状态                |
| `long_process.stop`           | 停止当前进程                    |

英文 fallback 字符串放在 `src/frontend/lib/i18n.ts`(与中文并存,编译期切换)。v1 使用中文为默认,英文只做 fallback。

---

## 10 · 可访问性清单(v1 最小集)

- 所有按钮 `role="button"` + `aria-label` 用上述文案表。
- Overlay 打开时 `aria-modal="true"`,focus 进入 overlay;关闭时焦点回到触发按钮。
- 粘滞修饰键在 armed/locked 状态广播 `aria-pressed="mixed|true"`。
- PromptBanner 用 `role="alert"`,屏幕阅读器立即朗读。
- `password_prompt` 的 input 标注 `aria-describedby` 指向提示文字。
- `prefers-reduced-motion`:动画降级为 opacity only(见 §1.4)。
- 触摸目标最小尺寸:48×48px(符合 Apple HIG 和 Material 指南)。

Phase 6 会做完整 a11y pass,v1 只保证上述基线。

---

## 11 · 桌面 ActionPanel(紧凑布局)规格

对应 ADR-0006 §5.1 + Phase 2.5 PR2/PR3。桌面端(`matchMedia('(min-width: 820px)').matches`)渲染;移动端走 §3 的密集两行布局。

### 11.1 容器

- 位置:`App.tsx` grid 里多出一行,位于 TopBar 和 Surface 之间,`grid-template-rows: auto auto 1fr auto auto`(TopBar / ActionPanelDesktop / Surface / ComposeBar)。
- 高度:**40px**(固定);卡片高 28px,上下各 6px padding。
- 左右 padding:`12px`,和 TopBar 对齐。
- 背景:透明,下分隔线 1px `--line`。

### 11.2 卡片

- 尺寸:**28px 高 × auto 宽**,min-width 48px,padding `0 10px`,圆角 6px。
- 字号:13px,`ui-font`(命令类卡片的命令名本身用 `mono-font`)。
- 背景:`--bg-elev`;hover:`--bg-elev-hi`;active:`--bg` + accent outline 1px。
- 间距:卡片之间 gap 6px;溢出横向滚动,scroll-behavior `smooth`。
- 内容:与移动端完全相同的 §3.3 卡片集;由 `cardsForState()` 返回。

### 11.3 键盘快捷键

- 首 9 张卡片自动绑定 **`Alt+1` … `Alt+9`**(选 `Alt` 而非 `Ctrl/Cmd` 是因为后者被浏览器切标签快捷键占用)。
- 按下时:卡片短暂 highlight(80ms scale 0.97 + `--accent` border),发送 payload。
- 无视 Direct Mode 状态——Direct Mode 全局吃键盘,但 `Alt+1-9` 需要**特例放行**:在 Direct Mode 的 `keydownToBytes` 里检测 `e.altKey && /^[1-9]$/.test(e.key)`,若 ActionPanel 组件登记了对应 slot 就派发 card tap,否则按常规字母发送(Alt+1 = ESC 1)。这一条写进技术设计的 `keydown-to-bytes.ts`。
- 视觉角标:卡片 hover 时右下角显示小角标 "⌥1"(macOS 习惯)/ "Alt+1"(Windows/Linux);`navigator.platform` 判定。

### 11.4 PromptCaptureBanner(桌面样式)

- `confirm_prompt` / `password_prompt` 时替换 ActionPanel 这一行。
- 高度:自适应(48–80px,按内容撑)。不占全屏。
- `confirm_prompt`:banner 居中显示,左侧标签"脚本在等待: [Y/n]",右侧 Yes / No 大按钮(40px 高,min-width 80px,间距 12px)。
- `password_prompt`:banner 内嵌原生 `<input type="password">`(40px 高)+ 显示/隐藏切换 + 取消 + 发送按钮。所有安全约束(不进 store、发送即清空)与移动端 §4.2 相同。
- 关闭按钮 `×` 放 banner 右上。

### 11.5 长进程(`long_process`)

- ActionPanel 行不隐藏。
- 替换卡片集为单张**大号红色按钮** "⏹ Ctrl+C" + 右侧小号检测到的快捷键卡(如果 output 含 "press h to show help" 则显示 h)。
- 大号按钮的 Alt+1 仍然工作。

### 11.6 Direct Mode 下的 ActionPanel

- `body[data-direct-mode="active"]` 时 ActionPanel 一并 blur(走现有 CSS 选择器)。
- Alt+1-9 特例放行(见 §11.3);其他 keydown 被 Direct Mode 吃掉。

### 11.7 开关

- 用户可以通过 TopBar `⌃` 菜单里的"显示桌面动作栏"开关切换;`localStorage.action_panel_desktop` 存 `'0'` / `'1'`,默认 `'1'`。
- 关掉后此行不渲染,网格自动压缩 40px;开启时 180ms ease-in-out 滑入。

### 11.8 桌面文案补充

| Key                                  | 文案               |
| ------------------------------------ | ------------------ |
| `action.panel.desktop.toggle_on`     | 显示桌面动作栏     |
| `action.panel.desktop.toggle_off`    | 隐藏桌面动作栏     |
| `action.panel.desktop.shortcut_hint` | 快捷键: Alt + 数字 |

---

## 12 · 桌面直通模式 (Direct Mode)规格

对应 ADR-0006 §5 + Phase 2.5 PR6。PC only(`matchMedia('(min-width: 820px) and (pointer: fine)')`);触摸为主设备不自动显示入口。

### 11.1 入口(TopBar 按钮)

位置:桌面 TopBar 右侧,"session 菜单 ⌃" 左边,新增一个按钮。

| 模式   | 文案       | 图标         | 底色                 |
| ------ | ---------- | ------------ | -------------------- |
| 未进入 | `直通模式` | 键盘图标 `⌨` | 透明 + `--line` 边框 |
| 已进入 | `退出直通` | 关闭图标 `✕` | `--accent` 实心      |

按钮尺寸:高 32px,圆角 6px,`padding: 0 12px`,字号 13px。hover: `--bg-elev-hi`。

### 11.2 进入态视觉

启用 `body[data-direct-mode="active"]`(进入动画 200ms 之后该属性才生效),CSS 级联应用:

- **Surface**(`.tm-scroller` 及其所有子孙):完全不加滤镜,保持 100% 清晰。
- **Surface 四周光晕**:`.tm-scroller` 的 `box-shadow: 0 0 0 2px var(--accent), 0 0 32px rgba(125, 211, 252, 0.4)`,并用 `@keyframes pulse-glow` 做 3s loop(shadow 亮度 60% ↔ 100% 渐变)。
- **所有非 Surface 祖先元素**(TopBar 主体、Sidebar、ActionRail、compose bar、任何 overlay):`filter: blur(4px) grayscale(30%) opacity(0.4); transition: filter 200ms`。
- **顶部悬浮条**(`.direct-mode-indicator`):
  - 固定顶部,`position: fixed; top: 0; left: 0; right: 0; height: 40px; z-index: 2000`。
  - 背景:`--accent`;文字:`--accent-on`(深色),font-weight 600。
  - 内容:左侧 8×8px 脉冲圆点(白色 + 半透明光晕,1.2s loop)、居中文字"直通中 · 按 `Ctrl+]` 退出"。
  - 右侧小按钮"退出"(可选,便于鼠标党):透明底 + 白边框,点按等于按钮退出。
- **过渡动画**:进入 200ms ease-out(blur 0 → 4px + accent glow 0 → 100%);退出同样 200ms。`prefers-reduced-motion: reduce` 下只做 opacity 变化,不做 blur 渐变(blur 本身一步到位)。

### 11.3 键盘映射(最小集 v1)

由 `keydown-to-bytes.ts` 产出。下列键在直通态下必须能打进 PTY。

| 键                                                  | 发送字节                                  | 说明                                                                                                           |
| --------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 字母 a-z / A-Z                                      | 对应 ASCII                                | shift 状态下发大写                                                                                             |
| 数字 0-9、常见符号 `!@#$%^&*()_+-=[]{}\|;':",./<>?` | 对应 ASCII                                | shift 切换                                                                                                     |
| Enter                                               | `\r`                                      |                                                                                                                |
| Tab                                                 | `\t`                                      |                                                                                                                |
| Backspace                                           | `\x7f`                                    | xterm 约定(非 `\b`)                                                                                            |
| Delete                                              | `\x1b[3~`                                 |                                                                                                                |
| Esc                                                 | `\x1b`                                    | 裸 Esc 直接发(vim / Claude Code 用);`Shift+Esc` 才退出直通                                                     |
| 方向 ↑↓←→                                           | `\x1b[A` / `\x1b[B` / `\x1b[D` / `\x1b[C` | app-mode 暂不区分(xterm 的 `CSI ? 1 h` 时需要 `\x1bOA` 等,v1 先按 `CSI` 简单实现,bug 发现时再加 app-mode 分支) |
| Home/End                                            | `\x1b[H` / `\x1b[F`                       |                                                                                                                |
| PgUp/PgDn                                           | `\x1b[5~` / `\x1b[6~`                     |                                                                                                                |
| F1–F12                                              | `\x1bOP` ... `\x1b[24~`                   | F1–F4 用 SS3,F5+ 用 CSI(xterm 标准)                                                                            |
| Ctrl+字母                                           | `\x01`–`\x1a`                             | Ctrl+C = `\x03`,Ctrl+D = `\x04`,Ctrl+Z = `\x1a` 等                                                             |
| Alt+字母                                            | `\x1b<letter>`                            | Meta prefix,和 Emacs 习惯一致                                                                                  |
| Ctrl+Shift / Cmd+...                                | 不转发                                    | 浏览器保留或 OS 级                                                                                             |

**例外捕获**(吃掉,不发 PTY):

- `Ctrl+]`(keyCode 221 / code `BracketRight` + ctrlKey):触发 `exit()`。
- 连续两次 Esc(300ms 内):第二次 Esc 不发 PTY,触发 `exit()`。
- `Ctrl+V` / `Cmd+V`:不转发 keydown;由 `paste` 事件接管,把剪贴板内容一次性写 PTY。

### 11.4 IME 合成浮层

隐藏 `<textarea aria-hidden="true">` 作为 IME 载体,永远保持 focus(失焦即刻 refocus,除非直通态关闭)。

- 合成进行中(`compositionstart`-> `compositionend`):
  - 不转发 keydown 给 `keydown-to-bytes`。
  - 在 Surface 光标位置下方 4px 贴一个小浮层,显示 textarea 当前 value(候选词 / 拼音),背景 `--bg-elev-hi`,边框 1px `--accent`。
  - 浮层定位:通过 `term.buffer.active.cursor` 算出屏幕坐标(cell width × col + surface 左上角)。
- 合成结束(`compositionend`):整段 value 发送到 PTY,清空 textarea,关闭浮层。
- 用户按 `Esc` 取消合成(浏览器原生行为):`compositionend` 会带空 value,此时不发 PTY。

### 11.5 粘贴

- `paste` 事件在直通 active 时监听。
- `e.clipboardData.getData('text/plain')` 直接写 PTY;不经 compose-bar。
- 富文本(`text/html`)丢弃,只取纯文本,避免注入 `\x1b` 之类危险转义。

### 11.6 退出态恢复

- `exit()` 触发:
  1. 取消全局 keydown capture listener。
  2. 移除 `data-direct-mode` 属性。
  3. 隐藏悬浮条(200ms fade)。
  4. Surface 光晕 3s 停一次循环后自动移除类名。
  5. IME textarea blur 并清空。
- 退出后焦点回到原 compose-bar 或 TopBar 直通按钮(取 `exit` 触发源)。

### 11.7 无障碍

- TopBar 直通按钮:`aria-label="进入直通模式"` / `aria-label="退出直通模式"`,`aria-pressed` 反映状态。
- 悬浮条:`role="status"`,`aria-live="polite"`;内容文字被屏幕阅读器读出。
- 进入 / 退出动画:`prefers-reduced-motion: reduce` 下退化为瞬态。

### 11.8 文案补充(文案清单 §9 新增)

| Key                              | 文案                                              |
| -------------------------------- | ------------------------------------------------- |
| `direct-mode.enter`              | 直通模式                                          |
| `direct-mode.exit`               | 退出直通                                          |
| `direct-mode.indicator.title`    | 直通中                                            |
| `direct-mode.indicator.hint`     | 按 Ctrl+] 退出                                    |
| `direct-mode.indicator.exit_btn` | 退出                                              |
| `direct-mode.ime_hint`           | 输入法合成中…                                     |
| `direct-mode.browser_reserved`   | 部分系统/浏览器快捷键无法被拦截(如 Cmd+W、F11 等) |

---

## 13 · 规格锁定签字栏

| 项                                          | 状态   |
| ------------------------------------------- | ------ |
| 每状态卡片集锁定                            | ☐ 待签 |
| 文案中文版锁定                              | ☐ 待签 |
| 视觉 token 对齐现有 `tokens.css`            | ☑ 已对 |
| HTML 原型真机过手机                         | ☐ 待签 |
| 桌面 ActionPanel 规格 (§11) 锁定            | ☐ 待签 |
| 桌面直通模式 (Direct Mode)规格 (§12) 锁定   | ☐ 待签 |
| HTML 原型过 PC (ActionPanel + 直通模式模拟) | ☐ 待签 |
| 决策者签字                                  | ☐      |

签字通过后,规格进入"冻结"状态,PR2–PR5 按此执行。后续修改走 Change Request 流程,追加到本文件末尾。
