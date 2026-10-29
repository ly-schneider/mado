import { ORPCError } from "@orpc/server";

export class AppError extends Error {
  constructor(
    readonly code: "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST" | "INSUFFICIENT_SCOPE" | "PRECONDITION_FAILED",
    message: string,
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError("NOT_FOUND", `${what} not found`);
export const forbidden = (message = "You don't have access to this") => new AppError("FORBIDDEN", message);
export const badRequest = (message: string) => new AppError("BAD_REQUEST", message);
export const conflict = (message: string) => new AppError("CONFLICT", message);

/**
 * Agents get the exact privilege they lack so they can ask the user to upgrade the grant.
 * They can never escalate on their own.
 */
export const insufficientScope = (needed: { project?: string; level?: string; resource?: string }) =>
  new AppError(
    "INSUFFICIENT_SCOPE",
    `insufficient_scope: needs ${[needed.level, needed.resource, needed.project && `on ${needed.project}`].filter(Boolean).join(" ")}`,
    { error: "insufficient_scope", required: needed },
  );

export function toORPCError(e: unknown): unknown {
  if (!(e instanceof AppError)) return e;
  const code = e.code === "INSUFFICIENT_SCOPE" ? "FORBIDDEN" : e.code;
  return new ORPCError(code, { message: e.message, data: e.data });
}
