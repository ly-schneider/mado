import { authed } from "./base";
import type { Services } from "./services";

export const settingsRouter = (s: Services) => ({
  instance: authed.settings.instance.handler(({ context }) => s.settings.instance(context.actor)),
  updateInstance: authed.settings.updateInstance.handler(({ input, context }) => s.settings.updateInstance(context.actor, input)),
  users: authed.settings.users.handler(({ context }) => s.settings.users(context.actor)),
  setAdmin: authed.settings.setAdmin.handler(({ input, context }) => s.settings.setAdmin(context.actor, input.userId, input.admin)),
  ai: authed.settings.ai.handler(({ context }) => s.settings.aiSettings(context.actor)),
  updateAi: authed.settings.updateAi.handler(({ input, context }) => s.settings.updateAi(context.actor, input)),
});
