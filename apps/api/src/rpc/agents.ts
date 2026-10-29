import { authed } from "./base";
import type { Services } from "./services";

export const agentsRouter = (s: Services) => ({
  list: authed.agents.list.handler(({ context }) => s.agent.list(context.actor)),
  assignable: authed.agents.assignable.handler(({ input, context }) => s.agent.assignable(context.actor, input.workspaceId)),
  get: authed.agents.get.handler(({ input, context }) => s.agent.get(context.actor, input.id)),
  update: authed.agents.update.handler(({ input, context }) => s.agent.update(context.actor, input.id, input.grant)),
  revoke: authed.agents.revoke.handler(async ({ input, context }) => {
    await s.agent.revoke(context.actor, input.id);
    return { ok: true as const };
  }),
  sessions: authed.agents.sessions.handler(({ input, context }) => s.agent.sessions(context.actor, input.grantId)),
  revertSession: authed.agents.revertSession.handler(({ input, context }) => s.agent.revertSession(context.actor, input.sessionId)),
  createToken: authed.agents.createToken.handler(({ input, context }) => s.agent.createToken(context.actor, input)),
  activeSessions: authed.agents.activeSessions.handler(({ context }) => s.agent.activeSessions(context.actor)),
});
