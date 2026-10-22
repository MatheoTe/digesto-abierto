/**
 * Typed application errors. Route handlers never build error JSON by hand:
 * they throw one of these and `toErrorResponse` maps it to a stable
 * `{ error: { code, message, details? } }` payload with the right status.
 */
export type ErrorCode =
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "BUDGET_EXCEEDED"
  | "PROVIDER_ERROR"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly headers?: Record<string, string>;

  constructor(
    code: ErrorCode,
    status: number,
    message: string,
    options: { details?: unknown; cause?: unknown; headers?: Record<string, string> } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = options.details;
    this.headers = options.headers;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super("VALIDATION_FAILED", 400, message, { details });
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super("NOT_FOUND", 404, `${resource} ${id} was not found`);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Missing or invalid credentials") {
    super("UNAUTHORIZED", 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super("FORBIDDEN", 403, message);
  }
}

export class RateLimitedError extends AppError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, message = "Hiciste muchas preguntas seguidas. Esperá un minuto y probá de nuevo.") {
    super("RATE_LIMITED", 429, message, {
      details: { retryAfterSeconds },
      headers: { "Retry-After": String(retryAfterSeconds) },
    });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ProviderError extends AppError {
  readonly provider: string;
  constructor(provider: string, message: string, cause?: unknown) {
    super("PROVIDER_ERROR", 502, `${provider}: ${message}`, { cause });
    this.provider = provider;
  }
}

/** The public site's daily spend cap was reached. */
export class BudgetExceededError extends AppError {
  constructor() {
    super("BUDGET_EXCEEDED", 429, "Digesto Abierto llegó al límite de consultas de hoy. Volvé a probar mañana.");
  }
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export function toErrorBody(err: unknown): { status: number; body: ErrorBody; headers?: Record<string, string> } {
  if (err instanceof AppError) {
    return {
      status: err.status,
      headers: err.headers,
      body: { error: { code: err.code, message: err.message, ...(err.details !== undefined && { details: err.details }) } },
    };
  }
  return { status: 500, body: { error: { code: "INTERNAL", message: "Unexpected server error" } } };
}

export function toErrorResponse(err: unknown): Response {
  const { status, body, headers } = toErrorBody(err);
  if (status >= 500) console.error("[digesto]", err);
  return Response.json(body, { status, headers });
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
