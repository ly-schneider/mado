import type { Request, Response } from "express";
import { cookieOptionsFor, isDesktopOrigin } from "../lib/cookies";
import { SESSION_COOKIE, SESSION_HEADER, sessionToken, toMe } from "../services/auth.service";
import { authed, os } from "./base";
import type { Services } from "./services";

export function setSession(req: Request, res: Response, token: string) {
  if (isDesktopOrigin(req.headers.origin)) res.setHeader(SESSION_HEADER, token);
  else res.cookie(SESSION_COOKIE, token, cookieOptionsFor(req));
}


export const authRouter = (s: Services) => ({
  setupStatus: os.auth.setupStatus.handler(async () => ({ needsSetup: await s.auth.needsSetup() })),

  setup: os.auth.setup.handler(async ({ input, context }) => {
    const user = await s.auth.setup(input);
    const token = await s.auth.createSession(user.id, context.req.headers["user-agent"] ?? null);
    setSession(context.req, context.res, token);
    return toMe(user);
  }),

  login: os.auth.login.handler(async ({ input, context }) => {
    const user = await s.auth.login(input.email, input.password);
    const token = await s.auth.createSession(user.id, context.req.headers["user-agent"] ?? null);
    setSession(context.req, context.res, token);
    return toMe(user);
  }),

  logout: os.auth.logout.handler(async ({ context }) => {
    const token = sessionToken(context.req);
    if (token) await s.auth.destroySession(token);
    context.res.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true as const };
  }),

  me: os.auth.me.handler(async ({ context }) => {
    if (context.actor?.type !== "user") return null;
    const user = await s.auth.userFromSession(sessionToken(context.req));
    return user ? toMe(user) : null;
  }),

  updateProfile: authed.auth.updateProfile.handler(async ({ input, context }) => {
    const user = s.access.requireUser(context.actor);
    return toMe(await s.auth.updateProfile(user.userId, input));
  }),

  changePassword: authed.auth.changePassword.handler(async ({ input, context }) => {
    const user = s.access.requireUser(context.actor);
    await s.auth.changePassword(user.userId, input.current, input.next);
    return { ok: true as const };
  }),
});
