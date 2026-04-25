# 18 — How the world finds Zeemish

For the first eight days of its life, Zeemish was published but invisible.

A piece would land on the site at 02:00 UTC. The text was there. The audio worked. The library page listed it. Someone who already knew the URL could read it.

Nobody else could find it. Not Google. Not Bing. Not Feedly. Not the AI training pipelines that scrape the open web for new content. None of them knew the site existed in any way that mattered.

This is the chapter on what changed on April 25, 2026, and why each piece of the change does what it does.

## The shape of the problem

A website is just a folder of pages. Putting it online makes the pages reachable, but it doesn't make them findable. The internet is enormous; nobody is sitting at a screen waiting for your URL to appear. To be findable, you need to *announce yourself* in formats the rest of the internet already speaks.

Zeemish was reachable from day one. It became findable on day eight.

Three problems compounded the invisibility.

**No map.** Search engines crawl the web by following links. If nothing links to a page, the search engine never sees it. A sitemap is a machine-readable list of every page on a site, handed to the search engine directly. Without one, the search engine has to discover pages the slow, lossy way — by stumbling onto inbound links from other sites. For a brand-new publication with no inbound links, this means *years* of waiting.

**No feed.** Some readers don't use search engines at all. They use feed readers — apps like Feedly, Inoreader, NetNewsWire — that subscribe to publications and pull new pieces automatically. Feed readers expect a specific format called RSS. Without it, the publication is invisible to that audience entirely.

**No previews.** When someone shares a Zeemish link on Twitter or in a Slack channel, the platform tries to fetch a preview — a small card with a title, description, and image. Zeemish was sending the right title and description, but the image was an SVG file, and no major social platform renders SVG previews. So every link to Zeemish was previewing as bare text or a broken thumbnail. The exact opposite of what a shared link is supposed to do.

The fix was four commits, all on April 25.

## Sitemap: the machine-readable index

The first commit added a sitemap at `https://zeemish.io/sitemap.xml`. It's an XML file that lists every URL on the site, with a last-modified date for each.

The format is a standard. Every search engine knows how to read it. Submit the URL once to Google Search Console (a free tool), and Google starts crawling the listed pages on a schedule. New pages added later are picked up automatically — the sitemap is regenerated on every request, so it's always current.

Zeemish's sitemap currently lists 25 URLs: the homepage, the daily index, the library, the 12 published daily pieces, the 7 standalone interactives, and 3 category pages. As the library grows, the sitemap grows with it. No human ever has to update it.

Two choices in this commit are worth noting because they break from the obvious path.

First: Astro (the framework Zeemish runs on) has an official sitemap plugin. Zeemish doesn't use it. The plugin only enumerates pages that are *prerendered* — built ahead of time into static HTML. Zeemish's library and category pages aren't prerendered; they're rendered fresh on each request because they need to query the database for the current category list. The plugin would have silently skipped them. Hand-rolling the sitemap in one file gave full control of what gets included.

Second: a sitemap could split into multiple files when it gets very large (the format supports up to 50,000 URLs per file, with an "index" file pointing at them). Zeemish has 25 URLs today and would need to grow 2,000× to hit that limit. Single file, no index. When the time comes, splitting it is a small change.

## RSS: the push-style feed

The second commit added an RSS feed at `https://zeemish.io/rss.xml`. Same data as the sitemap (URLs to daily pieces) but in a different format — one designed for *subscriptions* rather than *crawling*.

RSS is older than the modern web. It dates from 1999. It's still widely used because it solves a specific problem cleanly: how do you let someone follow a publication without depending on email or social media or a custom app? Answer: a small file the publication updates whenever something new lands, in a format every feed reader already knows how to read.

Zeemish's RSS feed lists every daily piece, newest first, with title, description, publication date, and a unique identifier per piece. A feed reader fetches the file periodically; when it sees a piece it hasn't seen before, it shows the new piece to the reader.

The unique identifier is worth a sentence. RSS calls it a "guid" — a globally unique ID that lets feed readers de-duplicate. Most sites use the URL of each piece. Zeemish uses the piece's internal database UUID instead. The reason is durability: if the URL of a piece ever changes (say, the slug structure gets revised in a future redesign), feed readers indexed by URL would re-publish the same piece as if it were new. Indexed by UUID, they wouldn't. The piece's identity outlives its address.

There's also a small line in the page header of every page on the site that points feed readers at the feed automatically. When you click "subscribe" in Feedly with `zeemish.io` typed in the URL bar, Feedly finds the feed without you knowing where it is. That's what `<link rel="alternate" type="application/rss+xml">` does in the HTML head.

## The robots.txt nudge

`robots.txt` is a small file at the root of every website that tells search engines what they're allowed to crawl. Zeemish's robots.txt blocks the admin and account pages (no point indexing them) and allows everything else.

This commit added one new line: `Sitemap: https://zeemish.io/sitemap.xml`. It's a hint. Search engines that respect the directive will fetch the sitemap automatically the next time they visit, without anyone needing to submit it manually. Belt and braces — the manual submission is still recommended, but this catches the crawlers that weren't told.

## OG image: the social preview card

The second commit also replaced the broken SVG preview image with a PNG.

When you paste a URL into Slack or Twitter or LinkedIn or WhatsApp, the platform fetches the page, looks for a specific tag in the HTML head called `og:image`, and uses that image to show a preview card. Cards make people more likely to click. Cards without images make people scroll past.

Zeemish was advertising an SVG file as its OG image. SVGs are vector graphics — small, scalable, perfect for icons. They are also, in practice, *not rendered* by social platforms. Twitter, LinkedIn, Facebook, WhatsApp, iMessage, Slack — all of them silently drop SVG previews and show no image at all.

