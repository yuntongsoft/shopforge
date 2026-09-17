/**
 * File: scripts/generate.ts
 * Purpose: Code generator — creates complete CRUD route from Prisma model
 *
 * Usage:
 *   npx tsx scripts/generate.ts Order
 *   npx tsx scripts/generate.ts Product --force
 *
 * What it does:
 *   1. Parses prisma/schema.prisma
 *   2. Finds the specified model
 *   3. Extracts business fields (excludes id, shopId, timestamps)
 *   4. Generates a complete Remix route file with:
 *      - Authenticated loader (shop-scoped query)
 *      - Authenticated action (create/update/delete with rate limiting)
 *      - Polaris IndexTable + Modal form UI
 *      - Proper TypeScript types
 *   5. Writes to app/routes/app.{model-lowercase}.tsx
 *
 * After generation:
 *   - Run `npm run db:push` to sync the new model to your database
 *   - Add a NavMenu entry in app/routes/app.tsx
 *   - Add i18n keys to your locale files
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parsePrismaSchema,
  findModel,
  getBusinessFields,
  getDisplayColumns,
  hasShopId,
  type PrismaField,
  type PrismaModel,
} from "./lib/schema-parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const modelName = args[0];
const force = args.includes("--force");

if (!modelName) {
  console.error("Usage: npx tsx scripts/generate.ts <ModelName> [--force]");
  console.error("Example: npx tsx scripts/generate.ts Order");
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

const schemaPath = path.join(ROOT, "prisma", "schema.prisma");
if (!fs.existsSync(schemaPath)) {
  console.error(`Schema not found at: ${schemaPath}`);
  process.exit(1);
}

const schema = parsePrismaSchema(schemaPath);
const model = findModel(schema, modelName);

if (!model) {
  console.error(`Model "${modelName}" not found in schema.`);
  console.error(`Available models: ${schema.models.map((m) => m.name).join(", ")}`);
  process.exit(1);
}

if (!hasShopId(model)) {
  console.error(`Model "${model.name}" is missing "shopId" field. Multi-tenant scoping requires shopId.`);
  process.exit(1);
}

const businessFields = getBusinessFields(model);
const displayColumns = getDisplayColumns(businessFields);
const formFields = businessFields.filter((f) => f.type !== "DateTime");

const routeName = model.name.toLowerCase();
const outputFile = path.join(ROOT, "app", "routes", `app.${routeName}.tsx`);

if (fs.existsSync(outputFile) && !force) {
  console.error(`File already exists: ${outputFile}`);
  console.error("Use --force to overwrite.");
  process.exit(1);
}

// Generate the route file
const code = generateRouteCode(model, businessFields, displayColumns, formFields);
fs.writeFileSync(outputFile, code, "utf-8");

console.log(`\n✅ Generated: app/routes/app.${routeName}.tsx`);
console.log(`   Model: ${model.name} (${businessFields.length} business fields)`);
console.log(`   Columns: ${displayColumns.map((f) => f.name).join(", ")}`);
console.log(`   Form fields: ${formFields.map((f) => f.name).join(", ")}`);
console.log(`\nNext steps:`);
console.log(`  1. Run: npm run db:push`);
console.log(`  2. Add to app/routes/app.tsx NavMenu:`);
console.log(`     <a href="/app/${routeName}">${model.name}</a>`);
console.log(`  3. Add i18n keys to your locale files\n`);

// ─────────────────────────────────────────────────────────────────────────────
// Code Generation Templates
// ─────────────────────────────────────────────────────────────────────────────

function generateRouteCode(
  model: PrismaModel,
  allFields: PrismaField[],
  columns: PrismaField[],
  formFields: PrismaField[]
): string {
  const modelNameLower = model.name.toLowerCase();
  const modelNamePlural = modelNameLower + "s";
  const modelNameUpper = model.name;

  // Determine which Polaris components are needed
  const needsCheckbox = formFields.some((f) => f.type === "Boolean");
  const needsNumberFields = formFields.some((f) => isNumericType(f));
  const needsSelect = formFields.some((f) => isStatusField(f));
  const needsLongText = formFields.some((f) => isLongTextField(f));

  // Generate state declarations
  const stateDeclarations = formFields
    .map((f) => {
      const defaultVal = getInitialValue(f);
      return `  const [${f.name}, set${capitalize(f.name)}] = useState(${defaultVal});`;
    })
    .join("\n");

  // Generate reset function
  const resetFields = formFields
    .map((f) => {
      const defaultVal = getInitialValue(f);
      return `    set${capitalize(f.name)}(${defaultVal});`;
    })
    .join("\n");

  // Generate form field JSX
  const formFieldJsx = formFields
    .map((f) => generateFormField(f))
    .join("\n            ");

  // Generate table headings
  const headings = columns
    .map((f) => `{ title: "${humanize(f.name)}" }`)
    .join(",\n              ");

  // Generate table cells
  const cells = columns
    .map((f) => generateTableCell(f))
    .join("\n                ");

  // Generate action create data fields
  const createFields = formFields
    .map((f) => `      ${f.name}: ${getFormDataValue(f)},`)
    .join("\n");

  // Generate action update data fields
  const updateFields = formFields
    .map((f) => `      data.${f.name} = ${getFormDataValue(f)};`)
    .join("\n");

  // Generate edit handler fields
  const editFields = formFields
    .map((f) => {
      if (f.type === "Decimal") {
        // Prisma Decimal needs explicit conversion to number
        return `    set${capitalize(f.name)}(Number(item.${f.name}) ?? 0);`;
      }
      const fallback = f.type === "Boolean" ? "?? false" : isNumericType(f) ? "?? 0" : f.required ? `?? ""` : "";
      return `    set${capitalize(f.name)}(item.${f.name} ${fallback});`;
    })
    .join("\n");

  // Generate submit data fields
  const submitFields = formFields
    .map((f) => `    data["${f.name}"] = String(${f.name});`)
    .join("\n");

  // Generate submit edit fields (same as editFields for the handleEdit callback)
  const submitEditFields = editFields;

  // Identify Decimal fields that need serialization in JSON responses
  const decimalFields = formFields.filter((f) => f.type === "Decimal");

  // Generate loader return with Decimal serialization if needed
  const loaderReturn = decimalFields.length > 0
    ? `  // Serialize Prisma Decimal fields to number for JSON response
  const serialized = ${modelNamePlural}.map((item) => ({
    ...item,
${decimalFields.map((f) => `    ${f.name}: Number(item.${f.name}),`).join("\n")}
  }));
  return json({ ${modelNamePlural}: serialized, shopPlan: shop.plan });`
    : `  return json({ ${modelNamePlural}, shopPlan: shop.plan });`;

  // Type for items from loader
  const itemType = generateItemType(columns);

  return `/**
 * File: routes/app.${modelNameLower}.tsx
 * Purpose: Auto-generated CRUD page for ${modelNameUpper} model
 * Generated by: npm run generate ${modelNameUpper}
 *
 * Customize this page to match your business needs:
 *   - Adjust form fields and validation
 *   - Add business logic in the action
 *   - Modify table columns and display
 *
 * Dependencies: prisma, shopify-auth, i18n, rate-limiter
 */
