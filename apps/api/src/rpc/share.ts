import { authed } from "./base";
import type { Services } from "./services";

export const shareRouter = (s: Services) => ({
  list: authed.share.list.handler(({ input, context }) => s.share.list(context.actor, input.workspaceId, input.docId)),
  create: authed.share.create.handler(({ input, context }) => s.share.create(context.actor, input)),
  revoke: authed.share.revoke.handler(async ({ input, context }) => {
    await s.share.revoke(context.actor, input.id);
    return { ok: true as const };
  }),
});
