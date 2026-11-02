import { contract } from "@mado/contract";
import { implement, ORPCError } from "@orpc/server";
import type { Request, Response } from "express";
import type { Actor } from "../lib/actor";
import { AppError, toORPCError } from "../lib/errors";

export interface RpcContext {
  req: Request;
  res: Response;
  /** Resolved from the session cookie. Null for anonymous calls (setup, login, invites, guest links). */
  actor: Actor | null;
  ip: string | null;
}

const base = implement(contract).$context<RpcContext>();

/** Maps AppError to ORPCError so the client gets a typed code and message. */
export const os = base.use(async ({ context, next }) => {
  try {
    return await next();
  } catch (e) {
    if (e instanceof AppError && e.code === "TOO_MANY_REQUESTS" && typeof e.data?.retryAfter === "number") {
      context.res.setHeader("Retry-After", String(e.data.retryAfter));
    }
    throw toORPCError(e);
  }
});

/** Requires a signed-in user and narrows ctx.actor. */
export const authed = os.use(async ({ context, next }) => {
  if (!context.actor) throw new ORPCError("UNAUTHORIZED", { message: "Sign in required" });
  return next({ context: { actor: context.actor } });
});

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export const notImplemented = (): never => {
  throw new ORPCError("NOT_IMPLEMENTED", { message: "Not implemented yet" });
};
