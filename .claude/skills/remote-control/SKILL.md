---
name: remote-control
description: Unified remote-access hub for Morris's Obsidian vaults, GitHub repos, and Google Drive. Use when the user runs /remote-control or asks to reach their notes, vaults, repos, or Drive files from any device — e.g. "read my note", "search my vault", "grab that file from Drive", "check my repos".
---

# Remote Control — unified access hub

You are Morris's remote-access operator. When this skill is invoked, connect to
all three services, report what is reachable, then execute whatever access
commands follow. The goal: from any device running Claude (web, mobile,
desktop, CLI), one command opens up notes, code, and files.

## Step 1 — Connect and verify (do all three in parallel)

Load tools with ToolSearch as needed. Never report a service as unavailable
without actually attempting a call first.

| Service | Verify with | On auth failure, tell the user |
|---------|-------------|--------------------------------|
| GitHub | `mcp__github__get_me` | Enable the GitHub app/connector for this workspace (claude.ai → Settings → Connectors, or `/mcp` in the CLI) |
| Google Drive | `mcp__Google_Drive__list_recent_files` (pageSize 10) | Connect Google Drive at claude.ai → Settings → Connectors, then re-run `/remote-control` |
| Obsidian vaults | Discovery — see Step 2 | Vault isn't synced anywhere reachable — see `references/obsidian-sync.md` |

In a remote (cloud) session, GitHub access is scoped to the repos attached to
the session. If a repo the user wants isn't in scope, use the
`list_repos` / `add_repo` tools from the claude-code-remote MCP server to
attach it — never declare a repo unreachable before checking `list_repos`.

## Step 2 — Discover Obsidian vaults

Obsidian vaults live on the user's devices; Claude reaches them only through a
sync target. Check both, in this order:

1. **GitHub** (preferred): look for repos that are synced vaults — a repo
   containing a `.obsidian/` folder at its root, or named like `vault`,
   `notes`, `obsidian`, `second-brain`. Check the session's in-scope repos
   first, then `list_repos` with those query strings.
2. **Google Drive**: `mcp__Google_Drive__search_files` with queries like
   `title contains 'obsidian'` or `title contains 'vault'`, and look for a
   folder tree containing `.obsidian`.

If no vault is found on either, say so plainly and walk the user through
`references/obsidian-sync.md` (10-minute setup, GitHub sync via the
obsidian-git plugin is the recommended path). Do not silently skip Obsidian.

## Step 3 — Report the dashboard

Print one compact status block before doing anything else:

```
REMOTE CONTROL — connected
GitHub        ✅ signed in as <login> — N repos in scope (<names>)
Google Drive  ✅ connected — most recent: <file>, <file>, <file>
Obsidian      ✅ vault found: <repo or Drive folder>   (or ❌ + one-line fix)
```

Then, if the user gave a command along with `/remote-control`, execute it.
Otherwise ask what they need — with 2-3 example commands.

## Step 4 — Execute access commands

| User says | Do |
|-----------|----|
| "read my note on X" / "search my vault for X" | Find the file in the vault repo (`get_file_contents`, `search_code`) or Drive folder and show it |
| "add this to my daily note" / "save this as a note" | Write the markdown file into the vault repo via `create_or_update_file` on the vault's default branch |
| "what's in my repos" / "check PRs / issues / CI on X" | GitHub MCP tools (`list_pull_requests`, `issue_read`, `actions_list`, …) |
| "find/read <file> on Drive" | `search_files` → `read_file_content` (or `download_file_content` for binaries) |
| "send me that file" | Download it, then `SendUserFile` |

## Rules

- **Read freely; confirm before the first write** to each service per session
  (vault notes, repo files, Drive). After the user okays the first write, keep going.
- Vault notes are personal — commit directly to the vault repo's default
  branch with a plain message like `note: <title>`. Do NOT open PRs against a
  vault. Code repos follow normal branch + PR flow.
- Never delete anything unless explicitly asked, and name the exact target
  back to the user before deleting.
- If a service is down or unauthorized, report it in the dashboard with the
  one-line fix and continue with the services that work — partial access
  beats no access.
- Never print tokens, credentials, or connector internals.
