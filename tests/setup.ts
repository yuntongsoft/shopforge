/**
 * File: tests/setup.ts
 * Purpose: Global test setup — mock database and external dependencies
 *
 * This file is loaded before all tests via vitest.config.ts setupFiles.
 * It provides mock implementations for modules that require real infrastructure.
 */

// Mock the database module to avoid DATABASE_URL requirement
const mockPrisma = {
  shop: {
    findUnique: async () => null,
    findFirst: async () => null,
    create: async () => ({}),
    update: async () => ({}),
    delete: async () => ({}),
  },
};

// Use vi.mock at module level
import { vi } from "vitest";
vi.mock("~/db.server", () => ({
  default: mockPrisma,
}));

// Set dummy env vars for tests
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.ENCRYPTION_KEY = "a".repeat(64);
