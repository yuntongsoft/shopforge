/**
 * File: scripts/generate.ts
 * Purpose: Code generator — creates complete CRUD route from Prisma model
 *
 * Usage:
 *   npm run generate Order
 *   npm run generate Product -- --force
 *
 * What it does:
 *   1. Parses prisma/schema.prisma
 *   2. Finds the specified model
 *   3. Extracts business fields (excludes id, shopId, timestamps)
 *   4. Generates a complete Remix route file with:
 *      - Authenticated loader (shop-scoped query, cursor pagination, CSRF token)
 *      - Authenticated action (create/update/delete with CSRF + rate limiting + validation)
 *      - Polaris IndexTable + Modal form UI with i18n support
 *      - Delete confirmation modal
 *      - Loading states and error display
 *      - Proper TypeScript types
 *   5. Writes to app/routes/app.{model-lowercase}.tsx
 *
 * After generation:
 *   - Run `npm run db:push` to sync the new model to your database
 *   - Add a NavMenu entry in app/routes/app.tsx
 *   - Add i18n keys to your locale files (see generated comments)
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
  console.error("Usage: npm run generate <ModelName> [--force]");
  console.error("Example: npm run generate Order");
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

// model is guaranteed to be defined after the process.exit(1) above
const confirmedModel = model as PrismaModel;
const businessFields = getBusinessFields(confirmedModel);
const displayColumns = getDisplayColumns(businessFields);
const formFields = businessFields.filter((f) => f.type !== "DateTime");

const routeName = confirmedModel.name.toLowerCase();
const outputFile = path.join(ROOT, "app", "routes", `app.${routeName}.tsx`);

if (fs.existsSync(outputFile) && !force) {
  console.error(`File already exists: ${outputFile}`);
  console.error("Use --force to overwrite.");
  process.exit(1);
}

// Generate the route file
const code = generateRouteCode(confirmedModel, businessFields, displayColumns, formFields);
fs.writeFileSync(outputFile, code, "utf-8");

console.log(`\n✅ Generated: app/routes/app.${routeName}.tsx`);
console.log(`   Model: ${confirmedModel.name} (${businessFields.length} business fields)`);
console.log(`   Columns: ${displayColumns.map((f) => f.name).join(", ")}`);
console.log(`   Form fields: ${formFields.map((f) => f.name).join(", ")}`);
console.log(`\nNext steps:`);
console.log(`  1. Run: npm run db:push`);
console.log(`  2. Add to app/routes/app.tsx NavMenu:`);
console.log(`     <a href="/app/${routeName}">${confirmedModel.name}</a>`);
console.log(`  3. Add i18n keys to your locale files:`);
console.log(`     See the "i18n keys" section at the bottom of the generated file\n`);

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
  const needsSelect = formFields.some((f) => isStatusField(f));

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
    .map((f) => generateFormField(modelNameLower, f))
    .join("\n            ");

  // Generate table headings
  const headings = columns
    .map((f) => `{ title: t("${modelNameLower}s.${f.name}") }`)
    .join(",\n              ");

  // Generate table cells
  const cells = columns
    .map((f) => generateTableCell(f))
    .join("\n                ");

  // Generate action create data fields — use validated variables where available
  const createFields = formFields
    .map((f) => {
      const hasValidation = isNumericType(f) || isStatusField(f) || (f.type === "String" && !isLongTextField(f) && f.required);
      const suffix = "Create";
      if (hasValidation) {
        return `      ${f.name}: ${f.name}${suffix},`;
      }
      return `      ${f.name}: ${getFormDataValue(f)},`;
    })
    .join("\n");

  // Generate action update data fields — use validated variables where available
  const updateFields = formFields
    .map((f) => {
      const hasValidation = isNumericType(f) || isStatusField(f) || (f.type === "String" && !isLongTextField(f) && f.required);
      const suffix = "Update";
      if (hasValidation) {
        return `      data.${f.name} = ${f.name}${suffix};`;
      }
      return `      data.${f.name} = ${getFormDataValue(f)};`;
    })
    .join("\n");

  // Generate edit handler fields
  const editFields = formFields
    .map((f) => {
      if (f.type === "Decimal") {
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

  // Generate input validation for create case
  const validationCreate = generateValidation(formFields, "create");
  const validationUpdate = generateValidation(formFields, "update");

  // Identify Decimal fields that need serialization in JSON responses
  const decimalFields = formFields.filter((f) => f.type === "Decimal");

  // Generate loader return with Decimal serialization if needed
  const loaderReturn = decimalFields.length > 0
    ? `  // Serialize Prisma Decimal fields to number for JSON response
  const serialized = ${modelNamePlural}.map((item) => ({
    ...item,
${decimalFields.map((f) => `    ${f.name}: Number(item.${f.name}),`).join("\n")}
  }));
  return json({ ${modelNamePlural}: serialized, nextCursor, shopPlan: shop.plan, csrfToken: generateCsrfToken() });`
    : `  return json({ ${modelNamePlural}, nextCursor, shopPlan: shop.plan, csrfToken: generateCsrfToken() });`;

  return `/**
 * File: routes/app.${modelNameLower}.tsx
 * Author: yuntongsoft
 * Date: ${new Date().toISOString().split("T")[0].replace(/-/g, "/")}
 * Purpose: Auto-generated CRUD page for ${modelNameUpper} model
 * Generated by: npm run generate ${modelNameUpper}
 *
 * Customize this page to match your business needs:
 *   - Adjust form fields and validation
 *   - Add business logic in the action
 *   - Modify table columns and display
 *
 * Dependencies: prisma, shopify-auth, csrf, i18n, rate-limiter
 */
