import { authed } from "./base";
import type { Services } from "./services";

const ok = { ok: true as const };

export const inboxRouter = (s: Services) => ({
  list: authed.inbox.list.handler(({ input, context }) => s.inbox.list(context.actor, input)),
  unread: authed.inbox.unread.handler(({ context }) => s.inbox.unread(context.actor)),
  markRead: authed.inbox.markRead.handler(async ({ input, context }) => {
    await s.inbox.markRead(context.actor, input.ids, input.read);
    return ok;
  }),
  archive: authed.inbox.archive.handler(async ({ input, context }) => {
    await s.inbox.archive(context.actor, input.ids, input.archived);
    return ok;
  }),
});
