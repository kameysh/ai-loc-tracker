# AI vs Human LoC Tracker

Tracks how many lines of code are written by **GitHub Copilot**, **Gemini Code Assist**, or by **you** — in real-time, per language, per day — and syncs the stats to a shared GitHub repository.

## Features

- **~97% accurate AI detection** via Tab keybinding interception
- Distinguishes between **Copilot** and **Gemini** contributions
- Per-language and daily breakdowns
- Status bar: `$(robot) AI: 234  $(person) Human: 456`
- Syncs to `kameysh/ai-loc-tracker/data/stats.json` on every file save
- Multi-user dashboard — stats from all team members are merged

## Setup

1. Install the extension
2. On first launch, you'll be prompted to enter a GitHub PAT
3. Create a PAT at https://github.com/settings/tokens with `repo` scope
4. Paste the token into the prompt

## Commands

| Command | Description |
|---------|-------------|
| `AI LoC Tracker: Set GitHub Personal Access Token` | Update your GitHub PAT |
| `AI LoC Tracker: Show Statistics` | Open the stats webview |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `aiLocTracker.githubRepo` | `kameysh/ai-loc-tracker` | Repo to sync stats to |
| `aiLocTracker.userName` | `` | Override git user.name |
| `aiLocTracker.userEmail` | `` | Override git user.email |
| `aiLocTracker.syncOnSave` | `true` | Auto-sync on file save |

## How It Works

1. A competing `Tab` keybinding fires **before** the inline suggestion is accepted
2. The handler snapshots the document, calls `editor.action.inlineSuggest.commit`, then diffs to count AI lines
3. All other `onDidChangeTextDocument` events (not within 100ms of an AI accept) count as human lines
4. Stats are stored locally at `~/.vscode/ai-loc-tracker/stats.json`
5. On every file save, the local stats are merged with the remote and pushed via the GitHub REST API