import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useRouteLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Button,
  Modal,
  FormLayout,
  TextField,${needsCheckbox ? "\n  Checkbox," : ""}${needsSelect ? "\n  Select," : ""}
  Text,
  Badge,
  Icon,
  BlockStack,
} from "@shopify/polaris";
import { EditIcon, DeleteIcon, PlusIcon } from "@shopify/polaris-icons";
import { useState, useCallback } from "react";
import prisma from "~/db.server";
import { authenticatePage, authResponse } from "~/utils/shopify-auth.server";
import { generateCsrfToken, validateCsrfRequest } from "~/utils/csrf";
import { rateLimit, RATE_LIMIT_PRESETS } from "~/utils/rate-limiter";
import { createLogger } from "~/utils/logger";
import { useTranslation } from "~/utils/i18n";

const logger = createLogger({ module: "${modelNameLower}" });

// ─────────────────────────────────────────────────────────────────────────────
// LOADER — Fetch ${modelNamePlural} for the current shop (cursor-based pagination)
// ─────────────────────────────────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticatePage(request);
  if (!auth.ok) return authResponse(auth);
  const shop = auth.shop;

  const url = new URL(request.url);
  const cursorParam = url.searchParams.get("cursor");
  const PAGE_SIZE = 50;

  // SECURITY: Validate cursor format — must be a valid Prisma CUID
  if (cursorParam && !/^[a-z0-9]+$/.test(cursorParam)) {
    return json({ error: "Invalid cursor parameter" }, { status: 400 });
  }

  const ${modelNamePlural} = await prisma.${modelNameLower}.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE + 1,
    ...(cursorParam ? { cursor: { id: cursorParam }, skip: 1 } : {}),
  });

  // Determine if there are more results
  const hasMore = ${modelNamePlural}.length > PAGE_SIZE;
  const items = hasMore ? ${modelNamePlural}.slice(0, PAGE_SIZE) : ${modelNamePlural};
  const nextCursor = hasMore ? items[items.length - 1].id : null;

${loaderReturn}
};

