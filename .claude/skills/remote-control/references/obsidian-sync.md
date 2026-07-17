# Making your Obsidian vault reachable by /remote-control

Obsidian stores your vault as plain Markdown files on the device where it
runs. Claude can't reach into your laptop or phone directly — the vault has to
sync to a place Claude's connectors can see. Two options, best first.

## Option A — Sync to GitHub (recommended)

Full read **and write** access: Claude can read notes, search the whole vault,
and save new notes back that appear on all your devices on next sync.

1. Create a **private** GitHub repo for the vault, e.g. `morrisstephon51/vault`.
2. In Obsidian (desktop): Settings → Community plugins → Browse →
   install **Git** (the "obsidian-git" plugin) and enable it.
3. Open a terminal in the vault folder and connect it to the repo:
   ```
   git init
   git remote add origin https://github.com/morrisstephon51/vault.git
   git add -A && git commit -m "initial vault sync"
   git push -u origin main
   ```
4. In the plugin settings, turn on auto-commit + auto-push (e.g. every
   10 minutes) and auto-pull on startup.
5. On mobile, the Git plugin also works (iOS/Android) — same repo, or just
   read/write through Claude and let desktop sync pick it up.
6. Make sure the vault repo is enabled for Claude's GitHub app/connector, then
   run `/remote-control` — it will discover the vault automatically.

## Option B — Sync to Google Drive (read-mostly)

Simpler, but Claude's Drive connector is best for reading; new notes written
from Claude land in Drive, not directly in the vault folder structure.

1. Install Google Drive for Desktop on the machine that has the vault.
2. Move (or mirror) the vault folder into your Drive folder.
3. Confirm the Google Drive connector is enabled in claude.ai → Settings →
   Connectors.
4. Run `/remote-control` — it searches Drive for the vault by folder name.

## Multiple vaults

Repeat either option per vault. `/remote-control` discovers every vault it can
see and lists them all in the dashboard; name the vault in your command when
you have more than one ("search my *work* vault for ...").
