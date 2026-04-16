# ZEEMISH — Founding Document (v2)

**Status:** Reborn. April 2026. This document replaces the previous project brief. The previous Zeemish (hub + tools/sessions/audio/listens + Zita as prescriber) is being taken offline. This document is the reference for what replaces it.

---

## 1. What Zeemish is now

**Zeemish is a school that teaches ordinary people the subjects that actually explain the world they live in — in 30-minute lessons, in plain English.**

Not a wellness app. Not a productivity tool. Not a platform. A school. You come to learn something. You leave knowing it. You come back tomorrow for the next piece.

The old Zeemish met people in a spare minute. The new Zeemish asks for thirty — and promises that those thirty minutes are worth more than the three hours they'd spend scrolling otherwise.

### Who it's for

The person who knows something is going on — with AI, with attention, with money, with their body, with how their mind works — and wants to actually understand it. Not an expert. Not a beginner pretending to be a beginner. A smart adult who has been failed by the existing doors: university (too long, too expensive, too abstract), YouTube (too noisy, no structure), corporate learning platforms (too corporate), self-help (too hollow).

Ordinary. Curious. Willing to give thirty minutes a day. Not willing to give more.

### Why it can work

Because nobody owns "serious bite-size learning across the subjects that explain being human and being now." Coursera is a university. Brilliant is STEM puzzles. Duolingo is language. MasterClass is celebrities. YouTube is chaos. The gap in the middle — structured, short, trustworthy, honest, wide-ranging — is open.

### What makes it Zeemish and not anyone else

**The voice.** Plain English because plain English belongs to nobody. No jargon. No "learning journey." No tribe. A Hindu grandmother in Delhi, a Muslim teenager in Bradford, an atheist programmer in Berlin, a Catholic nurse in Manila — they should all read the same lesson and feel it was written for them.

**The practice in place.** Lessons don't send you elsewhere to practise. A breathing lesson ends with a breathing widget embedded in the page. An attention lesson might end with a small focus exercise. A money lesson might end with an interactive diagram. The old Zeemish components are reborn as embeddable teaching aids inside lessons — this is the thing nobody else does.

**The constraint.** 30 minutes, not 45, not 60. Ruthlessly. The promise is the product.

---

## 2. The voice contract

This is the single most important section in this document. Everything else is downstream of the voice. If the voice wobbles, Zeemish is just another course platform. If the voice holds, Zeemish is unlike anything else in learning.

**When drafting with AI, this section IS the system prompt.** Copy it into the LLM's system message and edit every draft against it.

### The rules

1. **Plain English.** Anyone who can read a newspaper should be able to read a Zeemish lesson. No jargon without immediate plain-English translation. When a technical term is necessary, define it the first time in the same sentence.

2. **No tribe words.** No "mindfulness." No "journey." No "energy" in the spiritual sense. No "hack." No "unlock your potential." No "evidence-based" (say what the evidence is). No "science-backed" (same). No "transform." No "empower." No "self-care." These words carry passports. Zeemish has no passport.

3. **Short sentences win.** A sentence that takes three commas to get to its point is a sentence that didn't know its point. Cut.

4. **Specific beats general.** "Most adults breathe 12–18 times a minute" beats "humans breathe at various rates." Numbers. Examples. Names. Research with citations when it matters.

5. **Don't be clever for clever's sake.** Wordplay is fine when it lands. It's poison when it doesn't. If a sentence is doing a joke, the joke has to earn the space.

6. **Trust the reader.** No "as we'll see." No "it's important to remember." No "key takeaway." No boxes, sidebars, or callouts that summarise what the paragraph just said. If the paragraph needed summarising, rewrite the paragraph.

7. **Honesty over flattery.** Don't tell the reader they're amazing. Don't tell them this will change their life. Tell them what's true. The respect is in the truth, not the compliment.

8. **No instructions that sound like a yoga teacher.** Not "gently bring your awareness to your breath." Yes "breathe in through your nose for four seconds."

