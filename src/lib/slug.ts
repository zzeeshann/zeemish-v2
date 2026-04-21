/**
 * Derive the URL slug for a daily piece from its content-collection id.
 *
 * Astro's glob loader uses the filename-without-extension as `entry.id`.
 * Daily-piece filenames follow the convention `YYYY-MM-DD-{slug}.mdx`
 * set by `agents/src/director.ts` at publish time. The slug in the URL
 * is the filename with the date prefix stripped.
 *
 * Examples:
 *   2026-04-17-home-shopping-network-pioneer-qvc-files-for-bankruptcy-prote
 *   →  home-shopping-network-pioneer-qvc-files-for-bankruptcy-prote
 *
 * Used by:
 *   - `src/pages/daily/[date]/[slug].astro` getStaticPaths
 *   - `src/pages/index.astro` hero URL
 *   - `src/pages/daily/index.astro` / `src/pages/library/index.astro` list URLs
 *   - `src/pages/dashboard/admin/piece/[date].astro` "View on site" link
 *     (looks up the collection entry by date)
 */
export function deriveSlug(entryId: string): string {
  return entryId.replace(/^\d{4}-\d{2}-\d{2}-/, '');
}

/** Build the canonical URL for a piece given its date + slug. */
export function pieceUrl(date: string, slug: string): string {
  return `/daily/${date}/${slug}/`;
}