// ─────────────────────────────────────────────────────────────────────────────
// ACTION — Handle create / update / delete (with CSRF + rate limiting + validation)
// ─────────────────────────────────────────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticatePage(request);
  if (!auth.ok) return authResponse(auth);
  const shop = auth.shop;

  // Rate limiting
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const blocked = await rateLimit(\`${modelNameLower}:\${shop.id}:\${ip}\`, RATE_LIMIT_PRESETS.write);
  if (blocked) {
    return json(
      { error: \`Too many requests. Retry in \${blocked.retryAfter}s\` },
      { status: 429, headers: { "Retry-After": String(Math.ceil(blocked.retryAfter / 1000)) } }
    );
  }

  // CSRF validation
  let formData: FormData;
  try {
    formData = await validateCsrfRequest(request);
  } catch {
    return json({ error: "Invalid or expired CSRF token. Please refresh the page." }, { status: 403 });
  }
  const intent = formData.get("intent") as string;

  switch (intent) {
    case "create": {
${validationCreate}
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

${validationUpdate}
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
interface ${modelNameUpper}Item {
  id: string;
${allFields
  .filter((f) => !f.isRelation)
  .map((f) => `  ${f.name}: ${prismaTypeToTs(f.type, f.required)};`)
  .join("\n")}
}

interface ${modelNameUpper}LoaderData {
  ${modelNamePlural}: ${modelNameUpper}Item[];
  nextCursor: string | null;
  shopPlan: string;
  csrfToken: string;
}

export default function ${modelNameUpper}Page() {
  const { ${modelNamePlural} = [], nextCursor = null, csrfToken = "" } = useLoaderData<${modelNameUpper}LoaderData>();
  const submit = useSubmit();
  const { t } = useTranslation(
    useRouteLoaderData<typeof import("~/routes/app").loader>("routes/app")?.locale
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
${stateDeclarations}

  const handleNew = useCallback(() => {
    setEditingId(null);
    setError(null);
${resetFields}
    setModalOpen(true);
  }, []);

  const handleEdit = useCallback((item: ${modelNameUpper}Item) => {
    setEditingId(item.id);
    setError(null);
${editFields}
    setModalOpen(true);
  }, []);

  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const handleSave = useCallback(() => {
    setError(null);
    const intent = editingId ? "update" : "create";
    const data: Record<string, string> = { intent, csrfToken };
    if (editingId) data.id = editingId;
${submitFields}
    submit(data, { method: "post" });
    setModalOpen(false);
  }, [editingId, ${formFields.map((f) => f.name).join(", ")}, csrfToken, submit]);

  const handleDeleteRequest = useCallback((id: string) => {
    setDeleteTargetId(id);
    setDeleteModalOpen(true);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (deleteTargetId) {
      submit({ intent: "delete", id: deleteTargetId, csrfToken }, { method: "post" });
    }
    setDeleteModalOpen(false);
    setDeleteTargetId(null);
  }, [deleteTargetId, csrfToken, submit]);

  return (
    <Page
      title={t("${modelNameLower}s.title")}
      primaryAction={{
        content: t("${modelNameLower}s.new"),
        icon: PlusIcon,
        onAction: handleNew,
      }}
    >
      <BlockStack gap="400">
        {error && (
          <Card>
            <Text as="p" tone="critical">{error}</Text>
          </Card>
        )}
        <Card>
          {${modelNamePlural}.length === 0 ? (
            <div style={{ padding: "40px", textAlign: "center" }}>
              <Text as="h2" variant="headingMd">{t("${modelNameLower}s.empty")}</Text>
              <Text as="p" variant="bodyMd" tone="subdued">{t("${modelNameLower}s.emptyHint")}</Text>
              <div style={{ marginTop: 16 }}>
                <Button variant="primary" icon={PlusIcon} onClick={handleNew}>
                  {t("${modelNameLower}s.create")}
                </Button>
              </div>
            </div>
          ) : (
            <IndexTable
              resourceName={{ singular: "${modelNameLower}", plural: "${modelNamePlural}" }}
              itemCount={${modelNamePlural}.length}
              headings={[
              ${headings},
              { title: t("${modelNameLower}s.actions") },
              ]}
              selectable={false}
            >
              {${modelNamePlural}.map((item: ${modelNameUpper}Item, index: number) => (
                <IndexTable.Row id={item.id} key={item.id} position={index}>
                  ${cells}
                  <IndexTable.Cell>
                    <div style={{ display: "flex", gap: "4px" }}>
                      <Button
                        variant="plain"
                        icon={EditIcon}
                        onClick={() => handleEdit(item as ${modelNameUpper}Item)}
                        aria-label={t("${modelNameLower}s.edit")}
                      />
                      <Button
                        variant="plain"
                        tone="critical"
                        icon={DeleteIcon}
                        onClick={() => handleDeleteRequest(item.id)}
                        aria-label={t("${modelNameLower}s.delete")}
                      />
                    </div>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
          {nextCursor && (
            <div style={{ padding: "16px", textAlign: "center" }}>
              <Button variant="plain" url={\`?cursor=\${nextCursor}\`}>
                {t("${modelNameLower}s.loadMore")}
              </Button>
            </div>
          )}
        </Card>

        {/* Create / Edit Modal */}
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title={editingId ? t("${modelNameLower}s.edit") : t("${modelNameLower}s.create")}
          primaryAction={{
            content: t("${modelNameLower}s.save"),
            onAction: handleSave,
            loading: isSubmitting,
          }}
          secondaryActions={[{ content: t("${modelNameLower}s.cancel"), onAction: () => setModalOpen(false) }]}
        >
          <Modal.Section>
            <FormLayout>
              ${formFieldJsx}
            </FormLayout>
          </Modal.Section>
        </Modal>

        {/* Delete Confirmation Modal */}
        <Modal
          open={deleteModalOpen}
          onClose={() => setDeleteModalOpen(false)}
          title={t("${modelNameLower}s.deleteConfirmTitle")}
          primaryAction={{
            content: t("${modelNameLower}s.deleteConfirmAction"),
            destructive: true,
            onAction: handleDeleteConfirm,
          }}
          secondaryActions={[{ content: t("${modelNameLower}s.cancel"), onAction: () => setDeleteModalOpen(false) }]}
        >
          <Modal.Section>
            <Text as="p">{t("${modelNameLower}s.deleteConfirmMessage")}</Text>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// i18n keys — Add these to your locale files (en.json, zh.json, etc.)
//
// {
//   "${modelNameLower}s": {
//     "title": "${modelNameUpper}s",
//     "new": "New ${modelNameUpper}",
//     "create": "Create ${modelNameUpper}",
//     "edit": "Edit ${modelNameUpper}",
//     "save": "Save",
//     "cancel": "Cancel",
//     "delete": "Delete",
//     "actions": "Actions",
//     "empty": "No ${modelNamePlural} yet",
//     "emptyHint": "Create your first ${modelNameLower} to get started.",
//     "loadMore": "Load more",
//     "deleteConfirmTitle": "Delete ${modelNameUpper}",
//     "deleteConfirmMessage": "Are you sure you want to delete this ${modelNameLower}? This action cannot be undone.",
//     "deleteConfirmAction": "Delete",
${columns.map((f) => `//     "${f.name}": "${humanize(f.name)}",`).join("\n")}
//   }
// }
// ─────────────────────────────────────────────────────────────────────────────
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Input Validation Generator
// ─────────────────────────────────────────────────────────────────────────────

function generateValidation(fields: PrismaField[], context: "create" | "update"): string {
  const suffix = context === "create" ? "Create" : "Update";
  const validations: string[] = [];

  for (const f of fields) {
    if (isNumericType(f)) {
      const varName = `${f.name}${suffix}`;
      validations.push(`      // Validate ${f.name}: must be a non-negative number within reasonable range`);
      validations.push(`      const ${varName} = Number(formData.get("${f.name}") || 0);`);
      validations.push(`      if (isNaN(${varName}) || ${varName} < 0 || ${varName} > 99_999_999) {`);
      validations.push(`        return json({ error: "${humanize(f.name)} must be a number between 0 and 99,999,999" }, { status: 400 });`);
      validations.push(`      }`);
    }
    if (isStatusField(f)) {
      const varName = `${f.name}${suffix}`;
      validations.push(`      // Validate ${f.name}: must be a non-empty string`);
      validations.push(`      const ${varName} = String(formData.get("${f.name}") || "");`);
      validations.push(`      if (!${varName} || ${varName}.length > 255) {`);
      validations.push(`        return json({ error: "${humanize(f.name)} is required and must be under 255 characters" }, { status: 400 });`);
      validations.push(`      }`);
    }
    if (f.type === "String" && !isStatusField(f) && !isLongTextField(f) && f.required) {
      const varName = `${f.name}${suffix}`;
      validations.push(`      // Validate ${f.name}: required string`);
      validations.push(`      const ${varName} = String(formData.get("${f.name}") || "");`);
      validations.push(`      if (!${varName} || ${varName}.length > 500) {`);
      validations.push(`        return json({ error: "${humanize(f.name)} is required and must be under 500 characters" }, { status: 400 });`);
      validations.push(`      }`);
    }
  }

  return validations.join("\n");
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

function generateFormField(modelNameLower: string, field: PrismaField): string {
  const label = `t("${modelNameLower}s.${field.name}")`;

  if (field.type === "Boolean") {
    return `<Checkbox
              label={${label}}
              checked={${field.name}}
              onChange={(val) => set${capitalize(field.name)}(val)}
            />`;
  }

  if (isStatusField(field)) {
    return `<Select
              label={${label}}
              options={[
                // TODO: Customize these options based on your business logic
                { label: t("${field.name}Options.optionA"), value: "option-a" },
                { label: t("${field.name}Options.optionB"), value: "option-b" },
                { label: t("${field.name}Options.optionC"), value: "option-c" },
              ]}
              value={${field.name}}
              onChange={set${capitalize(field.name)}}
            />`;
  }

  if (isNumericType(field)) {
    return `<TextField
              label={${label}}
              type="number"
              value={String(${field.name})}
              onChange={(val) => set${capitalize(field.name)}(Number(val))}
              autoComplete="off"
            />`;
  }

  if (isLongTextField(field)) {
    return `<TextField
              label={${label}}
              value={${field.name}}
              onChange={set${capitalize(field.name)}}
              multiline={3}
              autoComplete="off"
            />`;
  }

  return `<TextField
              label={${label}}
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

function prismaTypeToTs(type: string, required: boolean): string {
  const tsType =
    type === "String" ? "string" :
    type === "Int" || type === "Float" || type === "Decimal" || type === "BigInt" ? "number" :
    type === "Boolean" ? "boolean" :
    type === "DateTime" ? "string" :
    "unknown";
  return required ? tsType : `${tsType} | null`;
}
