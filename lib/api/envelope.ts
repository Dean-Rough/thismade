import { NextResponse } from "next/server";

export type SuccessEnvelope<T> = {
  data: T;
  hint: string | null;
  next_action: string | null;
};

export type ErrorCode =
  | "unauthorized"
  | "forbidden_scope"
  | "not_found"
  | "validation_failed"
  | "rate_limited"
  | "idempotency_conflict"
  | "internal";

const ERROR_STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden_scope: 403,
  not_found: 404,
  validation_failed: 400,
  rate_limited: 429,
  idempotency_conflict: 409,
  internal: 500,
};

const DOCS_BASE = "https://docs.thismade.internal/api/errors";

export function ok<T>(
  data: T,
  opts: { hint?: string | null; next_action?: string | null; status?: number } = {},
): NextResponse<SuccessEnvelope<T>> {
  const body: SuccessEnvelope<T> = {
    data,
    hint: opts.hint ?? null,
    next_action: opts.next_action ?? null,
  };
  return NextResponse.json(body, { status: opts.status ?? 200 });
}

export function apiError(code: ErrorCode, message: string): NextResponse {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        docs_url: `${DOCS_BASE}#${code}`,
      },
    },
    { status: ERROR_STATUS[code] },
  );
}
