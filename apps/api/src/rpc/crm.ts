import { authed } from "./base";
import type { Services } from "./services";

export const crmRouter = (s: Services) => ({
  list: authed.crm.list.handler(({ input, context }) => s.crm.list(context.actor, input.projectId)),
  get: authed.crm.get.handler(({ input, context }) => s.crm.get(context.actor, input.id)),
  create: authed.crm.create.handler(({ input, context }) => s.crm.create(context.actor, input)),
  update: authed.crm.update.handler(({ input, context }) => s.crm.update(context.actor, input.id, input.patch)),
  delete: authed.crm.delete.handler(async ({ input, context }) => {
    await s.crm.delete(context.actor, input.id);
    return { ok: true as const };
  }),
  analyze: authed.crm.analyze.handler(({ input, context }) => s.crm.analyze(context.actor, input.id)),
  draftEmail: authed.crm.draftEmail.handler(({ input, context }) =>
    s.crm.draftEmail(context.actor, input.id, input.language, input.instructions),
  ),
});
