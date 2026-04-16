# ZEEMISH v2 — Build Guide (for Zishan)

This is the how-to. Not the architecture. Not the philosophy. The actual sequence of things to do, with what to ask Claude Code at each step.

Goal: you ship a working "Hello Zeemish v2" page to Cloudflare in the next 2 hours, learn something doing it, and walk away knowing exactly what to do tomorrow.

---

## Before you start — 10 minutes

### What you need installed

Check these are on your machine. If not, install them (Claude Code can help you install anything missing):

- **Node.js 20+** (`node --version`)
- **pnpm** (faster than npm: `npm install -g pnpm`)
- **git** (`git --version`)
- **wrangler** (`npm install -g wrangler`) — Cloudflare's CLI

If you don't have an **Anthropic API key**: get one at console.anthropic.com. You already have one if your old Zeemish uses Claude.

If you don't have an **ElevenLabs account**: skip this for now. Not needed for Stage 1.

### Accounts you need

- GitHub (you have this)
- Cloudflare (you have this)
- Anthropic (you have this)

---

## How to use Claude Code efficiently — 2 minutes

Claude Code is a terminal AI that reads your files, writes code, runs commands, commits to git. It's your pair programmer.

Three rules to work with it well:

1. **Give it context, not tasks.** Instead of "write the login page," say "here's the architecture doc, here's where we are, write the login page according to section 5 of the architecture."
2. **Let it read before it writes.** When starting a new task, tell it which files are relevant. It'll read them, then propose a plan, then execute.
3. **Check in at milestones.** After every significant step, ask it to summarise what it did and why. This is how you learn.

### How to start your first Claude Code session

Open a terminal. Navigate to where you want to create the new repo (probably next to your old `zeemish` folder). Then:

```bash
mkdir zeemish-v2
cd zeemish-v2
claude
```

When Claude Code starts, the first thing you paste is:

> Read `/path/to/handoff/README.md`, then read `/path/to/handoff/ZEEMISH-V2-ARCHITECTURE.md`, then read `/path/to/handoff/ZEEMISH-LEARNING-CHECKPOINTS.md`. After that, confirm you understand what we're building and propose the first concrete move.

Replace `/path/to/handoff/` with wherever you saved the docs I'm giving you. Claude Code will read everything and come back with a plan.

---

## Stage 1 — Foundation (goal: deploy a working site today)

### Step 1.1 — Create the repo structure

**Ask Claude Code:**
> Set up the Zeemish v2 repo structure exactly as specified in Section 1 of the architecture doc. Initialise git. Don't install dependencies yet — just create the directory skeleton and empty placeholder files where needed.

**What Claude Code will do:**
- Create the folders (`src/pages/`, `content/lessons/`, `worker/src/`, etc.)
- Initialise git
- Create a README.md with project description
- Create .gitignore with Node/Astro/Cloudflare defaults

**What to learn from this step:**
- Why the directory structure matters (separation of concerns)
- Why `content/` is separate from `src/` (content vs. code)
- Why the worker is a sibling folder, not inside the site (two separate deploys)

### Step 1.2 — Set up Astro with Tailwind, MDX, TypeScript

**Ask Claude Code:**
> Initialise an Astro project in this repo. Add Tailwind CSS, the MDX integration, and TypeScript in strict mode. Configure it to output static files that can be served from Cloudflare Workers with Static Assets. Show me the config files and explain what each one does.

**What Claude Code will do:**
- Run `pnpm create astro@latest` (or manually set up `package.json`)
- Install `@astrojs/tailwind`, `@astrojs/mdx`
- Create `astro.config.mjs`, `tailwind.config.mjs`, `tsconfig.json`
- Configure the output adapter for Cloudflare

**What to learn from this step:**
- What Astro is and how it's different from Next.js
- How Astro compiles MDX to HTML at build time
- What strict mode TypeScript means (no `any`, no unchecked nulls)
- How Tailwind's utility-first philosophy works

**Before moving on, ask Claude Code:**
> Explain what `astro.config.mjs` is actually doing, line by line. I want to understand it, not just have it.

### Step 1.3 — Build the first page

