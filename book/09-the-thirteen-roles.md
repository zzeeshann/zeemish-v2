# 09 — The thirteen roles

Chapter 6 explained what an agent is. Chapter 8 explained what Zeemish does. This chapter explains how the two fit together — the thirteen specific roles that make up Zeemish's daily pipeline.

A quick reminder from chapter 6: seven of these roles use Claude to make decisions. The other six are supporting code. Both kinds matter. Both kinds are called "agents" in the repo because they each have one clear job and live in one file. That's the only thing the word "agent" promises in Zeemish.

Here they are, in the order they run.

## 1. Scanner

**Job:** Fetch today's news headlines.

**What it does:** Reads six RSS feeds — Reuters, AP, BBC, Axios, a few others. Deduplicates stories that appear in multiple feeds. Stores the result in a table called `daily_candidates`. Typically produces around 50 candidate stories per run.

**Claude call?** No. Just code parsing XML from RSS feeds.

**Why this separation matters:** Scanner's job is boring but reliable. Keeping it free of Claude means Scanner always works, even if Anthropic's API has a bad day. You don't want your news fetcher depending on a language model.

## 2. Director

**Job:** Route work between agents. Keep the pipeline moving.

**What it does:** When 2am UTC hits, Director wakes up. It calls Scanner. When Scanner finishes, it calls Curator. When Curator finishes, it calls Drafter. And so on. It is the conductor. It does not do any of the work itself.

**Claude call?** No. Zero. This is the explicit design — one pure orchestrator, no model calls, no judgment. Just routing.

**Why:** A router that makes judgments is harder to debug than a router that just passes messages. Keeping Director dumb-on-purpose makes the pipeline easier to reason about.

## 3. Curator

**Job:** Pick the most teachable story from Scanner's 50 candidates.

**What it does:** Reads all 50 candidates. Picks one. Writes a brief — a short document explaining what the story is, what the underlying system is, what angle the piece should take, and roughly what beats the piece should have.

