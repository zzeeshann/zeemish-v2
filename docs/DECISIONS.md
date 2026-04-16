# Zeemish v2 — Decision Log

Append-only. Never edit old entries.

## 2026-04-16: Chose pnpm over npm
**Context:** Setting up the repo.
**Decision:** Use pnpm for package management.
**Reason:** Faster installs, strict dependency resolution, saves disk space. Recommended in the build guide.

## 2026-04-16: Astro output mode set to `static`
**Context:** Configuring Astro for Cloudflare deployment.
**Decision:** Use `output: 'static'` (not `server` or `hybrid`).
**Reason:** Stage 1 is a static site — no server-side rendering needed yet. Static is cheaper, faster, and simpler on Cloudflare. We'll switch to `hybrid` or `server` only when we need server-side routes (Stage 3).

## 2026-04-16: Zeemish brand colours as Tailwind theme
**Context:** Setting up Tailwind config.
**Decision:** Added `zee-bg`, `zee-text`, `zee-accent` as custom Tailwind colours.
**Reason:** Keeps the colour palette consistent across components. DM Sans set as default sans font to match brand.

## 2026-04-16: Handoff docs stored in docs/handoff/
**Context:** Planning documents from the architecture phase.
**Decision:** Copy all handoff docs into the repo at `docs/handoff/`.
**Reason:** Every future Claude Code session needs access to the architecture and build guide. Keeping them in the repo means no dependency on external file paths.

## 2026-04-16: Beats as Web Components, not Astro components
**Context:** Stage 2 — deciding how to build beat navigation.
**Decision:** Use native Web Components (`<lesson-shell>`, `<lesson-beat>`) for beat navigation.
**Reason:** Beat navigation requires client-side state (show/hide on click). Astro components are build-time only. Web Components give us progressive enhancement (all beats visible without JS) and zero framework dependency.

## 2026-04-16: Single Astro Worker instead of separate site + API workers
**Context:** Stage 3 — deciding whether to build a separate `worker/` API project.
**Decision:** Keep API routes inside Astro using `src/pages/api/` with the Cloudflare adapter.
**Reason:** Avoids CORS complexity, keeps one deploy target, simpler to develop. The architecture planned three workers but Astro handles both static and server routes natively. Can split later if scale demands it.

## 2026-04-16: PBKDF2 via Web Crypto API for password hashing
**Context:** Stage 3 — choosing a password hashing approach for Cloudflare Workers.
**Decision:** Use PBKDF2 (100k iterations, SHA-256) via the Web Crypto API.
**Reason:** Works natively in Workers runtime — no npm dependencies needed. bcrypt/argon2 would require WASM or npm packages. PBKDF2 with sufficient iterations is NIST-approved and adequate for our use case.

## 2026-04-16: Middleware only on server-rendered routes
**Context:** Stage 3 — Astro middleware was crashing on prerendered pages.
**Decision:** Auth middleware checks the URL path and only runs on `/api/`, `/account`, `/login` routes.
**Reason:** Prerendered pages don't have access to D1 at build time. The middleware creates anonymous users in D1, which can only run on server-rendered routes. Lesson pages call the API from the client side instead.

## 2026-04-16: Agents as a separate Worker
**Context:** Stage 4 — setting up the agent team.
**Decision:** The agents live in `agents/` as a separate Cloudflare Worker, not inside the Astro site.
**Reason:** The Astro adapter manages its own fetch handler. Agents need Durable Object bindings with their own wrangler.toml. Separate Workers with separate concerns. Zero cost when agents are hibernated.

## 2026-04-16: getAgentByName for RPC instead of stub.fetch()
**Context:** Stage 4 — routing HTTP requests to Durable Objects.
**Decision:** Use `getAgentByName()` from the agents SDK for typed RPC calls from the main fetch handler.
**Reason:** The Agent base class's `fetch()` method expects specific SDK headers (namespace/room). Direct RPC via `getAgentByName` gives typed method calls and avoids header confusion.

## 2026-04-16: Voice contract as TypeScript string, not .md import
**Context:** Stage 4 — agents need the voice contract text.
**Decision:** Duplicate the voice contract as a string constant in `agents/src/shared/voice-contract.ts`.
**Reason:** Wrangler's bundler has no loader for `.md` files. The canonical version stays at `content/voice-contract.md`; the TS copy is kept in sync manually.

## 2026-04-16: Agent-chosen lesson topics instead of following course spine
**Context:** Stage 5 — producing the first 12-lesson course.
**Decision:** Let the Curator agent choose lesson topics freely rather than following the original 12-lesson spine from the brief.
**Reason:** The Curator produces better, more engaging titles when given creative freedom. The original spine ("20,000 breaths", "The nose knows") was a planning guide, not a requirement. The agents produced titles like "Why you can't tickle yourself" which are more compelling and still cover the body course subject.

