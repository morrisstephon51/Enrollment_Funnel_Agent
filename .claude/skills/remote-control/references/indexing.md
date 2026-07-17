# Index spec — vault and Drive catalogs

Purpose: an agent should locate any file with **one read** (the index) plus
**one fetch** (the file), instead of searching or listing everything. Keep
indexes small, current, and boring.

## Vault index — `_INDEX.md` at the vault repo root

```markdown
# Vault index — built 2026-07-17
<!-- Rebuild with /remote-control index. One line per note. -->

## projects/
- projects/plug-ai-roadmap.md — Q3 roadmap for Plug AI, milestones + owners #plugai #planning (2026-07-02)
- projects/bigheart-launch.md — BigHeart launch checklist and vendor contacts #bigheart (2026-06-28)

## daily/
- 47 daily notes, 2026-01-03 → 2026-07-16 — one per day, template format
```

Rules:
- One line per note: `path — one-line gist #tags (modified date)`. Write the
  gist from the note's title + first heading/paragraph; don't read whole files.
- Group by top-level folder, in the vault's folder order.
- **Collapse uniform folders** (daily notes, archives, attachments) to a
  single count + date-range line — never enumerate hundreds of identical files.
- Skip `.obsidian/`, attachments, and binary files (summarize as a count).
- Commit message: `index: rebuild _INDEX.md`.
- When saving a new note via /remote-control, append its line in the same
  commit as the note itself.

## Drive index — Google Doc `_CLAUDE_INDEX — Google Drive`

Lives in Drive (root), never in a Git repo — Drive filenames are personal and
repos may be public or shared.

```markdown
# Google Drive index — built 2026-07-17
Folders: name (id) — contents summary. Files: title — type, one-line gist, (id, modified)

## /  (My Drive root)
- Housing Concerns — Google Doc, housing issue notes (1o-Vwc..., 2026-07-14)

## Adjusters License/  (1lums...)
- Certificate - Stephon A. Morris.pdf — license certificate PDF (1eqxP..., 2021-12-21)
```

Rules:
- Include the Drive file **id** for every entry — that's what makes the
  one-fetch lookup work (`read_file_content` / `download_file_content` by id).
- Group by folder; give each folder its id so agents can list just that folder
  (`parentId = '<id>'`) when they need more than the index shows.
- Collapse big uniform folders (photo dumps, backups) to a count line.
- Build by paginating `list_recent_files` / `search_files` with
  `excludeContentSnippets: true`; cap the doc at roughly 300 entries and note
  what was collapsed.
- Rebuild = update the existing doc (find by title), don't create duplicates.

## Lookup protocol (both services)

1. Read the index (one call).
2. Jump to the file by path/id (one call).
3. Miss? Fall back to live search, answer the user, then offer a rebuild.
4. Stamp date >7 days old? Mention it and offer a rebuild — don't silently
   trust a stale index for "what's the latest X" questions.
