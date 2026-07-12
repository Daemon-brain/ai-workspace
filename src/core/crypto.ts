/**
 * API-key encryption at rest: AES-256-GCM, key derived from WORKSPACE_SECRET.
 * Ciphertext format: base64(iv).base64(authTag).base64(ciphertext)
 *
 * Keys are decrypted only server-side, per request, and never serialized into
 * any API response — GET /api/providers returns a masked preview instead.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (!cachedKey) {
    const secret = process.env.WORKSPACE_SECRET;
    if (!secret || secret.length < 16) {
      throw new Error("WORKSPACE_SECRET is missing or too short (see .env.example)");
    }
    cachedKey = scryptSync(secret, "ai-workspace-keys-v1", 32);
  }
  return cachedKey;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(blob: string): string {
  const [iv, tag, enc] = blob.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/** Safe preview for UIs: "sk-ant-…Xk4w" — never the full key. */
export function maskSecret(plain: string): string {
  if (plain.length <= 8) return "…";
  return `${plain.slice(0, 7)}…${plain.slice(-4)}`;
}
