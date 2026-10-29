import { authed } from "./base";
import type { Services } from "./services";

export const settingsRouter = (s: Services) => ({
  instance: authed.settings.instance.handler(({ context }) => s.settings.instance(context.actor)),
  ai: authed.settings.ai.handler(({ context }) => s.settings.aiSettings(context.actor)),
  updateAi: authed.settings.updateAi.handler(({ input, context }) => s.settings.updateAi(context.actor, input)),
});