The fix was straightforward: rasterise the same design into a PNG file, 1200 by 630 pixels (the size every platform expects). Cream background, "zeemish" wordmark in deep teal, the tagline "Educate yourself for humble decisions." in dark ink, a small gold underline accent. No "made by N agents" subtitle — that count would go stale every time the team grew, so it was dropped entirely.

The PNG is generated by a one-off script. The script's source — a small SVG written in code — is the design. To change the OG card, you edit the SVG inside the script, run the script once, commit the new PNG. The PNG is what gets shipped. Same image on every page for now; per-piece preview cards (with the headline of each daily piece on its own card) is a future project that requires rendering images at the edge of the network.

## JSON-LD: the structured data layer

The third commit added something more subtle and potentially the most powerful piece of the three: a JSON-LD block on every daily piece page.

JSON-LD is structured data. It's a small JSON document embedded in the page that describes what the page *is* — not in human prose, but in a vocabulary search engines can parse. For an article, the vocabulary is `Article`. The block names the headline, the description, the publish date, the author (Zeemish, an Organization), the publisher (Zeemish, with a logo), and a representative image.

Why this matters: Google uses structured data to decide whether a page is eligible for *rich results* — those enhanced search cards with images, dates, author photos. Without structured data, a page can show up in search but only as a plain blue link. With structured data, it can show up as an article card. The rich result is more clickable, more credible, more trusted. Same content, different presentation.

There's a related schema called `NewsArticle`. Zeemish considered it and chose `Article` instead. The reason is honesty: Zeemish *teaches*; it doesn't *report*. NewsArticle implies primary reporting — datelines, beat coverage, the editorial discipline of a newsroom. Calling Zeemish a NewsArticle would misrepresent the work to the classifier and risk being judged against news-quality signals (like having a verified newsroom, fact-check authority, source diversity). Article is the truthful fit.

Each piece's JSON-LD also includes an `AudioObject` — a small section that says "this article has audio narration, here's a sample clip." It points at the piece's "hook" beat, the opening clip every Zeemish piece has. Google uses this to surface play buttons in search results for audio-enabled articles. Whether that surfacing is widespread today or two years from now, the data is in place.

A small honest detail: Zeemish has per-beat audio (typically 3–6 separate clips per piece). The JSON-LD currently only references one clip — the hook. A future version could enumerate all of them as an array. For now, the goal is to signal "audio exists" to search engines; one AudioObject does that.

## The meta description fix

The same commit closed a small bug. Zeemish's HTML pages all had an `og:description` tag (the description used in social-share previews) but only some pages had a `<meta name="description">` tag (the description that shows up in search results). The login page, the auth-verify page, and the admin dashboard had the social one but not the search one. They appeared in search with whatever Google decided to scrape from the page body — usually awkward.

The fix consolidated both tags onto a single source of truth in the page layout. If the page passes its own description, both tags use it. If not, both fall back to a brand-default. Either way, both tags always exist.

Small fix. Five lines of code. Closes the gap on every page.

A fourth commit closed the same gap from the other direction. The interactive pages — those standalone-quiz URLs — were already feeding their meta description from a field called `concept`: the one-sentence summary of what each quiz teaches ("How a single narrow point in a system can determine the shape of everything downstream.", say, for the chokepoints quiz). But the field was *optional* in the schema. A future bug, or a future minimally-authored interactive, could ship with an empty concept and silently fall back to the generic site description. The fix made the field required at the schema level, added a structural check that rejects empty concepts before any file is written, and extended the auditor — the agent that judges quiz quality — to flag concepts that are blank or written like a topic label rather than a sentence. Three layers of defense, so an empty meta description never reaches a search engine. The bug never actually fired in production; the fix is the kind of belt-and-braces that pays off on the day a new interactive type lands and someone forgets to populate one field.

## Why this matters more than it sounds

Each of these things — sitemap, RSS, OG image, JSON-LD, meta description — is a small, well-documented standard. None is novel. None requires a new dependency. The total code change across all four commits was under 500 lines.

But the cumulative effect is the difference between a publication that exists and one that *can be found*. For a daily publication, the second matters more. A piece that nobody reads is a piece that doesn't compound — no engagement signal, no Zita questions, no learning, no growing audience. The whole self-improvement loop the previous chapter describes is downstream of someone finding the piece in the first place.

The platform doesn't owe you visibility. You have to claim it, in formats it understands.

## The honest caveat

Doing the SEO foundations doesn't guarantee traffic. It guarantees *eligibility* for traffic. Whether traffic arrives depends on what every other publication is doing in your space, on how Google's ranking changes month to month, on whether anyone shares your work, on whether your work is good enough that the share is worth their attention.

What the foundations remove is the technical reason people aren't finding you. They don't manufacture demand. They make sure that when demand exists, the technology doesn't get in the way.

Zeemish has been live for eight days. The first crawl will probably land within a week of submission. The first organic visitor will probably arrive shortly after. Whether that grows into something larger depends on what every chapter of this book is about — the writing, the audio, the learning loop, the discipline of publishing daily. SEO is necessary, not sufficient.

## If you remember one thing

A new website is not findable just because it exists. You have to hand the rest of the internet a small set of standard files — a sitemap, a feed, a properly formatted preview image, a structured-data block — that tell every other system what your site is and where its content lives. Until you do that, you are publishing into a forest where nobody is listening. After you do it, the forest can hear you. Whether anyone walks toward the sound is a separate question. But the trees know you're there.
