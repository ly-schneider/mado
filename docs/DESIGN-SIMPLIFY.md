# Design pass 2: simpler, black and white

Applies to the Figma file `Q0njSllqKRnt7nnpPvMO0X` first, then to the code. References: Linear issue view, Craft tasks, Todoist, Lightfield (Mobbin).

## Foundations (done in Figma)

- Surfaces and text are pure neutral greys (no warm tint). Dark page `#0a0a0a`, light page `#ffffff`.
- One accent, freely chosen by the user (colour picker). Default Blue `#58a0f9` dark / `#2867e3` light. Used only for links, focus and selection. The Figma `Accent` collection modes (Blue, Violet, Green, Pink) are samples.
- Icons: Microsoft Fluent UI System Icons, Regular weight, 20px grid drawn at 16px (`@fluentui/react-icons` in code). Status and priority glyphs stay custom.
- Board cards: key + assignee, status + title. No meta row, no outline (raised tone only).
- Task rows: priority, key, status, title, date, assignee. No label chips, no PR number.
- Sidebar: workspace, Inbox, My tasks, project (Tasks, Wiki, Leads), top-level Pages, Settings. Connected agents and Trash live in Settings; profile and theme in the workspace menu.

## Screen rules

1. One header line: breadcrumb (max two levels) left, at most one primary button plus icon buttons right. Filter and Display collapse into a single icon button.
2. Remove explanatory captions and footnotes from screens ("Agent writes are grouped by session", footers with key hints, status bars, "Postgres full-text · 84 ms").
3. No boxed side panels for properties: properties become a row of pills under the title.
4. Merge sibling lists (Linked docs + Development → one "Linked" list).
5. Drop secondary meta (sources, counts, stats blocks) where the primary content already carries the meaning.
6. Keep every primary action reachable (palette, ⋯ menu). Removing UI never removes a feature.

## Per screen

### Web
- Board (19:2): header = breadcrumb, Board/List, one filter icon button, New task. Remove the filter row. Column headers: icon, name, count only (no + / ⋯).
- Task detail (22:595): remove the right Properties panel and the Agent access card; add a pill row under the title (status, priority, assignee, labels, epic). Merge Linked docs and Development into one "Linked" list. Activity: drop the session note and the MCP/GitHub chips. Header right: copy link and ⋯ only.
- Wiki (24:820, light 38:3305): keep "On this page" only in the right rail (drop Linked from + Page stats; backlinks move below the document as a short "Linked from" list). Remove the bottom status bar. Header right: edited-by line, Share, ⋯.
- List + palette (26:1005): same header as Board. Palette: drop the footer hint row.
- Consent (27:1548): drop the Registered row and the three-facts list (one line: "Deletes are soft. Purge is never grantable."). Keep picker, expiry, Deny/Approve.

### Desktop
- My tasks (28:2): remove the bottom status bar and the agent suggestion card in the detail pane.
- Revision history (29:546): drop the "added since / removed" legend above the title.
- Quick capture (30:721): remove the caption above the panel and the hint row (keep Create button bottom right).
- Connected agents (31:751): remove the footnote under the table and the Last used column.
- Leads (32:977): list rows drop the Source column; detail keeps contact fields, notes, AI analysis and Draft.

### iOS
- My tasks (34:2): remove the agent banner; rows keep title + key line only (no label chip, no date).
- Quick capture (35:186): property pills only for project, status, priority.
- Task detail (34:213): keep; property pills in one wrapped row.
- Wiki (37:277): keep.
- Search (35:351): remove the "Postgres full-text" footer.
