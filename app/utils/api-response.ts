import { json } from "@remix-run/node";

/**
 * 统一 API 响应格式
 *
 * 所有 API 路由使用 apiError / apiSuccess 返回统一结构，前端可一致解析：
 * - 错误：{ error: string, code: number, details?: unknown }
 * - 成功：{ success: true, data?: T, message?: string }
 *
 * 错误码规范：
 * - 400: 参数错误
 * - 401: 认证失败
 * - 403: 权限不足（CSRF / 订阅门控）
 * - 404: 资源不存在
 * - 409: 冲突（重复创建等）
 * - 429: 限流
 * - 500: 服务器内部错误
 */

/** API 错误响应结构 */
export interface ApiErrorResponse {
  error: string;
  code: number;
  details?: unknown;
}

/** API 成功响应结构 */
export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data?: T;
  message?: string;
}

/**
 * 返回统一格式的 API 错误响应
 *
 * @param message - 面向用户的错误信息
 * @param status - HTTP 状态码
 * @param details - 可选的错误详情（如 Zod 校验错误列表）
 * @param headers - 可选的自定义响应头（如 Retry-After）
 */
export function apiError(message: string, status: number, details?: unknown, headers?: HeadersInit) {
  const init: ResponseInit = { status };
  if (headers) {
    init.headers = headers instanceof Headers ? headers : new Headers(headers as Record<string, string>);
  }
  return json<ApiErrorResponse>(
    { error: message, code: status, ...(details ? { details } : {}) },
    init
  );
}

/**
 * 安全的内部错误响应 — 面向客户端返回通用消息，完整错误仅服务端日志
 *
 * 用法：
 *   catch (error) {
 *     logger.error({ error }, "Operation failed");
 *     return safeError();
 *   }
 */
export function safeError(status = 500) {
  return apiError("Internal server error", status);
}

/**
 * 返回统一格式的 API 成功响应
 *
 * @param data - 响应数据
 * @param message - 可选的成功提示信息
 * @param headers - 可选的自定义响应头（如 Set-Cookie）
 */
export function apiSuccess<T>(data?: T, message?: string, headers?: HeadersInit) {
  const init: ResponseInit = {};
  if (headers) {
    init.headers = headers instanceof Headers ? headers : new Headers(headers as Record<string, string>);
  }
  return json<ApiSuccessResponse<T>>(
    { success: true, ...(data !== undefined ? { data } : {}), ...(message ? { message } : {}) },
    init
  );
}
