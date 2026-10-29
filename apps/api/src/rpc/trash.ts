import { authed } from "./base";
import type { Services } from "./services";

const ok = { ok: true as const };

export const trashRouter = (s: Services) => ({
  list: authed.trash.list.handler(({ input, context }) => s.trash.list(context.actor, input.workspaceId)),
  restore: authed.trash.restore.handler(async ({ input, context }) => {
    await s.trash.restore(context.actor, input.entityType, input.id);
    return ok;
  }),
  // requireOwner inside rejects every non-user actor, so MCP can never reach a purge.
  purge: authed.trash.purge.handler(async ({ input, context }) => {
    await s.trash.purge(context.actor, input.entityType, input.id);
    return ok;
  }),
  empty: authed.trash.empty.handler(({ input, context }) => s.trash.empty(context.actor, input.workspaceId)),
});
