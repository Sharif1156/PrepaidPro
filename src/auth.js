/**
 * A sign-in token for a person's own DESCO account.
 *
 * After a successful DESCO sign-in the server hands the browser a token. The token is
 * the login sealed with AES-256-GCM under a key only the server knows
 * (SESSION_SECRET), so the browser never keeps the plain password, the server
 * keeps nothing on disk, and anyone who copies the token cannot read the
 * password out of it. Without SESSION_SECRET a random key is made at every
 * start, so people have to sign in again after a restart.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const ephemeral = randomBytes(32).toString('hex');

export function sessionSecretIsSet() {
  return Boolean(process.env.SESSION_SECRET);
}

function key() {
  const secret = process.env.SESSION_SECRET || ephemeral;
  return createHash('sha256').update(`prepaidpro-session-v1:${secret}`).digest();
}

export function seal({ username, password }) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify({ u: username, p: password, t: Date.now() }), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

/** Returns { username, password } or null when the token is not valid. */
export function unseal(token) {
  try {
    const raw = Buffer.from(String(token || ''), 'base64url');
    if (raw.length < 29 || raw.length > 2048) return null;
    const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    const data = JSON.parse(text);
    if (!data?.u || !data?.p || Date.now() - Number(data.t) > MAX_AGE_MS) return null;
    return { username: String(data.u), password: String(data.p) };
  } catch {
    return null;
  }
}
