import { authed } from "./base";
import type { Services } from "./services";

export const auditRouter = (s: Services) => ({
  list: authed.audit.list.handler(({ input, context }) => s.inbox.auditList(context.actor, input)),
});