import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Button,
  Modal,
  FormLayout,
  TextField,${needsCheckbox ? "\n  Checkbox," : ""}${needsSelect ? "\n  Select," : ""}
  Text,
  EmptyState,
  Badge,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import prisma from "~/db.server";
import { authenticatePage } from "~/utils/shopify-auth";
import { rateLimit, RATE_LIMIT_PRESETS } from "~/utils/rate-limiter";
import { createLogger } from "~/utils/logger";

const logger = createLogger({ module: "${modelNameLower}" });

// ─────────────────────────────────────────────────────────────────────────────
// LOADER — Fetch ${modelNamePlural} for the current shop
// ─────────────────────────────────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticatePage(request);
  if (!auth.ok) return auth.response;
  const { shop } = auth;

  const ${modelNamePlural} = await prisma.${modelNameLower}.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

${loaderReturn}
};

// ─────────────────────────────────────────────────────────────────────────────
// ACTION — Handle create / update / delete
// ─────────────────────────────────────────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticatePage(request);
  if (!auth.ok) return auth.response;
  const { shop } = auth;

  // Rate limiting
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const blocked = await rateLimit(\`${modelNameLower}:\${shop.id}:\${ip}\`, RATE_LIMIT_PRESETS.write);
  if (blocked) {
    return json({ error: \`Too many requests. Retry in \${blocked.retryAfter}s\` }, { status: 429 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  switch (intent) {
    case "create": {
      const item = await prisma.${modelNameLower}.create({
        data: {
          shopId: shop.id,
${createFields}
        },
      });
      logger.info({ shopId: shop.id, id: item.id }, "${modelNameUpper} created");
      return json({ success: true, item });
    }

    case "update": {
      const id = String(formData.get("id"));
      const existing = await prisma.${modelNameLower}.findFirst({ where: { id, shopId: shop.id } });
      if (!existing) return json({ error: "Not found" }, { status: 404 });

      const data: Record<string, unknown> = {};
${updateFields}

      const updated = await prisma.${modelNameLower}.update({ where: { id }, data });
      logger.info({ shopId: shop.id, id: updated.id }, "${modelNameUpper} updated");
      return json({ success: true, item: updated });
    }

    case "delete": {
      const id = String(formData.get("id"));
      const existing = await prisma.${modelNameLower}.findFirst({ where: { id, shopId: shop.id } });
      if (!existing) return json({ error: "Not found" }, { status: 404 });

      await prisma.${modelNameLower}.delete({ where: { id } });
      logger.info({ shopId: shop.id, id }, "${modelNameUpper} deleted");
      return json({ success: true });
    }

    default:
      return json({ error: "Unknown intent" }, { status: 400 });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────────────────────────────
export default function ${modelNameUpper}Page() {
  const { ${modelNamePlural} } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
${stateDeclarations}

  const handleNew = useCallback(() => {
    setEditingId(null);
${resetFields}
    setModalOpen(true);
  }, []);

  const handleEdit = useCallback((item: ${modelNameUpper}Item) => {
    setEditingId(item.id);
${submitEditFields}
    setModalOpen(true);
  }, []);

  const handleSave = useCallback(() => {
    const intent = editingId ? "update" : "create";
    const data: Record<string, string> = { intent };
    if (editingId) data.id = editingId;
${submitFields}
    submit(data, { method: "post" });
    setModalOpen(false);
  }, [editingId, ${formFields.map((f) => f.name).join(", ")}, submit]);

  const handleDelete = useCallback(
    (id: string) => submit({ intent: "delete", id }, { method: "post" }),
    [submit]
  );

  return (
    <Page
      title="${modelNameUpper}s"
      primaryAction={{ content: "New ${modelNameUpper}", onAction: handleNew }}
    >
      <Card>
        {${modelNamePlural}.length === 0 ? (
          <EmptyState heading="No ${modelNamePlural} yet" image="">
            <Text as="p" variant="bodyMd">Create your first ${modelNameLower} to get started.</Text>
            <Button variant="primary" onClick={handleNew}>Create ${modelNameUpper}</Button>
          </EmptyState>
        ) : (
          <IndexTable
            resourceName={{ singular: "${modelNameLower}", plural: "${modelNamePlural}" }}
            itemCount={${modelNamePlural}.length}
            headings={[
              ${headings},
              { title: "Actions" },
            ]}
            selectable={false}
          >
            {${modelNamePlural}.map((item: ${modelNameUpper}Item, index) => (
              <IndexTable.Row id={item.id} key={item.id} position={index}>
                ${cells}
                <IndexTable.Cell>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <Button size="slim" onClick={() => handleEdit(item as ${modelNameUpper}Item)}>Edit</Button>
                    <Button size="slim" tone="critical" onClick={() => handleDelete(item.id)}>Delete</Button>
                  </div>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        )}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? "Edit ${modelNameUpper}" : "New ${modelNameUpper}"}
        primaryAction={{ content: "Save", onAction: handleSave }}
        secondaryActions={[{ content: "Cancel", onAction: () => setModalOpen(false) }]}
      >
        <Modal.Section>
          <FormLayout>
            ${formFieldJsx}
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface ${modelNameUpper}Item {
  id: string;
${allFields
  .filter((f) => !f.isRelation)
  .map((f) => `  ${f.name}: ${prismaTypeToTs(f.type, f.required)};`)
  .join("\n")}
}
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function humanize(fieldName: string): string {
  // camelCase to Title Case: "orderName" → "Order Name"
  return fieldName
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function isNumericType(field: PrismaField): boolean {
  return ["Int", "Float", "Decimal", "BigInt"].includes(field.type);
}

function isStatusField(field: PrismaField): boolean {
  if (field.type !== "String") return false;
  const statusNames = ["status", "state", "type", "role", "category", "priority"];
  return statusNames.some((s) => field.name.toLowerCase().includes(s));
}

function isLongTextField(field: PrismaField): boolean {
  const patterns = ["note", "description", "content", "body", "detail", "comment"];
  return field.type === "String" && patterns.some((p) => field.name.toLowerCase().includes(p));
}

function getInitialValue(field: PrismaField): string {
  if (field.type === "Boolean") return field.defaultValue === "true" ? "true" : "false";
  if (isNumericType(field)) return field.defaultValue || "0";
  if (field.defaultValue && field.defaultValue !== "uuid()" && field.defaultValue !== "now()") {
    return `"${field.defaultValue.replace(/"/g, "")}"`;
  }
  return `""`;
}

