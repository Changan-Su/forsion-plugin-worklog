---
name: worklog-report
description: Use when the user asks to draft, polish, or audit a weekly work report inside Forsion; provides the worklog file layout and the activity-log line grammar.
---

# Weekly work reports in Forsion

The WorklogReporter plugin turns the user's own local activity log into a weekly report
draft. This skill tells you where those files live, what is in them, and what you must not
break when you edit them.

## 1. Where the files are

- **Report** — `<work folder>/Reports/YYYY-Www.md`. A plain Markdown note: read it, edit it,
  link to it like any other note. `YYYY-Www` is the ISO 8601 week (`2026-W33`), so the week
  number belongs to the ISO year, which can differ from the calendar year around New Year
  (`2025-12-29` is already `2026-W01`; `2027-01-03` is still `2026-W53`).
- **Sidecar** — `<work folder>/.worklog/YYYY-Www.json`. Machine-readable material for the
  same week. Hidden directory, so it does not show up in the file tree.
- **Overflow versions** — `<work folder>/Reports/YYYY-Www-v2.md`, `-v3`, … are written when
  the user declined to overwrite a hand-edited report. They are real reports, not backups.
- `<work folder>` is the plugin's work-folder setting; its default is the plugin's display
  name. Never hardcode a different folder.

The report's shape:

```markdown
# 2026-W33 周报

> 2026-08-10 ~ 2026-08-16 ｜ 模板:通用三段式 ｜ 生成于 2026-08-14 21:30

## 本周完成

- …

## 进行中

- …

## 下周计划

- …

---

## 素材出处

- 2026-08-13 11:20 `note.edit` [[Notes/架构评审.md]] L6-29
- 2026-08-12 09:00 (手工补录) 和 X 对齐了 Q3 目标
```

## 2. Sidecar fields

```jsonc
{
  "v": 1,
  "week": "2026-W33",
  "range": { "from": "2026-08-10", "to": "2026-08-16" },
  "scannedAt": 1755180000000,
  "template": "generic3",
  "items": [ /* see below */ ],
  "stats": { "total": 712, "kept": 63, "droppedPlugin": 561, "droppedOther": 85, "unparsed": 3 },
  "excerpts": { "Notes/架构评审.md": "…truncated body of that note…" },
  "report": { "generatedAt": 1755180600000, "hash": "a91f3c0e", "chars": 1820 }
}
```

Each `items[]` entry:

| field | meaning |
|---|---|
| `id` | stable across re-scans; the only thing that lets a re-scan keep the user's ticks |
| `ts` / `ms` | `YYYYMMDDHHmm` from the log, and its **local-time** milliseconds |
| `event` | the raw activity event name (`note.edit`, `chat.new`, …) or `manual` |
| `kv` | the raw key/value pairs from the log line |
| `text` | the log line's trailing free text, or the user's own text for manual entries |
| `src` | `log` (derived from the activity log) or `manual` (typed by the user) |
| `link` | vault-relative path when the event points at a vault file; empty otherwise |
| `picked` | whether the user ticked this item |
| `note` | the user's own annotation on this item |

**`picked`, `note`, and every `src: "manual"` item are user data, not derived data.**
Read the sidecar before rewriting it and carry those fields over verbatim. A re-scan is
allowed to drop a `log` item that no longer appears in the log; it is never allowed to drop
a `manual` item or to reset a tick. Unknown top-level keys must survive a rewrite too.

## 3. The activity log the material comes from

Read-only input, and it lives **outside the vault**:

- `~/.forsion/activity/<YYYY-MM-DD>.log` in production, `~/.forsion-dev/activity/<YYYY-MM-DD>.log`
  in dev mode. Both may exist; merge them and drop duplicate lines.
- One file per **local** date. Only the last 30 days are kept — older weeks cannot be
  rebuilt, only read from already-archived reports.

Line grammar:

```
line   := TS SP EVENT ( SP PAIR )* ( SP FREETEXT )?
TS     := [0-9]{12}                  # YYYYMMDDHHmm, local time, minute resolution
EVENT  := ^[a-z][a-z0-9:._-]*$
PAIR   := KEY '=' ( BARE | '"' QUOTED '"' )
KEY    := [a-zA-Z][a-zA-Z0-9_]*
BARE   := no whitespace, '"' or '='
QUOTED := no '"' (the writer replaces inner quotes; there is no escape form)
FREETEXT := '"' … '"'                # trailing text only, <= 40 chars
```

The writer caps a single value at 80 chars and a whole line at 200, so a truncated line can
end in an unclosed quote. That is a normal line, not a broken one.

Only these events carry work signal; everything else — and every event whose name starts
with `plugin:` — is noise and gets filtered out before the model ever sees it:

`chat.new` `chat.send` `run.done` `agent.edit` `note.edit` `note.create` `file.save` `view.open`

Two different meanings of `f=`:

- `note.edit` / `note.create` / `view.open` / `file.save` → **vault-relative path**. You can
  read it and link to it.
- `agent.edit` → a workspace/project path. Reading it as a vault path returns nothing; that
  is expected, not an error.

`note.edit` gives you a path and a line range, never content. To say what actually happened
you must read the note itself — the log is a manifest, not a narrative.

## 4. Editing discipline

When the user asks you to polish, shorten, or audit a report:

1. **Keep the `## 素材出处` / `## Sources` heading exactly as it is — together with the `---`
   rule line right above it.** Those two literals are the anchors the plugin uses to split the
   body from the provenance list and to decide whether the user has edited the report, and the
   rule line is what tells the plugin "this section is mine". Renaming or translating the
   heading breaks both; dropping the `---` makes the plugin treat the provenance list as part
   of the body (harmless, but it will then ask before every overwrite). Conversely, a
   `## 素材出处` heading you write *inside the body* — with no `---` above it — is left alone
   and never truncates what follows.
2. **Do not reorder or rename the section headings.** They come from the template the user
   picked, and the archive diff compares reports section by section.
3. **Never add numbers the material does not contain.** No invented metrics, dates, head
   counts, or percentages. If a section has no material, say so in one line.
4. A report is written in whatever language it was generated in. Do not translate an
   archived report, even if the UI language has changed since.
5. Lines like `<!-- a 3 -->` are Amadeus block markers. Leave them alone; they are structure,
   not content.

## 5. Tools

Use the ordinary file read/write tools for the report and the sidecar. Reading the activity
log needs `run_bash` (it is outside the vault) and must stay read-only: `cat` and `ls` on the
two activity directories, nothing else, and never a write, move, or delete.
