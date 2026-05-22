# AI vs Human LoC Tracker

Real-time dashboard that tracks how many lines of code are written by humans versus AI coding assistants (GitHub Copilot and Gemini Code Assist) across your team.

---

## What this is

The tracker consists of two parts:

1. **VS Code Extension** — instruments your editor, detects whether a code change came from a human keystroke, GitHub Copilot, or Gemini Code Assist, and pushes aggregated statistics to a JSON file in this GitHub repository.
2. **GitHub Pages Dashboard** — a zero-build, pure HTML/CSS/JS dashboard that reads `data/stats.json` and renders charts + a team leaderboard. It auto-refreshes every 60 seconds.

---

## Installation

### 1. Install the VS Code Extension

Open VS Code, go to the Extensions panel (`Ctrl+Shift+X` / `Cmd+Shift+X`), and search for **AI LoC Tracker**, or install it from source:

```bash
cd vscode-extension
npm install
npm run package          # produces ai-loc-tracker-*.vsix
code --install-extension ai-loc-tracker-*.vsix
```

### 2. Set up a GitHub Personal Access Token

The extension needs a fine-grained GitHub token with **read/write access to the Contents** of this repository so it can push `data/stats.json`.

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens) → **Fine-grained tokens** → **Generate new token**.
2. Under **Repository access**, select `kameysh/ai-loc-tracker`.
3. Under **Repository permissions**, grant **Contents: Read and write**.
4. Copy the generated token.

### 3. Configure the Extension

Open VS Code Settings (`Ctrl+,` / `Cmd+,`) and search for **AI LoC Tracker**:

| Setting | Description | Example |
|---|---|---|
| `aiLocTracker.githubToken` | Personal access token from step 2 | `github_pat_…` |
| `aiLocTracker.githubRepo` | Owner/repo to push data to | `kameysh/ai-loc-tracker` |
| `aiLocTracker.userName` | Your display name on the dashboard | `Divya` |
| `aiLocTracker.userEmail` | Your email (used as the user key) | `hello@nudji.in` |

Or add them directly to your `settings.json`:

```jsonc
{
  "aiLocTracker.githubToken": "github_pat_...",
  "aiLocTracker.githubRepo": "kameysh/ai-loc-tracker",
  "aiLocTracker.userName":   "Divya",
  "aiLocTracker.userEmail":  "hello@nudji.in"
}
```

---

## Viewing the Dashboard

The dashboard is published automatically to GitHub Pages on every push to `main` that touches `dashboard/` or `data/`.

**Live URL:** `https://kameysh.github.io/ai-loc-tracker/`

To enable GitHub Pages on a new fork:

1. Go to **Settings → Pages**.
2. Under **Source**, select **GitHub Actions**.
3. Push any change to trigger the first deployment.

### Running locally

No build step required — open `dashboard/index.html` directly in a browser, or serve it with any static file server:

```bash
npx serve dashboard
# → http://localhost:3000
```

---

## How data flows

```
VS Code Extension
      │
      │  On file save (debounced, ~30 s)
      │  Reads editor change events; classifies each hunk as:
      │    - human (manual keystrokes)
      │    - copilot (Copilot ghost-text accepted)
      │    - gemini  (Gemini Code Assist suggestion accepted)
      │
      ▼
GitHub REST API  (PUT /repos/:owner/:repo/contents/data/stats.json)
      │
      │  Merges new counts into existing stats.json
      │  Commits directly to main branch
      │
      ▼
data/stats.json  (in this repo, committed to main)
      │
      │  GitHub Actions workflow (pages.yml)
      │  Triggers on push to main when data/** changes
      │
      ▼
GitHub Pages  (dashboard/index.html)
      │
      │  fetch('./data/stats.json') every 60 seconds
      │  Renders Chart.js charts + leaderboard
      │
      ▼
Browser  →  Team sees live AI vs human contribution stats
```

---

## Repository layout

```
.
├── .github/
│   └── workflows/
│       └── pages.yml          # Deploys dashboard/ to GitHub Pages
├── dashboard/                 # Static GitHub Pages site
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js             # Data loading + rendering orchestration
│   │   └── charts.js          # Chart.js chart factory functions
│   └── assets/favicon.svg
├── data/
│   └── stats.json             # Written by VS Code extension; read by dashboard
└── vscode-extension/          # VS Code extension source
```

---

## Dashboard features

- **Summary cards** — total lines tracked, AI lines, human lines, AI adoption rate
- **Team overview** — horizontal stacked bar per team member (Human | Copilot | Gemini)
- **Per-user cards** — donut chart, 14-day AI trend sparkline, last-active timestamp
- **Language breakdown** — top 5 languages, grouped bars per source
- **30-day timeline** — daily line counts for all three sources
- Auto-refreshes every 60 seconds; shows last-updated timestamp
- Dark theme, fully responsive (mobile-friendly)

---

## Contributing

Pull requests are welcome. The extension source is in `vscode-extension/`. The dashboard is plain HTML/CSS/JS with no build step — edit files directly and refresh the browser.

---

## License

MIT

# ai-loc-tracker