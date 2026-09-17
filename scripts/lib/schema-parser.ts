/**
 * File: scripts/lib/schema-parser.ts
 * Purpose: Parse Prisma schema file and extract model field metadata
 *
 * This is the foundation for code generation — reads schema.prisma,
 * extracts model definitions with field types, and classifies fields
 * into "system" (auto-managed) vs "business" (user-editable).
 *
 * Usage:
 *   import { parsePrismaSchema, getModelFields } from "./lib/schema-parser.js";
 *   const schema = parsePrismaSchema("prisma/schema.prisma");
 *   const fields = getModelFields(schema, "Order");
 */
import fs from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** System fields that are auto-managed and should NOT appear in forms */
const SYSTEM_FIELDS = new Set([
  "id",
  "shopId",
  "createdAt",
  "updatedAt",
  "isDeleted",
]);

export interface PrismaField {
  /** Field name in camelCase (e.g., "orderName") */
  name: string;
  /** Prisma type (e.g., "String", "Int", "Boolean", "DateTime") */
  type: string;
  /** Whether the field is required (no ? modifier) */
  required: boolean;
  /** Default value if specified (e.g., "uuid()", "now()", "0", "true") */
  defaultValue: string | null;
  /** Database column name from @map */
  mapName: string | null;
  /** Whether this is a relation field (references another model) */
  isRelation: boolean;
  /** The related model name if isRelation */
  relationModel: string | null;
}

export interface PrismaModel {
  /** Model name in PascalCase (e.g., "Order") */
  name: string;
  /** Table name from @@map, or lowercase model name */
  tableName: string;
  /** All fields including system fields */
  fields: PrismaField[];
  /** Documentation comment above the model */
  doc: string;
}

export interface ParsedSchema {
  models: PrismaModel[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a Prisma schema file into structured model definitions
 */
export function parsePrismaSchema(schemaPath: string): ParsedSchema {
  const content = fs.readFileSync(schemaPath, "utf-8");
  const lines = content.split("\n");
  const models: PrismaModel[] = [];

  let currentModel: PrismaModel | null = null;
  let currentDoc = "";
  let braceDepth = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Capture doc comments (/// ...) above models
    if (line.startsWith("///") && !currentModel) {
      currentDoc = line.replace(/^\/\/\/\s*/, "");
      continue;
    }

    // Model start: "model OrderName {"
    const modelMatch = line.match(/^model\s+(\w+)\s*\{/);
    if (modelMatch) {
      currentModel = {
        name: modelMatch[1],
        tableName: modelMatch[1].toLowerCase(),
        fields: [],
        doc: currentDoc,
      };
      braceDepth = 1;
      currentDoc = "";
      continue;
    }

    if (!currentModel) continue;

    // Track braces
    if (line.includes("{")) braceDepth++;
    if (line.includes("}")) {
      braceDepth--;
      if (braceDepth === 0) {
        models.push(currentModel);
        currentModel = null;
        continue;
      }
    }

    // @@map("table_name")
    const mapMatch = line.match(/@@map\("([^"]+)"\)/);
    if (mapMatch) {
      currentModel.tableName = mapMatch[1];
      continue;
    }

    // Field: "fieldName  Type  modifiers..."
    const fieldMatch = line.match(/^(\w+)\s+(\w+)(\??)/);
    if (fieldMatch) {
      const [, name, type, optional] = fieldMatch;

      // Skip relation fields (types that start with uppercase and aren't scalar types)
      const scalarTypes = new Set([
        "String", "Int", "Float", "Boolean", "DateTime", "BigInt", "Decimal", "Json", "Bytes",
      ]);
      const isRelation = !scalarTypes.has(type);

      // Extract @default value
      const defaultMatch = line.match(/@default\(([^)]+)\)/);
      const defaultValue = defaultMatch ? defaultMatch[1] : null;

      // Extract @map value
      const fieldMapMatch = line.match(/@map\("([^"]+)"\)/);
      const mapName = fieldMapMatch ? fieldMapMatch[1] : null;

      currentModel.fields.push({
        name,
        type,
        required: optional !== "?",
        defaultValue,
        mapName,
        isRelation,
        relationModel: isRelation ? type : null,
      });
    }
  }

  return { models };
}

/**
 * Get business fields for a model (excludes system fields and relations)
 * These are the fields that should appear in forms and table columns
 */
export function getBusinessFields(model: PrismaModel): PrismaField[] {
  return model.fields.filter(
    (f) => !SYSTEM_FIELDS.has(f.name) && !f.isRelation
  );
}

/**
 * Get display columns for IndexTable (business fields minus large text fields)
 */
export function getDisplayColumns(fields: PrismaField[]): PrismaField[] {
  return fields.filter((f) => f.type !== "String" || !isLongTextField(f));
}

/**
 * Check if a string field is likely a long-text field (note, description, content, body)
 */
function isLongTextField(field: PrismaField): boolean {
  const longTextPatterns = ["note", "notes", "description", "content", "body", "detail", "details", "comment", "comments"];
  return longTextPatterns.some((p) => field.name.toLowerCase().includes(p));
}

/**
 * Find a model by name (case-insensitive)
 */
export function findModel(schema: ParsedSchema, name: string): PrismaModel | undefined {
  const lower = name.toLowerCase();
  return schema.models.find((m) => m.name.toLowerCase() === lower);
}

/**
 * Check if a model has a shopId field (required for multi-tenant scoping)
 */
export function hasShopId(model: PrismaModel): boolean {
  return model.fields.some((f) => f.name === "shopId");
}
