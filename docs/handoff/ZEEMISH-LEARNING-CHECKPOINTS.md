# ZEEMISH v2 — Learning Checkpoints

You said you want to learn best practices as you build, not just ship code you don't understand. This document is the checklist.

At each stage, there are a handful of concepts you should **actually understand** — not memorise, but be able to explain back to yourself or to Claude Code. Before moving to the next stage, check them off.

When you hit one you don't understand, stop and ask Claude Code: **"Explain [concept] to me in plain English, with one concrete example from the code we just wrote."**

---

## Stage 1 — Foundation concepts

### 1.1 Static vs. server-side rendering
- [ ] I can explain what "static site" means (HTML files generated once at build time, served the same to everyone)
- [ ] I know why static is cheaper and faster at scale than server-rendering
- [ ] I know when static *doesn't* work (personalised content, real-time data)

### 1.2 What Astro actually does
- [ ] Astro takes `.astro` and `.mdx` files and outputs HTML
- [ ] By default, it ships **zero JavaScript** to the browser
- [ ] The `---` block at the top of `.astro` files is server-side (runs at build)
- [ ] Anything below the `---` is HTML template
- [ ] I know what an "island" is (interactive component that ships its JS only when needed)

### 1.3 Tailwind's model
- [ ] Tailwind gives you atomic utility classes (`text-lg`, `mx-auto`, `flex`)
- [ ] The class names *describe* styles — no cryptic CSS class names to invent
- [ ] Responsive prefixes: `md:text-xl` means "on medium screens and up, use text-xl"
- [ ] Tailwind scans your files at build time and only includes CSS you actually use

### 1.4 TypeScript strict mode
- [ ] `strict: true` in `tsconfig.json` means no implicit `any`, no unchecked nulls
- [ ] I know what a type annotation is: `const x: string = "hello"`
- [ ] I know why types matter for big codebases (refactoring safety, documentation)

### 1.5 Cloudflare's model
- [ ] A **Worker** is a small JavaScript function that runs at Cloudflare's edge
- [ ] **Static Assets** means Cloudflare serves your static files (HTML, CSS, images) for free
- [ ] DNS on `zeemish.io` points at a Worker; the Worker decides what to return
- [ ] Deployments are atomic — the whole site flips in one moment, no half-updated state

### 1.6 Git + GitHub Actions
- [ ] A commit is a snapshot of the repo at a moment in time
- [ ] A good commit message explains **why**, not what (the diff shows what)
- [ ] GitHub Actions runs YAML workflows on events (`push`, `pull_request`, etc.)
- [ ] Secrets (API keys) go in GitHub Settings → Secrets, never in the repo

---

## Stage 2 — Lesson system concepts

### 2.1 Web Components
- [ ] A Web Component is a custom HTML tag the browser treats as first-class
- [ ] They're native — no framework required, work everywhere
- [ ] `customElements.define('zee-breathe', ZeeBreathe)` is how you register one
- [ ] `connectedCallback()` runs when the element is added to the page
- [ ] `disconnectedCallback()` runs when it's removed — important for cleanup (timers, audio)

### 2.2 MDX
- [ ] MDX = Markdown + JSX/Astro components
- [ ] You can write `## Heading` next to `<Beat>` component in the same file
- [ ] Front-matter at the top (between `---` markers) is metadata
- [ ] Astro reads MDX files and compiles them to HTML pages

