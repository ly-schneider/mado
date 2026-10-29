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

# Pass 3: every remaining screen (web, iOS PWA, desktop)

Same rules as above, applied app-wide. Mobbin references per group:

- Settings (web): Quo account settings, Snowflake settings, hilos workspace modal. Page title only (no subtitle under it). Rows are `label · control`; a one-line description only where the row isn't self-explanatory (e.g. "Key" explains IDs are never reused). No group descriptions, no explanatory paragraphs (AI "What leaves the server" becomes one line under the key field). Members: list rows with role and a ⋯ menu (remove), "Invite" primary button top right; invite links as a compact list (hilos).
  - https://mobbin.com/screens/73082ea5-d970-4d71-aa6d-317b40cc2fd1 · https://mobbin.com/screens/19c8d00a-91ab-4a8e-908b-f037ce7a3a4d · https://mobbin.com/screens/a325096b-cd0e-4c42-984b-3debd27601f3 · https://mobbin.com/screens/d1e224bf-6308-4010-8a47-506f2a89662a
- Settings (iOS): Family app settings. Large title, grouped rows with icon, label and value/chevron. No subtitles under titles.
  - https://mobbin.com/screens/133637f4-e027-47df-88a3-452ac9350f51
- Inbox (iOS + web): GitHub iOS inbox, Public inbox. Large title, filter chips (All / Unread / Archived), rows: unread dot left, actor + title, one muted line, time right; group by Today / Earlier. Web keeps the split view with the same row anatomy.
  - https://mobbin.com/screens/c4f3b089-df19-4c84-a52b-1a75b389f03a · https://mobbin.com/screens/a6751b2f-6f73-4d79-90d8-bd6d9ffc30f4
- Lead detail (CRM): Attio record, Quo contact panel. Header: company name + stage pill + ⋯. Then label/value rows (Contact, Email, Source, Last contact), notes, AI analysis and Draft as plain sections (no boxed cards around everything; one subtle surface for the draft text).
  - https://mobbin.com/screens/b646ac90-19c2-455c-9b7f-2fa490403c27 · https://mobbin.com/screens/feceab4f-4207-4d69-9efa-b2922cc3a6ff
- Capture sheet (iOS): Google Calendar new task sheet. ✕ left, primary "Add" pill right, big title input, segmented kind as chips, properties as rows/pills, nothing else.
  - https://mobbin.com/screens/fcc8e570-ed43-4565-b7dd-c0d89fd489b9
- Auth (login, setup, onboarding, invite): Linear login (centred mark, one question per screen, one primary button, no footers).

App-wide consistency:
- Every in-app screen uses `PageHeader` with a breadcrumb (`Project › Section` or `Settings › Section`), never a free-standing title in the header. Leads, Inbox, Search and Wiki index included.
- Phone: large title equals the section name (Tasks, Wiki, Leads, Inbox, Settings), the workspace/project goes into the small nav above it. No subtitles except one count line where useful ("4 open").
- Empty states: one short line, no icon blobs or paragraphs.
- Desktop app (Tauri): same screens; title bar areas use `drag-region`, traffic-light inset when the sidebar is collapsed, no extra status bars.
