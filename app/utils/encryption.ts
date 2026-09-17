/**
 * File: encryption.ts
 * Author: yuntongsoft
 * Date: 2026/08/04
 * Purpose: AES-256-GCM encryption for sensitive data (Shopify tokens, etc.)
 *
 * Dependencies: crypto (Node.js built-in)
 * Used by: shopify.server.ts, auth routes, shopify.service.ts
 *
 * Usage:
 *   import { encrypt, decrypt } from "~/utils/encryption";
 *   const encrypted = encrypt("plain-text-token");
 *   const decrypted = decrypt(encrypted);
 */
import crypto from "crypto";

const GCM_ALGORITHM = "aes-256-gcm";
const GCM_IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY environment variable is not set");
  }
  const keyBuffer = Buffer.from(key, "hex");
  if (keyBuffer.length !== 32) {
    throw new Error(`ENCRYPTION_KEY must be 32 bytes, got ${keyBuffer.length} bytes`);
  }
  return keyBuffer;
}

/**
 * Encrypt a string using AES-256-GCM
 * @returns Format: "iv:authTag:encrypted" (hex-encoded)
 */
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv(GCM_ALGORITHM, getEncryptionKey(), iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypt an AES-256-GCM encrypted string
 * @param text - Format: "iv:authTag:encrypted" (hex-encoded)
 */
export function decrypt(text: string): string {
  const parts = text.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted text format");
  }

  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encryptedHex = parts[2];

  if (iv.length !== GCM_IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${GCM_IV_LENGTH}, got ${iv.length}`);
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(`Invalid auth tag length: expected ${AUTH_TAG_LENGTH}, got ${authTag.length}`);
  }

  const decipher = crypto.createDecipheriv(GCM_ALGORITHM, getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