### 2.3 The beat pattern
- [ ] A lesson is a sequence of `<Beat>` blocks
- [ ] Each Beat has a title, text, optional audio, optional exercise, optional next button
- [ ] The `<LessonShell>` component orchestrates which Beat is visible
- [ ] Progress (which beat you're on) is saved per-user, not per-device

### 2.4 Local-first, server-optional
- [ ] The lesson page works even if the API is down (just doesn't save progress)
- [ ] The reader's experience doesn't depend on a round-trip to the backend
- [ ] This is called "progressive enhancement"

---

## Stage 3 — Backend concepts

### 3.1 What a Cloudflare Worker is
- [ ] A stateless function that receives HTTP requests and returns responses
- [ ] Runs on V8 (same engine as Chrome), not Node.js
- [ ] Cold starts are ~5ms (vs. Lambda's 200-1000ms)
- [ ] No long-running processes — each request is independent

### 3.2 D1 (SQLite on the edge)
- [ ] SQL database, familiar queries (`SELECT`, `INSERT`, `UPDATE`, `DELETE`)
- [ ] Globally replicated reads, single writer
- [ ] I know what a **primary key** is (unique identifier for each row)
- [ ] I know what a **foreign key** is (a reference to another table's primary key)
- [ ] I know what an **index** is (makes reads faster on specific columns, small write cost)

### 3.3 Anonymous-first auth
- [ ] A cookie is just a string the browser sends on every request
- [ ] Anonymous session = we generate a UUID, put it in a cookie, create a row in the users table
- [ ] Email upgrade = optional, adds an email + password hash to the existing user record
- [ ] No user is ever *required* to sign up to use the site

### 3.4 Passwords, safely
- [ ] Never store passwords in plain text, ever
- [ ] Use a hashing function designed for passwords (bcrypt, scrypt, argon2)
- [ ] Hashing is one-way: you can't get the password back, you can only verify a candidate matches
- [ ] I know what a "passphrase" is in our system (6 BIP39 words — memorisable, high entropy)

### 3.5 CORS and security headers
- [ ] CORS controls which sites can call our API from the browser
- [ ] We'll set it to `zeemish.io` only (not `*`)
- [ ] Security headers (CSP, HSTS, X-Frame-Options) are set in the `_headers` file

---

## Stage 4 — Authoring tool concepts

### 4.1 How Claude API works
- [ ] You send a POST to `api.anthropic.com/v1/messages` with an API key
- [ ] The request has a model name, a system prompt, and a list of messages
- [ ] The response has a content array — `content[0].text` is usually what you want
- [ ] API keys are **server-side only** — never expose them to the browser

### 4.2 Prompt engineering basics
- [ ] The **system prompt** shapes the model's persona and rules
- [ ] The **user message** is the specific request
- [ ] Explicit beats implicit: "Return only MDX, no preamble" works better than hoping
- [ ] Examples in the prompt (few-shot) often beat instructions alone

### 4.3 GitHub's Contents API
- [ ] You can read, create, update, delete files in a repo via HTTP
- [ ] Requires a fine-scoped Personal Access Token
- [ ] Every write creates a commit automatically
- [ ] Rate-limited — 5000 requests/hour per token (plenty for our use)

### 4.4 Rate limits and cost control
- [ ] Every Claude API call costs money (~$0.003-0.015 depending on model and length)
- [ ] Per-user rate limits prevent abuse (e.g., 10 lesson drafts per hour for the author)
- [ ] Caching: don't regenerate the same content twice (hash the input, cache the output)

### 4.5 Audio generation
- [ ] ElevenLabs gives you a voice, you send text, you get MP3 back
- [ ] One voice locked for Zeemish — consistency is brand
- [ ] Generate once per beat, save to R2 — never regenerate live
- [ ] Cost: ~$0.30 per 1000 characters (about $5 per 20-minute lesson)

---

## Stage 5 — Content concepts

### 5.1 The voice contract
- [ ] I can recite the five or six non-negotiables (plain English, no tribe, short sentences, specific beats general, no flattery, honest ending)
- [ ] I know what "tribe words" are (mindfulness, journey, empower, unlock, transform, wellness, etc.)
- [ ] I know the editor's test: read it aloud; if it sounds like an ad, LinkedIn post, or textbook, cut it

### 5.2 Lesson structure
- [ ] Hook → teaching → (audio throughout) → exercise → close
- [ ] 3–6 beats per lesson
- [ ] 20–40 minutes of content, no padding
- [ ] One idea per beat

### 5.3 When to use embedded exercises
- [ ] Use them when prose alone can't teach the thing
- [ ] Don't bolt them on — they should *land* where a reader is ready for them
- [ ] Not every lesson has one, and that's fine

---

## Stage 6 — Zita concepts

### 6.1 Why Socratic
- [ ] Research (Kestin et al., Harvard 2025) shows AI tutors work *only* when they're designed to strengthen thinking, not replace it
- [ ] Cognitive offloading research: AI that gives answers weakens learners; AI that asks questions strengthens them
- [ ] Zita's system prompt enforces this behaviour — ask before telling, scaffold don't solve

### 6.2 Per-user context
- [ ] Zita knows: what you've read, what you're in the middle of, what you said yesterday
- [ ] All context is passed to Claude on each call — Claude itself has no memory
- [ ] We store conversation history in D1 and load the relevant parts per request

### 6.3 Keeping Zita short
- [ ] Default response length: 2–4 sentences
- [ ] Long explanations are a design failure — if the reader needs a long explanation, a lesson should teach it
- [ ] Zita is a guide, not a tutor who lectures

---

## How to use this document

Don't try to understand everything before you start. **Read the Stage 1 concepts now, glance at Stage 2, ignore the rest.** As you build, check things off. When you hit a concept you don't understand while working on it, that's the moment to stop and learn it — the context is fresh, the example is concrete.

At the end of each stage, before moving to the next: run through the checkpoints for that stage. If any are unchecked, ask Claude Code to explain them before continuing.

That's how you learn best practices while building — not by reading a book, but by building and checking your understanding at natural pause points.

---

*If at any point you feel like you've shipped something you don't understand: stop. Ask Claude Code to walk you through it. Don't let "it works" become "it works and I have no idea why."*
