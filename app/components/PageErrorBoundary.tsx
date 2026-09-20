/**
 * 通用路由级错误边界组件
 * 用于 Remix 路由的 ErrorBoundary 导出，展示用户友好的错误信息。
 * 运行在 AppProvider 内部，可使用 Polaris 组件。
 *
 * 使用示例：
 *   export { PageErrorBoundary as ErrorBoundary } from "~/components/PageErrorBoundary";
 */
import { useRouteError, useRouteLoaderData } from "@remix-run/react";
import { Page, Card, Text, BlockStack } from "@shopify/polaris";
import { useTranslation } from "~/utils/i18n";

/**
 * 从未知错误对象中提取可读的错误消息
 * 仅展示安全信息，避免内部堆栈/SQL 泄露给客户端
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Unknown error";
}

/**
 * 判断错误是否为“安全”的用户可见错误（非内部异常）
 * Remix 包装的 Response 错误（如 loader 返回的 4xx）是安全的
 * 未捕获的 JS Error / TypeError 等属于内部错误，不应泄露详情
 */
function isUserFacingError(error: unknown): boolean {
  // Remix Response (thrown responses from loader/action)
  if (error instanceof Response) return true;
  // 带有 status/statusText 的对象（Remix thrown responses）
  if (error && typeof error === "object" && "status" in error && "statusText" in error) return true;
  return false;
}

/**
 * 通用页面级 ErrorBoundary
 * 捕获路由 loader/action 及渲染阶段的错误，展示用户友好的错误提示。
 * 内部错误仅展示通用消息，避免泄露堆栈/SQL 等敏感信息。
 */
export function PageErrorBoundary() {
  const error = useRouteError();
  const { t } = useTranslation(
    useRouteLoaderData<typeof import("~/routes/app").loader>("routes/app")?.locale
  );

  // 安全展示：仅对 Response 类型错误展示详情，内部错误展示通用消息
  const displayMessage = isUserFacingError(error)
    ? extractErrorMessage(error)
    : t("common.errorGeneric", { defaultValue: "Something went wrong. Please try again." });

  return (
    <Page title={t("common.error", { defaultValue: "Error" })}>
      <Card>
        <BlockStack gap="200">
          <Text as="p" tone="critical">{displayMessage}</Text>
          <Text as="p" variant="bodyMd" tone="subdued">
            {t("common.errorHint", { defaultValue: "If the problem persists, please contact support." })}
          </Text>
        </BlockStack>
      </Card>
    </Page>
  );
}