**Claude call?** Yes. One call with the 50 candidates and a prompt asking for the most teachable one. Also sees the last 30 days of published headlines (so it can try for variety, though as of this writing, variety isn't strongly enforced — see FOLLOWUPS).

**What "teachable" means in Zeemish's prompt:** a story where there's a real underlying system worth explaining, not just a headline. "Market rose 2%" is not teachable. "Market rose 2% on news of a chip shortage in a single factory" is teachable, because the factory-market connection reveals a chokepoint.

## 4. Drafter

**Job:** Write the piece.

**What it does:** Takes the brief from Curator. Loads the voice contract (the rules for how Zeemish writes). Loads the most recent learnings from past pieces. Produces a complete MDX file — the piece's text, formatted with beat headings, with frontmatter (title, date, beat count, tier, etc.).

**Claude call?** Yes. The biggest one in the pipeline — producing 1,000 to 1,500 words of polished prose takes the most model work.

**Note about the loop:** As of 2026-04-19, Drafter also has a second job — reflecting on its own piece after publication. That's handled by a separate method on the same file. Chapter 14 explains this in full.

## 5. Voice Auditor

**Job:** Check if the piece actually sounds like Zeemish.

**What it does:** Reads the draft. Checks it against the voice contract — no tribe words, plain English, short sentences, hospitality principle. Produces a score out of 100 and a list of specific violations if any. Passes if score ≥ 85.

**Claude call?** Yes. A different prompt than Drafter — this one is specifically for judgment, not writing.

**Why a separate agent?** Because the thing writing the piece is not the best thing to judge the piece. Separation of concerns. A different Claude call, with a different prompt focused only on voice, produces more reliable quality control than asking the same call to self-check.

## 6. Fact Checker

**Job:** Check that the claims in the piece are correct.

**What it does:** Extracts factual claims from the draft ("fuel rose 40%," "Spirit's margin is 4%," "QVC reached 96 million households"). Checks each one. Originally designed to use a web search tool for verification; in practice, most verification currently lands on Claude's own knowledge because the web search tool it uses (DuckDuckGo Instant Answer) only resolves about 5% of specific claims. A richer search backend is in the followups list.

**Claude call?** Yes. Plus a web search call that often returns nothing useful.

**Pass condition:** No claim is flagged `incorrect`. Unverified claims are allowed — see the honesty about the DDG limitation above.

## 7. Structure Editor

**Job:** Check the shape of the piece.

**What it does:** Reads the draft. Checks that the hook is one screen, the close is one sentence, there are 3–6 beats, the piece has frontmatter, the word count is in range, the flow makes sense. Flags specific structural issues.

**Claude call?** Yes. Another judgment call, focused on shape rather than voice or facts.

**What it doesn't check yet:** the "Watch" beat. The format spec says every piece should have a Watch beat — what to look for next — but Structure Editor doesn't currently gate on it. On the followups list.

## 8. Integrator

**Job:** Take the auditors' feedback and fix the piece.

**What it does:** If any of the three auditors failed, Integrator reads their feedback, rewrites the piece to address the issues, and sends the result back through the auditors. This can happen up to three times. If it still fails after three rounds, the piece escalates to a human (in practice, an observer event and a visible marker on the dashboard).

**Claude call?** Yes. Depending on how bad the draft was, one to three calls.

**Why three rounds:** arbitrary but practical. Most fixable pieces fix in one or two rounds. Anything needing more than three rounds probably has a deeper problem that a human should see.

## 9. Publisher

**Job:** Commit the finished piece to GitHub so it goes live.

**What it does:** Takes the approved MDX. Writes it to the right filename (`YYYY-MM-DD-slug.mdx`). Commits to GitHub. This triggers GitHub Actions, which deploys the site, which means the piece is live on `zeemish.io` within two minutes.

**Claude call?** No. Just GitHub API calls.

## 10. Audio Producer

**Job:** Narrate the piece, beat by beat, as audio.

**What it does:** Reads the published piece. For each beat (hook, teaching 1, teaching 2, etc.), calls ElevenLabs to generate an MP3. Uploads each MP3 to R2 (Cloudflare's object storage). Saves the URLs in D1.

**Claude call?** No. ElevenLabs is a different kind of AI, for voice synthesis.

**Why beat by beat:** A single long audio file is clumsier than per-beat clips. Per-beat audio can be navigated — listeners can skip to a specific beat. Also, per-beat clips let the audio pipeline resume from where it stopped if something breaks. Chapter 13 goes into the technical story.

## 11. Audio Auditor

**Job:** Check that the audio files are real and sized correctly.

**What it does:** Reads the audio records from D1. For each one, does a HEAD request to R2 — just checks "does this file exist, and is it the right size?" — without downloading the whole MP3. Flags missing or anomalously-sized files.

**Claude call?** No. Just R2 metadata checks.

**What it doesn't do:** Listen to the audio to verify it sounds right. That would require a speech-to-text pass, which is on the followups list.

## 12. Learner

**Job:** Write patterns to a `learnings` table so future pieces get better.

**What it does:** After each publish, reads the piece's full quality record — audit scores, revision rounds, which candidate Curator picked vs passed over, pipeline timing. Looks for patterns. Writes short observations to the `learnings` table with `source='producer'`.

When readers eventually arrive, the same Learner also reads reader engagement data (views, completions, drop-off points, audio play rate) and writes `source='reader'` patterns.

When Zita conversations accumulate, Learner also reads those and writes `source='zita'` patterns.

**Claude call?** Yes, one per signal source per run.

**How this closes the loop:** the `learnings` table gets read by the Drafter on the next piece (chapter 4 of this shift, chapter 14 of this book). So the system's self-knowledge flows back into the next piece's writing prompt. Chapter 14 explains this in full.

## 13. Observer

**Job:** Log every pipeline event.

**What it does:** Every time any other agent does anything notable — started, finished, escalated, failed — it sends an event to Observer. Observer writes the event to the `observer_events` table. The dashboard reads from this table to show what's happening now and what went wrong recently.

**Claude call?** No. Just logging.

**Why this matters:** Without Observer, nothing on the dashboard works. The transparency promise of Zeemish — that every piece has a "how this was made" drawer — depends on Observer having logged the relevant events at the time they happened.

## Plus one more thing

Chapter 14 will explain that Drafter has a second, separate role — reflecting on each piece after publication. This is not a fourteenth agent. It's a second method on the existing Drafter file, called post-publish, writing to `learnings` with `source='self-reflection'`.

The reason Drafter does this rather than a new agent is simple: the thing that wrote the piece is the right thing to reflect on the piece. Reflection is not a new voice; it's the same voice, now looking back. One file, two jobs.

## If you remember one thing from this chapter

The thirteen roles are the scaffolding. The scaffolding exists so each role can be small, focused, and changeable. The work happens inside the roles. The framing — "13 agents" — is a way of organising code, not a claim about collective intelligence.

The interesting thing isn't that there are thirteen of them. The interesting thing is what comes out the other end every morning.
