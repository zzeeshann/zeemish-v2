#!/usr/bin/env node
// Regression test for spliceAudioBeats in publisher.ts.
//
// Exists because the 2026-04-17 frontmatter corruption came from a
// regex that consumed the leading newline before the audioBeats block.
// The node-level test lets us verify the pure string transformation
// without standing up the full agents worker.
//
// Usage: node agents/scripts/verify-splice.mjs
// Exit code: 0 on all pass, 1 on any failure.

// Inline copy of the function — import-time ESM from a TS file inside
// agents/ would require full tsc setup; since this is a small string
// transformation we keep the duplicate in sync by eye. The regex must
// match publisher.ts:spliceAudioBeats. Sync if one changes.
function spliceAudioBeats(mdx, audioBeats) {
  const withoutExisting = mdx.replace(/(\n)audioBeats:\n(?:  .+\n)*/, '$1');
  const lines = Object.entries(audioBeats).map(
    ([key, url]) => `  ${key}: ${JSON.stringify(url)}`,
  );
  const block = `\naudioBeats:\n${lines.join('\n')}`;
  return withoutExisting.replace(
    /^(---\n[\s\S]*?)(\n---\n)/,
    `$1${block}$2`,
  );
}

let passed = 0;
let failed = 0;

function assertEq(name, actual, expected) {
  if (actual === expected) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`  expected: ${JSON.stringify(expected)}`);
    console.error(`  actual:   ${JSON.stringify(actual)}`);
  }
}

// ─── Case 1: fresh MDX, no existing audioBeats → adds block ────
{
  const input = `---
title: "Test"
date: "2026-04-22"
---

# body
`;
  const expected = `---
title: "Test"
date: "2026-04-22"
audioBeats:
  beat-1: "https://r2.example/1.mp3"
  beat-2: "https://r2.example/2.mp3"
---

# body
`;
  const actual = spliceAudioBeats(input, {
    'beat-1': 'https://r2.example/1.mp3',
    'beat-2': 'https://r2.example/2.mp3',
  });
  assertEq('Case 1: fresh MDX adds audioBeats block', actual, expected);
}

// ─── Case 2: re-splice same map → idempotent, output === input ────
{
  const input = `---
title: "Test"
qualityFlag: "low"
audioBeats:
  beat-1: "https://r2.example/1.mp3"
  beat-2: "https://r2.example/2.mp3"
---

# body
`;
  const actual = spliceAudioBeats(input, {
    'beat-1': 'https://r2.example/1.mp3',
    'beat-2': 'https://r2.example/2.mp3',
  });
  assertEq('Case 2: idempotent re-splice with identical map', actual, input);
}

// ─── Case 3: re-splice different map → strips old, inserts new,
//     frontmatter terminator intact (THE 2026-04-17 CORRUPTION CASE) ────
{
  const input = `---
title: "Test"
qualityFlag: "low"
audioBeats:
  beat-1: "https://r2.example/old1.mp3"
---

# body
`;
  const expected = `---
title: "Test"
qualityFlag: "low"
audioBeats:
  beat-1: "https://r2.example/new1.mp3"
  beat-2: "https://r2.example/new2.mp3"
---

# body
`;
  const actual = spliceAudioBeats(input, {
    'beat-1': 'https://r2.example/new1.mp3',
    'beat-2': 'https://r2.example/new2.mp3',
  });
  assertEq('Case 3: re-splice different map preserves frontmatter terminator', actual, expected);
}

// ─── Case 4: audioBeats followed by another frontmatter key (not ---)
//     → strip only the audioBeats block, keep the later key. The new
//     audioBeats gets re-inserted at end-of-frontmatter (splice regex
//     targets the position just before closing `---`), so block
//     position changes. That's fine — content schema doesn't care
//     about frontmatter key order. Other keys must survive. ────
{
  const input = `---
title: "Test"
audioBeats:
  beat-1: "https://r2.example/1.mp3"
voiceScore: 95
---

# body
`;
  const expected = `---
title: "Test"
voiceScore: 95
audioBeats:
  beat-1: "https://r2.example/new1.mp3"
---

# body
`;
  const actual = spliceAudioBeats(input, {
    'beat-1': 'https://r2.example/new1.mp3',
  });
  assertEq('Case 4: audioBeats followed by another key — strips block, keeps sibling key', actual, expected);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
