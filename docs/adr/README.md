# Architecture Decision Records

## 约定 / Conventions

- **中文为权威版本**(`<id>-<slug>.zh.md`)。当中英版本冲突时,以中文版为准 —— 决策原文用中文起草。
  Chinese (`*.zh.md`) is the **canonical** version. When the English mirror disagrees, defer to the Chinese file.
- 早期 ADR(0001–0007)同时维护中英双语;0009 起仅中文。需要英文版的 ADR 欢迎提 PR 翻译。
  ADRs 0001–0007 ship bilingual; from 0009 onward only Chinese is maintained. Contributions translating later ADRs to English are welcome.
- 编号一旦分配不复用,即使该提案被废弃。

## 编号说明 / Numbering notes

- **ADR-0008** 编号已保留给 [`docs/research/0008-web-shell-file-transfer-and-sysinfo.md`](../research/0008-web-shell-file-transfer-and-sysinfo.md) 这份调研文档(文件传输 + 系统信息卡)。该方向最终未升级为独立 ADR(吸收进 ADR-0011 / ADR-0012),因此 `docs/adr/` 中没有 0008 文件。这是**预期行为**,不是丢失。
  ADR-0008 is intentionally vacant — the proposal was scoped in [`docs/research/0008-…`](../research/0008-web-shell-file-transfer-and-sysinfo.md) and folded into ADR-0011 / ADR-0012 instead of becoming its own ADR. The number stays reserved.

## 索引 / Index

| ID   | 主题                                   | 状态     |
| ---- | -------------------------------------- | -------- |
| 0001 | Fork from tmux-mobile                  | accepted |
| 0002 | Zustand over Redux                     | accepted |
| 0003 | Freeze and select (selection UX)       | accepted |
| 0004 | Native scroll via virtual container    | accepted |
| 0005 | Headless xterm + React DOM renderer    | accepted |
| 0006 | Mobile action-first UI                 | accepted |
| 0007 | Session identity and switcher          | accepted |
| 0008 | _(reserved — see research note above)_ | —        |
| 0009 | Compose smart completion               | accepted |
| 0010 | Unified session switcher               | accepted |
| 0011 | Sidebar system status                  | accepted |
| 0012 | Sidebar file panel                     | accepted |
| 0013 | Multi-pane desktop tiling              | accepted |
| 0014 | New session wizard                     | accepted |
| 0015 | Periodic WS optimization               | accepted |
| 0016 | i18n framework                         | accepted |
| 0017 | Workspace root and install UX          | accepted |
| 0018 | Subpath deploy                         | accepted |

## 新增 ADR / Adding a new ADR

1. 取下一个未使用的整数编号(查看上表)。
2. 复制最近一份 ADR 的结构(背景 → 决策 → 替代方案 → 结果 → 后续)。
3. 在 PR 描述中链接对应的 issue / 讨论;merge 时附在 commit footer。
