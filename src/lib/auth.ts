/**
 * Password hashing and session utilities.
 * Uses Web Crypto API (PBKDF2) — works natively in Cloudflare Workers,
 * no npm dependencies needed.
 */

const SALT_LENGTH = 16;
const ITERATIONS = 100_000;
const KEY_LENGTH = 32;

/**
 * Hash a password using PBKDF2 with a random salt.
 * Returns "salt:hash" as hex strings.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = await deriveKey(password, salt);
  const hash = await crypto.subtle.exportKey('raw', key);
  return `${toHex(salt)}:${toHex(new Uint8Array(hash))}`;
}

/**
 * Verify a password against a stored "salt:hash" string.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;

  const salt = fromHex(saltHex);
  const key = await deriveKey(password, salt);
  const hash = await crypto.subtle.exportKey('raw', key);
  return toHex(new Uint8Array(hash)) === hashHex;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey'],
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH * 8 },
    true,
    ['encrypt'],
  );
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Generate a UUID for anonymous users.
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Parse the zee-session cookie value.
 */
export function parseSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/zee-session=([^;]+)/);
  return match?.[1] ?? null;
}

/**
 * Build a Set-Cookie header for the session.
 */
export function sessionCookie(userId: string, maxAge = 365 * 24 * 60 * 60): string {
  return `zee-session=${userId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

/**
 * Build a Set-Cookie header that clears the session.
 */
export function clearSessionCookie(): string {
  return `zee-session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
