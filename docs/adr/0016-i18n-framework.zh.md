# 0016. 前端多语言(i18next + 7 种 locale:en / zh-Hans / ja / ko / fr / es / de)

- 状态:accepted
- 日期:2026-04-23
- 决策者:@ChuangLee
- 相关:DESIGN_PRINCIPLES §1(一眼可辨)、CLAUDE.md "Naming"(中英混用硬编码现状)、北极星("Agent 时代的智能体控制工具,精准控制 + 卓越 UX,不是极客 webshell")、ADR-0010(unified session switcher,面板文案集中地)、ADR-0012/0013/0014(feature 级文案密度)。

## 背景

TM-Agent 当前前端是**中英混排的硬编码单语形态**:

- 依赖层**零 i18n 框架**(`package.json` 无 i18next / react-intl / lingui / formatjs)。
- 源代码约 **~200 条用户可见字符串**:英文 ~180 条(早期 tmux-mobile 遗留 + 通用按钮文案),中文 ~40 条(近期 features/sessions、features/files 的 ADR-0012/0014 交付物)。
- 文案散落在 JSX 的 `placeholder`、`title`、`aria-label`、`alert()` / `confirm()`、toast `message` 里,无集中文件。
- `src/frontend/lib/format-relative-time.ts` 是唯一的"时间格式化"工具,硬编码 `42s / 17m / 3h / 2d / 4w`,无 `Intl.*` / `date-fns` / `dayjs`。

**北极星要求"卓越 UX"**,而 "UI 是中英夹杂的字典"本身是 UX 债。Agent 工具链的用户画像横跨中文 / 英语 / 日韩 / 欧洲,不做 i18n 等于把半个市场拒门外。

### 为什么是现在

- ADR-0013(多 slot 平铺)+ ADR-0012(文件面板)+ ADR-0014(新建会话向导)连续三波 feature 注入之后,**文案密度进入稳态**,现在提取成本 = 提取 200 条,不会边提边加。再往后每多一个 feature 提取一批,技术债会复利。
- Chinese-first 的文案已经在 ADR-0014 的 NewSessionSheet 里成了既成事实;不做框架化意味着后续 feature 还会继续"中文硬编码再说",反向腐蚀英文体验。
- 成本可控:7 种语言 × ~200 条 ≈ 1400 条翻译,AI 辅助翻译 + 人工抽检 2~3 天可完成首轮。

### 不做的事

- **不国际化终端内容**。tmux pane 里流的字节是 shell / agent 自己的输出,不属于 TM-Agent 的 chrome。
- **不国际化后端错误 message 字符串**。后端继续返回英文 `message`,由前端根据 `error` 消息的上下文翻译(详见 §5)。
- **不上语言包按需分包**。7 种 locale × 200 条 ≈ 60 KB JSON → gzip 后 ~15 KB,全量打包进主 bundle 不显著增加首屏;按需分包的复杂度不值。
- **不做右到左(RTL)**。本期 7 种语言都是 LTR;如果未来要加阿拉伯语 / 希伯来语,新 ADR 评估 logical properties + `dir` 属性。
- **不做 ICU MessageFormat 复数 / 性别变体**(暂时)。i18next 内置的 pluralization 已覆盖 7 种语言的常规复数,ICU 语法的复杂度暂不需要;留后续升级路径。

## 决策

### 1. 框架与依赖

- **`i18next`** + **`react-i18next`**:最主流、生态最广、TS 类型安全最成熟。
- **`i18next-browser-languagedetector`**:自动从 `navigator.language` / localStorage / URL query 检测。
- 不用 react-intl:API 更冗长、bundle 更大、JSX `<FormattedMessage>` 风格与本项目 hooks-first 的 style 不搭。
- 不用 lingui:需要 babel macro + 编译期提取,与 Vite 7 集成路径要自己维护,ROI 低。
- 不用 format-js 的 `intl-messageformat`:同上,生态已经被 i18next 吞掉。

