// Application-level encryption for secrets at rest (OAuth tokens).
//
// Uses AES-256-GCM with a key from ENCRYPTION_KEY (64 hex chars = 32 bytes,
// e.g. `openssl rand -hex 32`).
//
// Lazy migration: if ENCRYPTION_KEY is unset, values are stored as-is (legacy
// plaintext). decryptSecret() detects the `enc:v1:` prefix and only decrypts
// when present, so existing plaintext tokens keep working and get re-encrypted
// on their next write (login / token refresh). The key must remain stable —
// rotating or removing it makes previously-encrypted values unrecoverable.

import crypto from 'crypto';

const PREFIX = 'enc:v1:';

function getKey(): Buffer | null {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) return null;
  try {
    const key = Buffer.from(hex, 'hex');
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain == null) return null;
  const key = getKey();
  if (!key) return plain; // no key configured → store as-is (legacy)
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

export function decryptSecret(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (!value.startsWith(PREFIX)) return value; // legacy plaintext
  const key = getKey();
  if (!key) return null; // encrypted but no key — can't recover
  try {
    const [, , ivHex, tagHex, ctHex] = value.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
