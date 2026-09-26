import { useCallback, useEffect, useRef, useState } from "react";
import { Banner, BlockStack, Button, Card, Checkbox, InlineStack, Modal, Text } from "@shopify/polaris";
import { authenticatedFetch } from "~/utils/app-bridge.client";
import { useTranslation } from "~/utils/i18n";
import type { ApiErrorResponse, ApiSuccessResponse } from "~/utils/api-response";

interface PrivacyItem { id: string; kind: string; status: string; createdAt: string; expiresAt: string; confirmedAt: string | null }
interface PrivacyPage { items: PrivacyItem[]; nextCursor: string | null }

export function PrivacyPanel({ csrfToken }: { csrfToken: string }) {
  const { t } = useTranslation();
  const [page, setPage] = useState<PrivacyPage>({ items: [], nextCursor: null });
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const load = useCallback(async (cursor?: string) => {
    const response = await authenticatedFetch(`/api/privacy${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
    const result: ApiSuccessResponse<PrivacyPage> | ApiErrorResponse = await response.json();
    if (!response.ok || !result.success || !result.data) throw new Error("Privacy list failed");
    const data = result.data;
    setPage((previous) => ({ items: cursor ? [...previous.items, ...data.items] : data.items, nextCursor: data.nextCursor }));
  }, []);
  const run = useCallback(async (work: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(false);
    try { await work(); } catch { setError(true); }
    finally { pending.current = false; setBusy(false); }
  }, []);
  useEffect(() => { void run(() => load()); }, [load, run]);
  const download = async (id: string) => {
    const response = await authenticatedFetch(`/api/privacy?id=${encodeURIComponent(id)}`);
    if (!response.ok || !response.headers.get("Content-Type")?.includes("application/json")) throw new Error("Privacy download failed");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `privacy-${id}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const confirm = async () => {
    if (!target || !reviewed) return;
    const form = new FormData();
    form.set("id", target); form.set("csrfToken", csrfToken); form.set("reviewed", "true");
    const response = await authenticatedFetch("/api/privacy", { method: "POST", body: form });
    if (!response.ok || !(await response.json()).success) throw new Error("Privacy confirmation failed");
    setTarget(null); setReviewed(false); await load();
  };
  return <Card><BlockStack gap="400">
    <Text as="h2" variant="headingMd">{t("privacy.title")}</Text>
    <Text as="p">{t("privacy.hint")}</Text>
    {error && <Banner tone="critical" title={t("common.errorGeneric")} />}
    <Button loading={busy} disabled={busy} onClick={() => void run(() => load())}>{t("privacy.refresh")}</Button>
    {!busy && !page.items.length && <Text as="p">{t("common.noData")}</Text>}
    {page.items.map((item) => <BlockStack key={item.id} gap="200">
      <Text as="h3">{t(`privacy.${item.kind}`)} · {t(`privacy.${item.status}`)}</Text>
      <Text as="p" tone="subdued">{item.id} · {new Date(item.createdAt).toLocaleDateString()}</Text>
      <InlineStack gap="200">
        <Button disabled={busy || new Date(item.expiresAt).getTime() <= Date.now()} onClick={() => void run(() => download(item.id))}>{t("privacy.download")}</Button>
        <Button disabled={busy || !!item.confirmedAt || item.status === "PENDING"} onClick={() => { setTarget(item.id); setReviewed(false); }}>{t("privacy.confirm")}</Button>
      </InlineStack>
    </BlockStack>)}
    {page.nextCursor && <Button disabled={busy} onClick={() => void run(() => load(page.nextCursor!))}>{t("common.loadMore")}</Button>}
    <Modal open={!!target} onClose={() => { if (!busy) setTarget(null); }} title={t("privacy.confirm")}
      primaryAction={{ content: t("common.confirm"), disabled: !reviewed || busy, loading: busy, onAction: () => void run(confirm) }}>
      <Modal.Section><Checkbox label={t("privacy.reviewed")} checked={reviewed} onChange={setReviewed} /></Modal.Section>
    </Modal>
  </BlockStack></Card>;
}