9. **End hard.** Every lesson closes on a sentence that lands. Not a summary. Not a call to action. A closing line that sits. Like the last sentence of a good short story.

10. **Humour is welcome when it's real.** Dark is welcome when it's honest. Edgy for edgy's sake is vanity.

### What a Zeemish sentence sounds like

- *"You breathe about 20,000 times a day. Almost none of them on purpose."*
- *"The body you're in right now is doing roughly 37 trillion things to keep you here. Most of them, nobody asked you."*
- *"Attention isn't something you have. It's something that gets taken."*
- *"Most of what you think is thinking is remembering."*

### What a Zeemish sentence does not sound like

- "Let's explore the wonderful world of breathing together."
- "Did you know that mindful breathing can transform your life?"
- "It's time to unlock the power of your nervous system."
- "In this lesson, we'll journey through the fascinating science of respiration."

### The editor's test

Every sentence gets read once, out loud, at normal speaking pace. If it sounds like an ad, cut it. If it sounds like a textbook, cut it. If it sounds like a LinkedIn post, cut it. If it sounds like something a thoughtful friend would say at a kitchen table, keep it.

---

## 3. The lesson anatomy

Every lesson has five beats, in order, on one page, with **"next" buttons moving the reader through each beat**. Not one long scroll — you move through the lesson in sections, one beat at a time. This matches the old Zeemish discipline: less on screen, more presence.

### Beat 1 — The hook (30 seconds)

One screen. One question or image or statement that makes you want the next beat. No introduction. No "in this lesson we'll cover." The hook drops you into the thing.

Example (body course, lesson 3): *"You breathe about 20,000 times a day. Almost none of them on purpose. That's about to become a problem, or a gift, depending on what you do next."*

Press "Continue."

### Beat 2 — The teaching (18–22 minutes of reading)

The substance. 1500–2500 words, broken into 3–5 sub-beats with their own "next" buttons. Each sub-beat is one idea, one scroll-screen or two, then you move on. This is the bulk of the lesson.

Rules for the teaching:
- Start from what the reader already knows (their own body, their own experience) and build outward
- One idea per sub-beat — no cramming
- Use research and specifics, cite where it matters, don't perform credibility
- No sidebars, no "key points" boxes, no coloured highlight panels. The prose carries itself.
- At most one simple diagram per lesson, only if words genuinely fail

### Beat 3 — The audio option (parallel, not after)

At the top of the lesson, a play button. Pressing it reads the entire lesson aloud in a single generated voice (ElevenLabs or OpenAI, one voice chosen for Zeemish and never changed). The audio is the same content as the text, not a separate "audio version." Read on the train, listen on a walk, do both.

Audio is generated once per lesson, stored as MP3 on R2 (same pattern as the old listens), served from `audio.zeemish.io` or similar.

### Beat 4 — The practice (optional, 3–7 minutes)

When the lesson has earned it, the last beat before the close is an **embedded Web Component** — a `<zee-breathe>`, a `<zee-scan>`, a new one built for the lesson. Short instruction above it (one sentence), component below, no explanation. Do it or skip it.

Not every lesson has a practice. Some lessons are pure teaching. Don't force it.

This is where the 87 existing components find their new life. Not as standalone tools. As embedded teaching aids that appear at the exact moment the lesson has given you the reason to use them.

### Beat 5 — The close (30 seconds)

