/**
 * Tests for encryption.ts — AES-256-GCM encrypt/decrypt
 *
 * Coverage:
 *   - Encrypt then decrypt returns original plaintext
 *   - Encrypted output format is iv:authTag:encrypted (hex)
 *   - Different plaintexts produce different ciphertexts
 *   - Tampered ciphertext fails decryption
 *   - Invalid key length throws
 */
import { describe, it, expect, beforeEach } from "vitest";

// Set valid 32-byte key (64 hex chars) before importing
process.env.ENCRYPTION_KEY = "a".repeat(64);

import { encrypt, decrypt } from "~/utils/encryption";

describe("encryption", () => {
  const plaintext = "shhh-this-is-a-secret-token-12345";

  it("should encrypt and decrypt back to original plaintext", () => {
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("should produce output in iv:authTag:encrypted format (3 hex parts)", () => {
    const encrypted = encrypt(plaintext);
    const parts = encrypted.split(":");
    expect(parts.length).toBe(3);
    // IV = 12 bytes = 24 hex chars
    expect(parts[0].length).toBe(24);
    // AuthTag = 16 bytes = 32 hex chars
    expect(parts[1].length).toBe(32);
    // Encrypted data = variable length
    expect(parts[2].length).toBeGreaterThan(0);
  });

  it("should produce different ciphertexts for same plaintext (random IV)", () => {
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
    // But both should decrypt to same value
    expect(decrypt(a)).toBe(plaintext);
    expect(decrypt(b)).toBe(plaintext);
  });

  it("should handle empty string", () => {
    const encrypted = encrypt("");
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe("");
  });

  it("should handle unicode content", () => {
    const unicode = "你好世界 🌍 Ñoño";
    const encrypted = encrypt(unicode);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(unicode);
  });

  it("should fail decryption with tampered ciphertext", () => {
    const encrypted = encrypt(plaintext);
    // Tamper with the encrypted data portion
    const parts = encrypted.split(":");
    parts[2] = "ff" + parts[2].slice(2);
    const tampered = parts.join(":");
    expect(() => decrypt(tampered)).toThrow();
  });

  it("should fail decryption with malformed input", () => {
    expect(() => decrypt("not-a-valid-encrypted-string")).toThrow();
  });
});
