// AES-GCM encryption for secrets stored at rest (per-vendor payment keys).
// The key is derived from the app's BETTER_AUTH_SECRET, so no extra secret is
// required. Web Crypto — works in Workers and Node.

async function deriveKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Encrypt a string; output is base64(iv[12] ++ ciphertext). */
export async function encryptSecret(plaintext: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const ctBytes = new Uint8Array(ct);
  const buf = new Uint8Array(iv.length + ctBytes.length);
  buf.set(iv, 0);
  buf.set(ctBytes, iv.length);
  return toBase64(buf);
}

/** Decrypt a base64(iv ++ ciphertext) blob; returns null if it can't be decrypted. */
export async function decryptSecret(blob: string, secret: string): Promise<string | null> {
  try {
    const key = await deriveKey(secret);
    const raw = fromBase64(blob);
    const iv = raw.slice(0, 12);
    const ct = raw.slice(12);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
