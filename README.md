# Obsidian GitHub Sync

Free alternative to [Obsidian Sync](https://obsidian.md/sync) — automatically backs up and syncs your vault to a GitHub repository.

## How it works

- Watches for file changes in your vault
- After a configurable debounce delay, commits and pushes changes to GitHub
- Periodically pulls remote changes in the background
- Shows sync status in the Obsidian status bar

## Requirements

- Obsidian desktop (macOS / Windows / Linux)
- A GitHub account and a repository for your vault
- A GitHub [Personal Access Token](https://github.com/settings/tokens/new) with `repo` scope

## Installation

1. Download `main.js` and `manifest.json` from [Releases](../../releases)
2. Create folder `<your-vault>/.obsidian/plugins/github-sync/`
3. Copy both files into that folder
4. Open Obsidian → Settings → Community plugins → enable **GitHub Sync**

## Setup

1. Go to **Settings → GitHub Sync**
2. Enter your **GitHub Personal Access Token**
3. Enter your **repository** in `owner/repo` format
4. Set your preferred branch (default: `main`)
5. Click **Initialize** — this sets up git in your vault and connects to GitHub
6. Done — the plugin will sync automatically from now on

## Settings

| Setting | Default | Description |
|---|---|---|
| GitHub Token | — | Personal Access Token with `repo` scope |
| Repository | — | `owner/repo` |
| Branch | `main` | Branch to sync with |
| Auto sync | on | Commit and push on file changes |
| Sync interval | 5 min | How often to pull remote changes |
| Debounce delay | 10 sec | Wait after last change before committing |

## Status bar

Click the status bar item to trigger a manual sync.

| Status | Meaning |
|---|---|
| ⬡ Synced | Vault is up to date |
| ⟳ Syncing… | Commit / push / pull in progress |
| ↑ N pending | N file changes waiting for debounce |
| ✗ Sync error | Last sync failed — hover for details |

## Conflict handling

If the same file is modified on two devices before syncing, the plugin keeps your local version and saves the remote version as `filename.conflict.md` so you can review the difference manually.

## License

MIT
