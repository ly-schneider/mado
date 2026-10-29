import { authed } from "./base";
import type { Services } from "./services";

export const oauthRouter = (s: Services) => ({
  consent: authed.oauth.consent.handler(({ input, context }) => s.oauth.consent(context.actor, input.requestId)),
  approve: authed.oauth.approve.handler(({ input, context }) => s.oauth.approve(context.actor, input.requestId, input.grant)),
  deny: authed.oauth.deny.handler(({ input, context }) => s.oauth.deny(context.actor, input.requestId)),
});