## 2026-04-16: Synchronous RPC instead of Cloudflare Workflows v2
**Context:** Stage 4 — implementing the publishing pipeline.
**Decision:** Use synchronous sub-agent RPC calls instead of Cloudflare Workflows v2.
**Reason:** Faster to ship. The pipeline works end-to-end as synchronous calls. Trade-off: no durable checkpoints, pipeline cannot survive Worker restarts mid-execution. Workflows v2 can be added later without changing the agent logic — just wrap the existing calls in `step.do()`.

## 2026-04-16: Zita API in Astro site worker, not agents worker
**Context:** Stage 7 — building the Zita chat guide.
**Decision:** Zita's API endpoint lives in the Astro site (`/api/zita/chat`) not in the agents worker.
**Reason:** Zita needs the user's session cookie (from the auth middleware) and their conversation history from D1. The Astro site already has both. Putting Zita in the agents worker would require cross-worker auth, adding complexity.

## 2026-04-16: Coerce estimatedTime schema to handle agent output
**Context:** Stage 5 — agent-authored lessons had `estimatedTime: 18` (number) instead of `"18 min"` (string).
**Decision:** Changed Zod schema to `z.coerce.string()` for `estimatedTime`.
**Reason:** Agent output varies. Coercing is more robust than trying to enforce exact format in agent prompts. Numbers become strings automatically.

## 2026-04-17: Frederick Surrey as the Zeemish voice
**Context:** Choosing an ElevenLabs voice for lesson audio.
**Decision:** Frederick Surrey — British, male, middle-aged, calm, narrative style.
**Reason:** Matches the Zeemish tone: calm, direct, warm but not performative. Zishan's choice.

## 2026-04-17: Audio failure doesn't block text publishing
**Context:** Wiring audio generation into the publishing pipeline.
**Decision:** If audio generation or audit fails, the text lesson still publishes. Audio failure is logged via Observer but doesn't block.
**Reason:** Audio is enhancement, not core. A published lesson without audio is better than a blocked lesson. Audio can be regenerated later.

## 2026-04-17: Audio generated once per lesson, served from R2
**Context:** Cost model for audio.
**Decision:** Generate MP3 once via ElevenLabs, store in R2 bucket. Readers stream from R2.
**Reason:** ~$5 per lesson to generate. $0 per play after that. R2 serving is essentially free at this scale.

## 2026-04-17: Cancel passphrase auth, keep magic link
**Context:** Architecture planned both passphrase (6 BIP39 words) and magic link as login options.
**Decision:** Cancel passphrase auth. Build magic link instead.
**Reason:** They solve the same problem — passwordless login. Magic link is simpler, universally understood, and pairs with the existing email upgrade flow. Passphrase is clever but adds complexity readers don't need.

## 2026-04-17: Resend.com for magic link emails
**Context:** Choosing an email provider for magic link delivery.
**Decision:** Use Resend.com (free tier: 100 emails/day).
**Reason:** Simple API (one fetch call), no npm deps, generous free tier. Using test domain for now (onboarding@resend.dev) — needs verified domain for production.

## 2026-04-17: Two-pass Fact-Checker with web search
**Context:** Fact-Checker was failing too often on claims it couldn't verify from training data alone.
**Decision:** Two-pass approach: (1) Claude identifies claims, (2) DuckDuckGo instant answers for unverified/incorrect claims, (3) Claude re-assesses with search results.
**Reason:** Adds real-world verification without external API dependencies. DuckDuckGo is free and doesn't require an API key. Not as deep as a full search engine, but catches obvious errors.

## 2026-04-17: Learnings written by StructureEditor, reviewed by Director
**Context:** Architecture Section 4.3 describes a cross-lesson consistency system.
**Decision:** StructureEditor writes observations to the learnings table when it finds patterns. Director reviews audit patterns after each autonomous run and logs recurring issues via Observer.
**Reason:** Starts the learning loop without over-engineering. Observations accumulate, the Director surfaces recurring problems, and Zishan can act on them.

## 2026-04-17: PublishLessonWorkflow for durable pipeline execution
**Context:** Pipeline was synchronous RPC — wouldn't survive Worker restarts.
**Decision:** Added PublishLessonWorkflow using Cloudflare Workflows v2 via agents SDK. Each pipeline step (curate, draft, audit, revise, audio, publish) is a durable checkpoint.
**Reason:** Durable execution is critical for a pipeline that takes 1-2 minutes. If the Worker cold-starts mid-pipeline, it resumes from the last completed step instead of starting over.