One sentence. Lots of white space above and below. Then a single button: *Next lesson* (if the next one is unlocked) or *Come back tomorrow* (if it isn't).

No "great job." No "you completed a lesson!" No summary of what was learned. The close lands, and then the page ends.

---

## 4. The course anatomy

A course is a **spine of 12–15 lessons**, linear, one unlocks the next. A spine is not a list — it's designed so the lessons build on each other. Lesson 5 assumes you did lessons 1–4. That's what makes it a course and not a collection of essays.

### Length

12–15 lessons. At 30 minutes each, that's 6–7.5 hours of learning, spread over 2–3 weeks if the user does one a day. Long enough to be real. Short enough to finish. Most online courses are either 2 hours (too slight) or 40 hours (never finished).

### Unlock rules for v1

**Linear, but no artificial wait.** Complete a lesson, the next one unlocks immediately. No "come back tomorrow" enforced by the system. Trust the reader to pace themselves. If they want to do three lessons in one sitting, let them — some people will, most won't, and forcing a daily drip before we know what users want is cargo-culting Duolingo.

If we later find people binge-and-bounce, we can add drip. Don't add it now.

### Progress

A lesson is "complete" when the reader reaches beat 5 and presses the final button. Progress is stored per-user (cookie-first, email optional — see §7). No quizzes. No "you must get 80% to continue." The practice is optional and completion is not gated on it.

### What a course page shows

- Course title and one-line description
- Total lesson count and estimated total time
- The lesson list: title, one-line description, lock icon if locked, check if completed
- A single "Start" or "Continue" button that takes you to the right lesson
- Nothing else. No author bio (the Zeemish voice is the author). No reviews. No "students enrolled."

---

## 5. Site structure

Four levels. That's it. Every page belongs to exactly one level.

```
Home (/)
  └─ Courses (/courses/)
        └─ Course page (/courses/[course-slug]/)
              └─ Lesson (/courses/[course-slug]/[lesson-number]/)
```

### Home (`/`)

One screen. The front door of the school.

- Zeemish wordmark, top-left
- One sentence about what Zeemish is
- A single large button: *Browse courses*
- Below, the current course list shown as cards (when there are more than one; for launch, one card)
- Footer: the voice manifesto in one paragraph, a link to the blog (if it survives), contact

No hub grid. No glowing circle. No Zita. No tagline below the logo. Clean.

### Courses (`/courses/`)

The catalogue. Every course listed as a card: title, one-line description, lesson count, estimated time, cover image or simple coloured block.

For launch: one card (The body you live in). Later: grid of cards. When there are 20+ courses, add simple filtering by subject area. Not before.

### Course page (`/courses/[slug]/`)

One course. See §4 for what's on it.

### Lesson (`/courses/[slug]/[lesson-number]/`)

One lesson. See §3 for what's on it.

### What's NOT on the site

Explicit list so this doesn't bloat:

- No blog integration (the blog stays at `/blog/` on WordPress if it survives, but it's not promoted from the main nav)
- No "about" page beyond a line in the footer
- No Zita, no agent, no chat, no prescribing
- No community, forums, comments, or social features
- No user profiles shown publicly — profiles are private, account-only
- No achievements, badges, streaks, or gamification
- No "recommended for you" — the catalogue is small enough to browse, and algorithmic recommendation is cargo-culted from products that have 10,000+ items

---

## 6. The first course — "The body you live in"

The launch course. 12 lessons. The old Zeemish content (breathing, stress, sleep, movement, attention as a bodily phenomenon) reborn as a proper structured course, taught in plain English, with embedded practices from the existing component library.

### Why this course first

- You are genuinely expert here — your editing eye is sharpest, you'll catch AI drift instantly
- The research is already done (see BREATH-RESEARCH.md in the old Zeemish docs)
- Existing components cover ~60% of what the practices need (zee-breathe, zee-sigh, zee-scan, zee-settle, zee-soften, zee-track, zee-widen, zee-focus, and several audio components)
- It proves the template on your strongest ground, before you try it on territory you know less well

### Proposed spine (12 lessons)

*This is a draft. You'll rewrite the titles and probably reorder. The purpose is to show the shape.*

1. **The body you're in** — orientation; what this course is; the view that your body is a machine you've never read the manual for
2. **20,000 breaths** — how breathing actually works; why almost all of yours are on autopilot; what changes when any of them aren't
3. **The nose knows** — why nose-breathing vs mouth-breathing matters; nitric oxide, CO₂ tolerance, the simple change most people never make
4. **The rhythm you can change** — introduction to breath control; slow breathing, box breathing, cyclic sighing; what the vagus nerve actually does
5. **Stress is not a mood** — what stress is in the body, not the mind; cortisol, HPA axis, why it's physical before it's emotional
6. **The system that never sleeps** — sympathetic vs parasympathetic, plain English; how to move between them on purpose
7. **Sleep, honestly** — what sleep is, what it does, the non-negotiables, what the wellness industry gets wrong about it
8. **The body keeps the score** — how stored tension shows up, what somatic awareness actually is, without the jargon
9. **Movement as medicine** — why sitting all day breaks you, what minimum movement actually looks like, not a workout plan
10. **The hungry brain** — how food affects mood and attention; the basics, no diet culture
11. **Attention is a body thing** — why focus is physical, not mental; what actually happens when you "lose focus"
12. **Living in it** — pulling it together; the body you now live in, a little more consciously; what to do when you forget everything in this course (you will)

### Embedded practices per lesson (proposed)

- L1: none
- L2: `<zee-breathe>` — feel your normal breathing
- L3: a new simple nose-breathing timer (2 min)
- L4: `<zee-sigh>` or `<zee-breathe>` with slow mode
- L5: none (teaching-heavy)
- L6: `<zee-breathe>` with parasympathetic pattern
- L7: none (teaching-heavy)
- L8: `<zee-scan>`
- L9: a short movement timer (new component, 5 min with cues)
- L10: none
- L11: `<zee-focus>` or `<zee-track>`
- L12: `<zee-settle>` — the closing rest

Two new components needed: nose-breathing timer, movement timer. Everything else reuses existing.

---

## 7. Technical architecture

The stack from the old Zeemish largely survives. The application on top of it is different.

### What transfers

- **Cloudflare Workers + Static Assets** at `zeemish.io` — same hosting model
- **Cloudflare Worker TypeScript API** at `api.zeemish.io` — same infrastructure, different endpoints
- **KV for user data** — same namespace approach, new schema
- **R2 for audio** — reused for lesson audio (MP3 per lesson)
- **Vanilla HTML + Web Components** — same frontend philosophy
- **`shared/style.css` CSS variables** — colour tokens, spacing, fonts all transfer
- **GitHub Actions auto-deploy** — same
- **The 87 components** — transfer into `/shared/components/` unchanged, used embedded in lessons instead of standalone

### What's new

- **Accounts (optional)** — email + password OR anonymous cookie OR passphrase. See below.
- **Course + lesson content storage** — where does the text of a lesson live?
- **Progress tracking** — KV schema for "user X completed lesson Y at time Z"
- **Audio pipeline** — script → ElevenLabs/OpenAI → R2 → lesson page

### Content storage decision

Two options:
1. **Markdown files in the repo** — each lesson is `courses/body/03-the-nose-knows.md`, built into HTML at deploy time, simple, version-controlled, no CMS
2. **KV / D1 storage with admin UI** — lessons in a database, edit in a browser

For v1, option 1 is obviously correct. Markdown in the repo. Every lesson edit is a git commit. No admin UI to build. Content is versioned, diffable, and survives forever. If we later find we're editing lessons constantly, we can add a CMS layer — but I suspect we won't, because lessons are meant to be stable after they're shipped.

Format: one markdown file per lesson, with front-matter for title, order, estimated time, which embedded component(s), audio file path. A small build step converts markdown to the lesson HTML template.

### Identity (final)

**Anonymous-first, optional email, passphrase as backup.**

- **Default:** visitor lands, reads lesson 1, progress saves in a cookie (UUID) tied to a KV record. No signup. No friction. Works immediately.
- **Optional email upgrade:** after lesson 1 is completed, a soft prompt: *"Save your progress to come back on any device. Add email, or get a 6-word passphrase."* Either choice links the anonymous cookie to a persistent identity.
- **Passphrase system:** kept from the old Zeemish — 6 random BIP39 words, server-generated, user writes it down. Used to recover/sync without giving email.
- **Email path:** email + password. Magic link for password reset. No email verification required (lower friction, accept that someone can sign up with a fake email — they're only recovering their own progress, there's nothing to abuse).

This keeps the hospitality principle. Nobody's asked for ID at the door. But anyone who wants a name tag can have one.

### KV schema (sketch)

```
user:{user_id}           → { email?, passphrase_hash?, created_at, progress: { course_slug: { current_lesson, completed: [1,2,3], last_at } } }
lesson_complete:{user_id}:{course}:{lesson} → timestamp (append-only event log for analytics)
course:{slug}            → course metadata cache (or just read from markdown build)
```

### What's deleted

- Old `/tools/`, `/sessions/`, `/audio/`, `/listens/` routes and all their directory pages
- Old hub `/index.html` with grid + Zita circle
- `/zita/` directory
- `/self/` and `/self/history/` (new self page built under `/account/` for logged-in users)
- The old `shared/tools.js`, `sessions.js`, `audio.js`, `listens.js` registries
- All Zita worker endpoints (`/refresh-library`, flow handlers, etc.)
- `claudeHint` fields from every component — no longer needed

### What's parked (revisit after v1 ships)

- Zita as a tutor — an LLM-powered guide who can answer questions about a lesson, quiz you, explain differently. Fun, valuable, not v1.
- Payment and paid tiers — no decision until there's traffic
- Multi-course — v1 is one course only, architecturally it's generic
- Community / discussion per lesson
- Mobile app wrapper — the PWA is enough until it isn't

---

## 8. What we are explicitly not building

Written out so scope doesn't quietly expand.

| Not building (v1) | Why |
|-------------------|-----|
| Zita tutor | Second product. Build after one course ships and we know what questions people ask. |
| Payments | Free until the product proves itself. |
| Multiple courses at launch | One course done well > five courses half-done. |
| Quizzes / scoring | Comprehension isn't measured by quizzes in this product. The practice is the test. |
| Gamification | Streaks and badges manipulate; Zeemish doesn't. |
| Social / community | Later, maybe, carefully. Not v1. |
| Video | Text + audio only. Maybe video for specific future courses (art, movement) if royalty-free footage can carry it. |
| Native app | PWA until clearly insufficient. |
| Translations | English only for v1. The voice is English. |
| Comments per lesson | No. |
| Course recommendations | Catalogue is small. Browse it. |
| A visible blog integration | The blog (if kept) lives at `/blog/` quietly. Not promoted. |

---

## 9. Build order

What gets built, in what order. Each stage is shippable on its own — don't start the next until the current one works end-to-end.

### Stage 1 — Foundation (before any lesson content exists)

1. **Tear down the old site** — delete the old routes, hub, Zita directory. Keep `shared/style.css`, component folders, worker infrastructure. Deploy a single holding page at `/` that says Zeemish is being rebuilt.
2. **New home page** (`/`) — wordmark, one sentence, "Browse courses" button (disabled / "coming soon" for now). Dark aesthetic, voice already visible.
3. **Lesson template** — one hardcoded lesson page at `/courses/body/1/` with dummy content, showing the five beats, next buttons, embedded component, audio player. This is the prototype. Get it feeling right before writing real lessons.
4. **Markdown → HTML build step** — small script that reads `content/body/01-the-body-youre-in.md` and produces `/courses/body/1/index.html` at deploy time. Front-matter drives the lesson template.
5. **Course page** (`/courses/body/`) — reads the course markdown index, shows lesson list.
6. **Courses catalogue** (`/courses/`) — shows the one course card.

At the end of stage 1, the site works, the template works, one dummy lesson exists. No real content yet.

### Stage 2 — Accounts and progress

1. **Anonymous cookie + KV record** — progress saves from first visit
2. **Lesson completion endpoint** — worker API for marking a lesson done
3. **Soft email-upgrade prompt after lesson 1** — email or passphrase flow
4. **Login page** — email + password OR passphrase entry
5. **Account page** (`/account/`) — current progress across courses, email management, logout, delete account

At the end of stage 2, the product works for real users, but the content is still a placeholder.

### Stage 3 — Content: course 1

1. **Draft lesson 1** — you + AI, heavy edit pass, voice check
2. **Generate audio for lesson 1** — pick the ElevenLabs/OpenAI voice, lock it, generate
3. **Ship lesson 1, test end-to-end** — read it on mobile, listen on a walk, do the practice
4. **Draft lessons 2–12** — same process, iterate voice prompt as drafts reveal weaknesses
5. **Build the two new components** — nose-breathing timer, movement timer
6. **Generate all audio**
7. **Final pass** — read the whole course end to end; cut anything that sounds like an ad, a textbook, or a LinkedIn post

### Stage 4 — Launch

1. **Delete the holding page, publish the course**
2. **SEO: canonical URLs, sitemap, meta tags per lesson**
3. **Announce however you announce things**
4. **Watch what happens: completion rates per lesson, where people drop off, what emails come in**

### Stage 5 — What to build next (after launch)

Don't decide now. Decide based on what you learn from stage 4. Likely candidates:

- Zita v2 as a tutor
- Course 2 (probably "What is AI, really" or "How attention works")
- Payment if users are asking how to support it
- Improvements to the lesson template based on where people drop off

---

## 10. Things that stay true

These don't change between old Zeemish and new Zeemish. They're the DNA.

- **The hospitality principle.** Words anyone can hear without translating, without flinching. No passport.
- **"When in doubt, remove."** A shorter lesson beats a longer one. A simpler page beats a busier one. Less on screen = more presence.
- **Honesty over flattery.** Never tell the reader they're crushing it.
- **Direct over decorated.** No "gently bring your awareness." Say the thing.
- **Dark aesthetic. Generous whitespace. Slow animations. The grain overlay. `var(--bg)` #0b1c21.**
- **Mobile-first, Android as primary test device.**
- **No build frameworks on the frontend.** Vanilla HTML, Web Components, CSS variables.
- **The voice is the moat.**

---

## 11. The risks, named

So they don't sneak up.

1. **Voice drift.** AI drafts start sounding like AI over time because AI tone converges on the mean. Fix: §2 is the system prompt. Every draft passes the editor's test. Ship lesson 1 only after it's unrecognisable as AI-written.

2. **Scope creep.** You'll be tempted to add Zita, add payments, add a second course, add community — before the first course ships. Don't. The §8 list exists to refer back to.

3. **Finishing problem.** Solo course creators often ship lesson 1, enthusiasm fades, lessons 10–12 are never written. Fix: draft all 12 lessons to a rough cut *before* polishing any of them. Then polish in passes. Don't go deep on lesson 1 until the spine is drafted end to end.

4. **The practice is the point.** If the embedded practice feels bolted on, the whole unique-edge argument collapses. Test each practice in place during stage 1 with dummy content — make sure the transition from reading to doing feels like one thing, not two.

5. **Audio cost.** ElevenLabs is not cheap at volume. 12 lessons × ~25 minutes × one voice ≈ ~£30–50 in generation. Fine. But if the course expands or voice changes happen often, watch the bill.

6. **"It's just Coursera / Substack / Medium."** It isn't, because of the voice and the embedded practice. But it needs to *feel* unlike them on first page load. Design the home page specifically to not look like any of them.

---

## 12. The short version

One paragraph you could send to someone who asks what Zeemish is now:

> Zeemish is a school for ordinary people who want to understand the subjects that actually explain the world they live in — AI, attention, the body, the mind, money, systems. Lessons are 30 minutes. Text, audio, and an optional practice built into the page. First course launches soon: "The body you live in." It's written in plain English, with no jargon, no self-help, no wellness industry, no tribe. Just a thoughtful friend explaining a difficult thing clearly. Free. No account needed to start.

That's Zeemish v2.

---

*End of founding document. Everything else — lesson drafts, voice-prompt refinements, the build script, the new CSS, the first lesson prototype — flows from this.*