### 2. 语言清单(7 种)

| locale    | 语言     | 备注                              |
| --------- | -------- | --------------------------------- |
| `en`      | English  | fallback 语言,所有 key 以此为真源 |
| `zh-Hans` | 简体中文 | 核心用户群,已有大量原生文案       |
| `ja`      | 日本語   | 日本开发者 / AI 工具社区          |
| `ko`      | 한국어   | 韩国科技社区                      |
| `fr`      | Français | 欧洲 AI 工具使用者                |
| `es`      | Español  | 西语圈(含拉美)                    |
| `de`      | Deutsch  | 欧洲硬核开发者                    |

繁中(`zh-Hant`)、pt-BR、ru 暂不做,留 follow-up。

### 3. 目录结构

```
src/frontend/i18n/
├── index.ts                    ← i18next 初始化;被 main.tsx 顶部 import
├── resources.ts                ← 汇总 7 个 locale 到静态 import(保证 bundle 内联)
├── types.d.ts                  ← 基于 en.json 自动推导的 t() key 类型
└── locales/
    ├── en.json                 ← 真源,所有新 key 先在此添加
    ├── zh-Hans.json
    ├── ja.json
    ├── ko.json
    ├── fr.json
    ├── es.json
    └── de.json
```

**命名空间(namespace)**:按 feature 分,与 `src/frontend/features/*` 目录一一对应:

```json
{
  "common": { "ok": "OK", "cancel": "Cancel", "delete": "Delete", ... },
  "sessions": { "newSession": "New Session", "workingDirectory": "Working Directory", ... },
  "files": { ... },
  "compose": { ... },
  "shell": { ... },
  "terminal": { ... },
  "actionPanel": { ... },
  "auth": { ... },
  "directMode": { ... },
  "sysinfo": { ... },
  "keyOverlay": { ... },
  "errors": { "authRequired": "Please authenticate", ... }
}
```

单文件一个 locale,而非 `en/sessions.json` + `en/files.json` 拆分:200 条总量不值得按 namespace 拆文件 × 7 locale = 49 个小文件。

### 4. 语言检测 + 切换

**优先级**(i18next-browser-languagedetector 标准链,定制顺序):

1. `localStorage.getItem("tm-agent.lang")` —— 用户显式选择最高优先
2. `navigator.language` 精确匹配(`zh-CN` → `zh-Hans`,`zh-TW` → `en` fallback(本期不做繁中))
3. `navigator.language` 主语言匹配(`zh-HK` → `zh-Hans`)
4. fallback → `en`

**切换 UI**:在 `TopBar` 现有按钮群后(Direct Mode、Layout 之后)新增一个 🌐 图标按钮 → 下拉菜单 7 项。菜单项本身显示**本地化原文名**(`简体中文` / `日本語` / `한국어` / ...),不显示英文译名——用户更容易找到自己的语言。选中后 `i18n.changeLanguage(code)` + 写 localStorage,**不需要刷页面**(i18next 内置反应式)。

### 5. 后端错误消息的翻译路径

现状:后端直接发 `{ type: "error", message: "auth required" }` 等英文字面量到前端。

**决策**:保持后端英文 message 作为 **debug-oriented payload**,前端在展示层做"关键字匹配 + 翻译回退"。具体:

- 定义一个 `translateServerError(message: string): string` 工具,内部通过**字符串前缀/关键字**映射到本地化 key(`errors.authRequired` / `errors.invalidMessage` / ...)。
- 未匹配的 message 原样显示(英文),保证 forward-compat:后端加新错误不需要前端同步改也能显示。
- 未来若需彻底结构化,后端改成 `{ type: "error", code: "AUTH_REQUIRED", message: "..." }` 的结构化错误,前端按 code 查表。本 ADR **不强制后端改**,先做前端兜底。

### 6. 日期 / 数字 / 相对时间