function getFormDataValue(field: PrismaField): string {
  if (field.type === "Boolean") return `formData.get("${field.name}") === "true"`;
  if (isNumericType(field)) return `Number(formData.get("${field.name}") || 0)`;
  return `String(formData.get("${field.name}") || "")`;
}

function generateFormField(field: PrismaField): string {
  const label = humanize(field.name);

  if (field.type === "Boolean") {
    return `<Checkbox
              label="${label}"
              checked={${field.name}}
              onChange={(val) => set${capitalize(field.name)}(val)}
            />`;
  }

  if (isStatusField(field)) {
    return `<Select
              label="${label}"
              options={[
                { label: "Option A", value: "option_a" },
                { label: "Option B", value: "option_b" },
                { label: "Option C", value: "option_c" },
              ]}
              value={${field.name}}
              onChange={set${capitalize(field.name)}}
            />`;
  }

  if (isNumericType(field)) {
    return `<TextField
              label="${label}"
              type="number"
              value={String(${field.name})}
              onChange={(val) => set${capitalize(field.name)}(Number(val))}
              autoComplete="off"
            />`;
  }

  if (isLongTextField(field)) {
    return `<TextField
              label="${label}"
              value={${field.name}}
              onChange={set${capitalize(field.name)}}
              multiline={3}
              autoComplete="off"
            />`;
  }

  return `<TextField
              label="${label}"
              value={${field.name}}
              onChange={set${capitalize(field.name)}}
              autoComplete="off"
            />`;
}

function generateTableCell(field: PrismaField): string {
  if (isStatusField(field)) {
    return `<IndexTable.Cell>
                  <Badge>{item.${field.name}}</Badge>
                </IndexTable.Cell>`;
  }
  if (field.type === "Boolean") {
    return `<IndexTable.Cell>
                  <Text as="span" variant="bodyMd">{item.${field.name} ? "Yes" : "No"}</Text>
                </IndexTable.Cell>`;
  }
  return `<IndexTable.Cell>
                  <Text as="span" variant="bodyMd">{String(item.${field.name} ?? "—")}</Text>
                </IndexTable.Cell>`;
}

function generateItemType(columns: PrismaField[]): string {
  const fields = columns.map((f) => `${f.name}: ${prismaTypeToTs(f.type, f.required)}`);
  return `{ id: string; ${fields.join("; ")} }`;
}

function prismaTypeToTs(type: string, required: boolean): string {
  const tsType =
    type === "String" ? "string" :
    type === "Int" || type === "Float" || type === "Decimal" || type === "BigInt" ? "number" :
    type === "Boolean" ? "boolean" :
    type === "DateTime" ? "string" :
    "unknown";
  return required ? tsType : `${tsType} | null`;
}
