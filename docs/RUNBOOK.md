# Zeemish v2 — Runbook

## Run locally
```bash
pnpm install
pnpm dev
# Open http://localhost:4321
```

## Build for production
```bash
pnpm build
# Output in dist/
```

## Deploy to Cloudflare
```bash
pnpm build
wrangler deploy
```
(Requires `wrangler login` first)

## Project structure
- `src/pages/` — Astro pages (routes)
- `content/` — MDX lessons and course data
- `worker/` — Cloudflare Workers API (Stage 3+)
- `agents/` — Agent team (Stage 4+)
- `docs/` — Living documentation
- `docs/handoff/` — Original architecture and planning docs