**`format-relative-time.ts` 决策更新(2026-04-23)**:实际落地 PR6 时评估发现 `Intl.RelativeTimeFormat` 即使 `style: "narrow"` 在英文下也输出 `"15s ago"`(8 字符)——显著长于现有紧凑形态 `"15s"`(3 字符),会撑坏 SessionList 的单行栏位。最终决定**保持单字符单位后缀**(`s/m/h/d/w`)不做 locale 化,视作跨语言的技术通用写法(字节单位、CI dashboard 通用惯例)。文件头注释说明这一取舍,用户反馈强烈时再重评。

**原规划**(未执行,留作历史参考):保留纯函数签名,新增 `locale` 参数,内部用 `Intl.RelativeTimeFormat`:

```ts
export function formatRelativeTime(unixSec: number, now: number, locale: string): string {
  const diffSec = Math.floor((now - unixSec * 1000) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  if (diffSec < 60) return rtf.format(-diffSec, "second");
  if (diffSec < 3600) return rtf.format(-Math.floor(diffSec / 60), "minute");
  if (diffSec < 86400) return rtf.format(-Math.floor(diffSec / 3600), "hour");
  if (diffSec < 86400 * 7) return rtf.format(-Math.floor(diffSec / 86400), "day");
  return rtf.format(-Math.floor(diffSec / (86400 * 7)), "week");
}
```

`Intl.RelativeTimeFormat` 在所有现代浏览器内置(iOS Safari 14+、Chrome 71+、Firefox 65+),无需 polyfill。消费方(如 `SessionList`)通过 `useTranslation().i18n.language` 拿 locale。

**数字格式化**:无需,当前 UI 不展示需要分位分隔的数字(文件大小走 `formatBytes`,仍保留英文单位 `B/KB/MB/GB`——这些单位是国际通用的,不 i18n)。

**日期格式化**:FilePanel 已经在用 `toLocaleDateString()` / `toLocaleTimeString()`(如有),本身是 locale-aware 的 `Intl.*`,不需要再改。

### 7. TS 类型安全

i18next v23+ 支持基于资源对象类型推导 `t()` 的 key 字面量联合类型。配置:

```ts
// src/frontend/i18n/types.d.ts
import "i18next";
import en from "./locales/en.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: typeof en;
  }
}
```

**约束**:en.json 是真源(TS check 基于它),其他 locale 文件的 key 缺失不会编译时报错(运行时 fallback 到 en)。补救:加一个 CI 脚本 `scripts/check-locales.ts`,比较各 locale 的 key 集合,发现缺失输出 warning(不 fail CI,因为翻译总是迟到的)。

### 8. 迁移策略

**不做大爆炸式一次全替换**。分 3 个 PR:

- **PR4(基础设施)**:引入 i18next + detector,建目录,建 `en.json` 骨架(只含 `common.*`),建 TopBar 的语言切换按钮(即使暂时没 key 用,UI 先就位)。所有 feature 代码**不变**。
- **PR5(sessions + files)**:提取 `features/sessions/*` 与 `features/files/*` 下的所有用户可见字符串到 `en.json` + `zh-Hans.json`;组件内用 `const { t } = useTranslation()` 替换字面量。这两块占 ~60% 文案量,做完用户已经能感知到语言切换在核心路径上生效。
- **PR6(剩余 features)**:compose / shell / terminal / action-panel / direct-mode / auth / key-overlay / sysinfo 扫一遍,把剩余 ~80 条文案搬过去。同时把 `formatRelativeTime` 改造 locale-aware。

**PR7(5 种新 locale)**:在 PR5/PR6 把 en.json + zh-Hans.json 填稳之后,追加 ja/ko/fr/es/de:

- 用 AI 辅助翻译(Claude / DeepL)生成初版 json。
- 人工/母语者(朋友 / 社区)审一下最刺眼的 ~20 条(菜单项、按钮主文案、错误提示),其余先上。
- 加 `check-locales.ts` 脚本到 `npm run check:locales`(不入 CI gate,只在本地/PR 模板提示)。

