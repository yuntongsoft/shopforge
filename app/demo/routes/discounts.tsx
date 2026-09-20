/**
 * File: demo/routes/discounts.tsx
 * Author: yuntongsoft
 * Date: 2026/09/08
 * Purpose: [DEMO] Discount management UI — developers/merchants create discounts
 *          using pure business parameters (no Function IDs, no metafields).
 *
 * ============================================================================
 * DEMO COMPONENT — Pure React UI, no server-only imports
 * Server logic (loader/action) lives in routes/app.discounts.tsx
 * ============================================================================
 *
 * Dependencies: @shopify/polaris, @remix-run/react, i18n
 */
import { useLoaderData, Form, useActionData, useRouteLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Button,
  Modal,
  FormLayout,
  TextField,
  Badge,
  InlineError,
  InlineStack,
  BlockStack,
  Text,
} from "@shopify/polaris";
import { PlusIcon, EditIcon, RemoveBackgroundIcon } from "@shopify/polaris-icons";
import { useState, useCallback } from "react";
import type { DiscountRecord } from "~/demo/services/discount-api";
import { useTranslation } from "~/utils/i18n";

// ─────────────────────────────────────────────────────────────────────────────
// Types ( must match wrapper loader/action response shape)
// ─────────────────────────────────────────────────────────────────────────────
interface DiscountsLoaderData {
  discounts: DiscountRecord[];
  csrfToken: string;
}