**Ask Claude Code:**
> Create `src/pages/index.astro` — a minimal home page. It should have: the Zeemish wordmark at the top-left, the sentence "Zeemish is being rebuilt" in the middle, a footer. Dark background (#0b1c21), text colour #e4f2f4, DM Sans font. Use Tailwind. Mobile-responsive.

**What Claude Code will do:**
- Create `src/pages/index.astro`
- Use Tailwind classes for layout
- Import DM Sans from Google Fonts
- Add a basic shared CSS file for custom properties

**What to learn:**
- How an Astro file is structured (frontmatter script + HTML template)
- The difference between `class` and `className` (none in Astro)
- How Tailwind classes read (`text-gray-100`, `bg-[#0b1c21]`, `min-h-screen`)
- How to preview locally: `pnpm dev`

**Test it:**
```bash
pnpm dev
```
Open `http://localhost:4321` in your browser. Also on your phone on the same network (replace `localhost` with your computer's local IP).

### Step 1.4 — Deploy to Cloudflare

**Ask Claude Code:**
> Set up Cloudflare Workers with Static Assets deployment for this site. I want to deploy it to a temporary subdomain like `zeemish-v2.workers.dev` first, not `zeemish.io` yet. Create the wrangler.toml, explain its fields, and walk me through the deploy command.

**What Claude Code will do:**
- Create `wrangler.toml` at the root
- Configure the worker to serve Astro's `dist/` folder
- Show you the `wrangler deploy` command
- Help you authenticate if needed (`wrangler login`)

**What to learn:**
- What `wrangler.toml` is (the deployment config)
- The difference between `wrangler dev` (local) and `wrangler deploy` (live)
- What "Static Assets" means in the Cloudflare Workers context (free static file serving)

**Test it:**
```bash
pnpm build
wrangler deploy
```
Visit the URL it gives you. That's Zeemish v2, live on the internet.

### Step 1.5 — GitHub + CI/CD

**Ask Claude Code:**
> Set up GitHub Actions to auto-deploy this repo to Cloudflare on every push to main. Create the workflow file. Tell me what secrets I need to add to GitHub and how.

**What Claude Code will do:**
- Create `.github/workflows/deploy-site.yml`
- Explain the three secrets you need (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`)
- Walk you through creating the API token on Cloudflare's dashboard

**What to learn:**
- What GitHub Actions is (free CI/CD for public repos, cheap for private)
- How secrets work (never commit them to the repo)
- Why auto-deploy matters (friction-free shipping)

**Test it:**
```bash
git add .
git commit -m "chore: initial Zeemish v2 skeleton with Astro + Tailwind"
git remote add origin git@github.com:zzeeshann/zeemish-v2.git  # create repo first on GitHub
git push -u origin main
```

GitHub Actions runs. Site deploys. Done.

---

## Stage 1 is complete when...

- ✅ `https://zeemish-v2.workers.dev` (or your chosen subdomain) loads
- ✅ Shows dark page with Zeemish wordmark and the placeholder sentence
- ✅ Works on your Android phone
- ✅ A `git push` deploys automatically in under 2 minutes
- ✅ You understand what every file in the repo is for

**If any of these aren't true**, ask Claude Code to debug before moving on.

**Estimated time for Stage 1:** 2–4 hours the first time, because you're learning. 30 minutes the tenth time.

---

## Stage 2 onwards — what's next

Once Stage 1 is solid, the next stages build on each other:

- **Stage 2:** Reader surface. Hand-write one dummy lesson MDX. Build the lesson Web Components. Get next-button beats working.
- **Stage 3:** Accounts and progress. Spin up the worker, D1 database, the cookie → email upgrade flow.
- **Stage 4:** The `/author/` tool. Draft with Claude, preview, generate audio, commit via GitHub API.
- **Stage 5:** First real course. Draft and ship the body course's first 12 lessons.
- **Stage 6:** Zita. Launch.

Full detail in Section 8 of the architecture doc.

### How to start each new stage

When you're ready for Stage 2, start a new Claude Code session and paste:

> We finished Stage 1. Zeemish v2 is deployed at [your URL]. Read the architecture doc, Section 8, Stage 2. Propose the first move.

Don't try to remember what you learned — let Claude Code re-read the docs. That's what they're for.

---

## How to ask good questions to Claude Code

This is the habit that will separate "I shipped Zeemish v2" from "Claude Code shipped Zeemish v2."

### Bad questions

- "Write the login page" (too vague, no context)
- "Fix this" (no error, no context)
- "Make it better" (better how?)

### Good questions

- "Here's the error I got when I ran `pnpm build`: [paste full error]. The file that broke is `src/pages/index.astro`. What's wrong?"
- "I want to add user login. Section 5 of the architecture defines `/api/account/login`. Walk me through building it, one step at a time. Start with the D1 schema query."
- "You just wrote this function. Explain what it does, line by line, like I'm a competent developer who's new to Astro."

### The rhythm that works

1. **Ask** a specific question with context.
2. **Let Claude Code propose** a plan before writing code.
3. **Say "go"** or "wait, first explain X."
4. **Read what it writes.** Don't skim.
5. **Ask "why this approach over alternatives?"** when it's a significant choice.
6. **Test it yourself.** Don't trust it to work — run it, click it, check it.
7. **Commit** with a message that explains why.

---

## When you get stuck

Three failure modes and what to do:

**"It's not working and I don't know why."**
- Copy the full error message, the file name, and the command you ran.
- Paste all three to Claude Code.
- Ask: "What's the likely cause, and what's the simplest way to diagnose it?"

**"Claude Code keeps getting this wrong."**
- You're missing context it doesn't have. Point it at the specific file or architecture section it needs.
- Or the task is too big — break it into one smaller step.

**"I don't understand what just happened."**
- Stop. Ask: "Walk me through the last change you made. Explain what each file now does and how they fit together."
- Don't move on until you can explain it to yourself.

---

## One last thing

This is your project. Claude Code is your collaborator. When it suggests something that doesn't feel right — push back. When it's doing something you don't understand — stop and ask. The whole point of building this way is that you learn. A shipped site you don't understand is worse than a half-built site you do.

Go build. The first 2 hours are the hardest. After that, you're just doing it.

---

*When Stage 1 is live and deployed, message the architecture-level Claude (me, in this kind of planning chat) with "Stage 1 done, here's the URL, planning Stage 2" and we'll plan the next phase.*