### 9. 测试

- **单测**:
  - `translateServerError` 的关键字匹配表覆盖。
  - `formatRelativeTime` 在 en / zh-Hans / ja 三种 locale 下的输出 snapshot(抽样,不全测)。
  - 语言切换器组件:点击下拉项触发 `i18n.changeLanguage` + 写 localStorage。
- **集成测**:`render(<App />, { initialLanguage: "zh-Hans" })` helper,快照一个包含 `NewSessionSheet` 的页面,验证关键文案渲染出中文。
- **e2e**:一个 Playwright 场景,打开应用 → 切换到 `ja` → 截图 SessionList → 切回 `en` → 截图,验证 `document.documentElement.lang` 属性跟随变化(i18next 的 `useTranslation` 不会自动设,我们在 `index.ts` 订阅 `languageChanged` 事件手动设)。

### 10. 代码约束与审查

- **新 feature 代码禁止硬编码用户可见字符串**。审查 checklist 新增一条:"所有 `<Button>{...}</Button>` / `placeholder="..."` / `title="..."` / `aria-label="..."` 的文案都通过 `t(...)`?"
- **console / 开发日志 / 后端日志** 不 i18n,保持英文。
- **单元测试字面量** 不 i18n,用 `renderWithI18n` helper 时测试期望值按 en.json 写。

## 实施分期

| PR                    | 范围                                                       | 依赖                                                                  |
| --------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| #1 (对应 ROADMAP PR4) | i18next 基础设施 + 语言切换按钮 + `common.*` 骨架          | 新依赖 `i18next`、`react-i18next`、`i18next-browser-languagedetector` |
| #2 (PR5)              | sessions + files 文案迁移;完整 en.json + zh-Hans.json 首版 | #1                                                                    |
| #3 (PR6)              | 剩余 features + `formatRelativeTime` locale 化             | #2                                                                    |
| #4 (PR7)              | ja / ko / fr / es / de 5 种 locale 翻译                    | #3                                                                    |

每个 PR 独立通过 typecheck / unit / e2e,主分支随时可发布。

## 代价

- 新增 3 个前端依赖(`i18next` + `react-i18next` + `i18next-browser-languagedetector`)。gzipped 约 +30 KB。可接受。
- 每 locale JSON ~8–10 KB,7 种 = ~60 KB → gzip ~15 KB。内联主 bundle 不分包。
- 维护成本:每新加一个 feature 多写英文 key + 中文译文一条。~5 秒/条。
- 心智成本:审 PR 多看"有没有漏翻文案"一项。

## 撤销条件

- **单 PR 粒度**撤销。i18n 不是数据层改动,视觉之外零 side effect。
- 若 AI 辅助翻译质量在某个 locale 上引发抱怨 → 把该 locale json 替换为"100% 回退到 en"(key 对 key 复制 en.json),等人工翻译到位再恢复。
- 若 `Intl.RelativeTimeFormat` 在某些低端设备表现异常 → 把 `formatRelativeTime` 回退到"英文硬编码分支 + 其他 locale 走 Intl"的双路径,不撤整个 ADR。

## 后续

- **繁中(zh-Hant)** / **pt-BR** / **ru**:按用户反馈追加。
- **ICU MessageFormat**:如出现"3 files" / "3 个文件" / "3つのファイル" 这类复数差异不够用的场景,升级到 `i18next-icu` 插件。
- **Crowdin / Weblate 集成**:当社区翻译贡献者出现时考虑,目前维护者足以覆盖 7 种(AI + 抽检)。
- **后端错误结构化**(§5 伏笔):当错误种类破 30 条,再推后端同步改 `{ code, message, details }`。
- **文档 i18n**:本 ADR 只管运行时 UI。README / docs 仍按 `feedback_chinese_docs_default`(中文优先)规则走。