interface DiscountsActionData {
  error?: string;
  success?: boolean;
  message?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status → Badge tone mapping
// ─────────────────────────────────────────────────────────────────────────────
function statusTone(status: string): "success" | "warning" | "critical" | "info" {
  switch (status) {
    case "active": return "success";
    case "inactive": return "warning";
    case "expired": return "critical";
    default: return "info";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────────────────────────────
export default function DiscountsPage() {
  const { discounts = [], csrfToken = "" } = useLoaderData<DiscountsLoaderData>();
  const actionData = useActionData<DiscountsActionData>();
  const { t } = useTranslation(useRouteLoaderData<typeof import("~/routes/app").loader>("routes/app")?.locale);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editDiscountId, setEditDiscountId] = useState("");

  // Form state
  const [title, setTitle] = useState("");
  const [minSubtotal, setMinSubtotal] = useState("");
  const [discountPercent, setDiscountPercent] = useState("");

  const resetForm = useCallback(() => {
    setTitle("");
    setMinSubtotal("");
    setDiscountPercent("");
  }, []);

  // Compute summary counts
  const activeCount = discounts.filter((d) => d.status === "active").length;
  const inactiveCount = discounts.filter((d) => d.status !== "active").length;

  return (
    <Page
      title={t("discounts.title")}
      subtitle={t("discounts.subtitle")}
      primaryAction={{
        content: t("discounts.createDiscount"),
        icon: PlusIcon,
        onAction: () => setShowCreate(true),
      }}
    >
      <BlockStack gap="400">
        {/* Summary bar */}
        {discounts.length > 0 && (
          <div className="sf-summary-bar">
            <div className="sf-summary-item">
              <span className="sf-summary-dot sf-summary-dot--active" />
              <Text as="span" variant="bodySm">{t("discounts.summaryActive", { count: String(activeCount) })}</Text>
            </div>
            {inactiveCount > 0 && (
              <div className="sf-summary-item">
                <span className="sf-summary-dot sf-summary-dot--inactive" />
                <Text as="span" variant="bodySm">{t("discounts.summaryInactive", { count: String(inactiveCount) })}</Text>
              </div>
            )}
          </div>
        )}

        {/* Existing discounts list */}
        <Card>
          {discounts.length === 0 ? (
            <div className="sf-empty-state">
              <img src="/images/empty-state.png" alt="" className="sf-empty-state-image" />
              <Text as="h2" variant="headingMd">{t("discounts.noDiscounts")}</Text>
              <Text as="p" variant="bodyMd" tone="subdued">{t("discounts.createFirstHint")}</Text>
              <div style={{ marginTop: 16 }}>
                <Button variant="primary" icon={PlusIcon} onClick={() => setShowCreate(true)}>
                  {t("discounts.createFirst")}
                </Button>
              </div>
            </div>
          ) : (
            <IndexTable
              resourceName={{ singular: "discount", plural: "discounts" }}
              itemCount={discounts.length}
              headings={[
                { title: t("discounts.discountTitle") },
                { title: t("discounts.status") },
                { title: t("discounts.starts") },
                { title: t("discounts.actions") },
              ]}
              selectable={false}
            >
              {discounts.map((discount: DiscountRecord, index: number) => (
                <IndexTable.Row id={discount.id} key={discount.id} position={index}>
                  <IndexTable.Cell>
                    <Text as="span" fontWeight="bold">{discount.title}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={statusTone(discount.status)}>
                      {t(`discounts.statusOptions.${discount.status}` as any) || discount.status}
                    </Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {discount.startsAt ? new Date(discount.startsAt).toLocaleDateString() : "—"}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <div className="sf-table-actions">
                      <Button
                        variant="plain"
                        icon={EditIcon}
                        onClick={() => {
                          setEditDiscountId(discount.id);
                          setMinSubtotal(String(discount.config?.minSubtotal || ""));
                          setDiscountPercent(String(discount.config?.discountPercent || ""));
                          setShowEdit(true);
                        }}
                        aria-label={t("discounts.edit")}
                      />
                      <Form method="post">
                        <input type="hidden" name="csrfToken" value={csrfToken} />
                        <input type="hidden" name="_action" value="delete" />
                        <input type="hidden" name="discountId" value={discount.id} />
                        <Button
                          variant="plain"
                          tone="critical"
                          icon={RemoveBackgroundIcon}
                          submit
                          aria-label={t("discounts.deactivate")}
                        />
                      </Form>
                    </div>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>

        {/* Action feedback */}
        {actionData && "error" in actionData && actionData.error && (
          <Card>
            <InlineError message={actionData.error} fieldID="discount-error" />
          </Card>
        )}

        {/* Create discount modal */}
        <Modal
          open={showCreate}
          onClose={() => { setShowCreate(false); resetForm(); }}
          title={t("discounts.createTitle")}
          primaryAction={{
            content: t("discounts.create"),
            onAction: () => {
              (document.getElementById("create-discount-form") as HTMLFormElement | null)?.requestSubmit();
            },
          }}
          secondaryActions={[
            { content: t("discounts.cancel"), onAction: () => { setShowCreate(false); resetForm(); } },
          ]}
        >
          <Modal.Section>
            <Form method="post" id="create-discount-form">
              <input type="hidden" name="csrfToken" value={csrfToken} />
              <input type="hidden" name="_action" value="create" />
              <FormLayout>
                <TextField
                  label={t("discounts.discountTitleLabel")}
                  name="title"
                  value={title}
                  onChange={setTitle}
                  helpText={t("discounts.discountTitleHelp")}
                  autoComplete="off"
                  requiredIndicator
                />
                <TextField
                  label={t("discounts.minSubtotal")}
                  name="minSubtotal"
                  type="number"
                  value={minSubtotal}
                  onChange={setMinSubtotal}
                  helpText={t("discounts.minSubtotalHelp")}
                  autoComplete="off"
                  requiredIndicator
                />
                <TextField
                  label={t("discounts.discountPercent")}
                  name="discountPercent"
                  type="number"
                  value={discountPercent}
                  onChange={setDiscountPercent}
                  helpText={t("discounts.discountPercentHelp")}
                  autoComplete="off"
                  requiredIndicator
                />
              </FormLayout>
            </Form>
          </Modal.Section>
        </Modal>

        {/* Edit discount modal */}
        <Modal
          open={showEdit}
          onClose={() => { setShowEdit(false); resetForm(); }}
          title={t("discounts.editTitle")}
          primaryAction={{
            content: t("discounts.save"),
            onAction: () => {
              (document.getElementById("edit-discount-form") as HTMLFormElement | null)?.requestSubmit();
            },
          }}
          secondaryActions={[
            { content: t("discounts.cancel"), onAction: () => { setShowEdit(false); resetForm(); } },
          ]}
        >
          <Modal.Section>
            <Form method="post" id="edit-discount-form">
              <input type="hidden" name="csrfToken" value={csrfToken} />
              <input type="hidden" name="_action" value="update" />
              <input type="hidden" name="discountId" value={editDiscountId} />
              <FormLayout>
                <TextField
                  label={t("discounts.minSubtotal")}
                  name="minSubtotal"
                  type="number"
                  value={minSubtotal}
                  onChange={setMinSubtotal}
                  helpText={t("discounts.minSubtotalHelp")}
                  autoComplete="off"
                  requiredIndicator
                />
                <TextField
                  label={t("discounts.discountPercent")}
                  name="discountPercent"
                  type="number"
                  value={discountPercent}
                  onChange={setDiscountPercent}
                  helpText={t("discounts.discountPercentHelp")}
                  autoComplete="off"
                  requiredIndicator
                />
              </FormLayout>
            </Form>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}
