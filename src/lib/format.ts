/**
 * Display helpers for consistent formatting across the site.
 */

/** Format reading time — always shows "X min" */
export function formatTime(time: string | number): string {
  const str = String(time).trim();
  if (str.includes('min')) return str;
  return `${str} min`;
}

/** Format date as "16 April 2026" */
export function formatDate(dateStr: string): string {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const day = parseInt(parts[2], 10);
  const month = months[parseInt(parts[1], 10) - 1] ?? parts[1];
  const year = parts[0];
  return `${day} ${month} ${year}`;
}
