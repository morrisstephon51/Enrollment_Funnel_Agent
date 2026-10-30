## Token discipline: look things up through the indexes

Morris's notes and Drive files are cataloged, so never crawl them to find something.

- **Obsidian vault** (`morrisstephon51/obsidian-kai`, branch `main`): read `_INDEX.md` at the vault root first, then open only the note it points to. Don't list, glob or grep the vault to find a note.
- **Google Drive**: read the Google Doc `_CLAUDE_INDEX — Google Drive` (id `17IdsMTLVIbhBv8RtF-qlQkZUrupBIqptowSW5_qHY9Q`) first, then fetch the file by its id. Whenever you list or search Drive, pass `excludeContentSnippets: true`.
- If the index doesn't have the item, run one targeted search for it, not a sweep, and tell Morris the index needs a rebuild.
- Rebuilds and the full protocol are in `.claude/skills/remote-control/` (`/remote-control index`).
