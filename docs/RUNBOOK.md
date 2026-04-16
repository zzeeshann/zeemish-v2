# Zeemish v2 — Runbook

How to run, deploy, operate, and troubleshoot. Written for a developer who just cloned the repo.

## Prerequisites
- Node.js 20+
- pnpm (`npm install -g pnpm`)
- wrangler (`npm install -g wrangler`, then `wrangler login`)

## Run locally

### Site (Astro)
```bash
cd zeemish-v2
pnpm install
pnpm dev
# Open http://localhost:4321
```

### Agents worker
```bash
cd agents
pnpm install
pnpm dev
# Runs at http://localhost:8787
```

## Build for production
```bash
pnpm build
# Output in dist/
```

## Deploy

### Site
```bash
pnpm build
wrangler deploy
# Deploys to https://zeemish-v2.zzeeshann.workers.dev
```
Also auto-deploys on every push to `main` via GitHub Actions.

### Agents
```bash
cd agents
wrangler deploy
# Deploys to https://zeemish-agents.zzeeshann.workers.dev
```
**Note:** Agents are NOT auto-deployed by GitHub Actions. Must deploy manually.

## Secrets

### Site worker
```bash
wrangler secret put ANTHROPIC_API_KEY   # For Zita chat
```

### Agents worker
```bash
cd agents
wrangler secret put ANTHROPIC_API_KEY   # For Claude API calls
wrangler secret put GITHUB_TOKEN        # For Publisher commits
```

## D1 Database

### Run migrations
```bash
# Run a migration on remote D1
wrangler d1 execute zeemish --remote --file=migrations/0001_init.sql

# Check what's in the database
wrangler d1 execute zeemish --remote --command="SELECT name FROM sqlite_master WHERE type='table'"
```

### Query the database
```bash
wrangler d1 execute zeemish --remote --command="SELECT * FROM users LIMIT 5"
wrangler d1 execute zeemish --remote --command="SELECT * FROM observer_events ORDER BY created_at DESC LIMIT 10"
```

## Trigger a lesson (agent pipeline)

### Via curl
```bash
curl -X POST "https://zeemish-agents.zzeeshann.workers.dev/trigger?course=body&lesson=3"
```

### Via dashboard
Visit https://zeemish-v2.zzeeshann.workers.dev/dashboard/ and use the trigger form.

### Check status
```bash
curl "https://zeemish-agents.zzeeshann.workers.dev/status"
```

## Check what agents have been doing
```bash
# Last 24 hours digest
curl "https://zeemish-agents.zzeeshann.workers.dev/digest"

# Recent events
curl "https://zeemish-agents.zzeeshann.workers.dev/events?limit=10"

# Engagement report
curl "https://zeemish-agents.zzeeshann.workers.dev/engagement?course=body"
```

## Revert a bad publish
The PublisherAgent commits directly to `main`. To revert:
```bash
git log --oneline | head -10           # Find the bad commit
git revert <commit-sha>                # Creates a revert commit
git push                               # Triggers auto-deploy
```

## Add a lesson manually
Create an MDX file at `content/lessons/{course}/{nn}-{slug}.mdx`:
```yaml
---
title: "Lesson title"
course: "body"
lessonNumber: 2
estimatedTime: "20 min"
beatCount: 5
description: "One-line description."
---

<lesson-shell>
<lesson-beat name="hook">
Your hook text here.
</lesson-beat>
<!-- more beats -->
</lesson-shell>
```
Then `pnpm build && wrangler deploy`.

## Project structure
```
zeemish-v2/
├── src/                    Astro site (pages, components, layouts)
│   ├── pages/              Routes (index, courses, account, login, dashboard, API)
│   ├── components/         Astro components (AudioPlayer)
│   ├── layouts/            BaseLayout, LessonLayout
│   ├── interactive/        Web Components (lesson-shell, lesson-beat, zita-chat)
│   ├── lib/                Auth + DB helpers
│   ├── styles/             Global CSS
│   └── middleware.ts       Anonymous auth middleware
├── content/                MDX content
│   ├── courses/            Course metadata (body.mdx)
│   ├── lessons/            Lesson MDX files by course
│   ├── voice-contract.md   Voice rules for agents
│   └── subject-values.json Subject priorities
├── agents/                 Separate Cloudflare Worker
│   ├── src/                Agent code (11 agents)
│   └── wrangler.toml       Agent worker config
├── migrations/             D1 schema migrations
├── docs/                   Living documentation
│   ├── handoff/            Original architecture docs
│   ├── ARCHITECTURE.md     What's built vs. planned
│   ├── AGENTS.md           Agent documentation
│   ├── SCHEMA.md           D1 database schema
│   ├── DECISIONS.md        Technical decision log
│   └── RUNBOOK.md          This file
├── .github/workflows/      CI/CD
├── CLAUDE.md               Context for Claude Code sessions
└── wrangler.toml           Site worker config
```
