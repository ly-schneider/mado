import { clientInfo, setSession } from "./auth";
import { authed, os } from "./base";
import type { Services } from "./services";

export const workspaceRouter = (s: Services) => ({
  list: authed.workspace.list.handler(({ context }) => s.workspace.list(context.actor)),
  create: authed.workspace.create.handler(({ input, context }) => s.workspace.create(context.actor, input)),
  update: authed.workspace.update.handler(({ input, context }) => s.workspace.update(context.actor, input.id, input.name)),
  delete: authed.workspace.delete.handler(async ({ input, context }) => {
    await s.workspace.delete(context.actor, input.id, input.confirmName);
    return { ok: true as const };
  }),
  members: authed.workspace.members.handler(({ input, context }) => s.workspace.members(context.actor, input.workspaceId)),
  removeMember: authed.workspace.removeMember.handler(async ({ input, context }) => {
    await s.workspace.removeMember(context.actor, input.workspaceId, input.userId);
    return { ok: true as const };
  }),
  invites: authed.workspace.invites.handler(({ input, context }) => s.workspace.invites(context.actor, input.workspaceId)),
  createInvite: authed.workspace.createInvite.handler(({ input, context }) => s.workspace.createInvite(context.actor, input)),
  revokeInvite: authed.workspace.revokeInvite.handler(async ({ input, context }) => {
    await s.workspace.revokeInvite(context.actor, input.id);
    return { ok: true as const };
  }),
  previewInvite: os.workspace.previewInvite.handler(({ input, context }) => s.workspace.previewInvite(input.token, context.ip)),
  acceptInvite: os.workspace.acceptInvite.handler(async ({ input, context }) => {
    const result = await s.workspace.acceptInvite(input.token, context.actor, input.account, context.ip);
    if (result.createdUser) {
      const token = await s.auth.createSession(result.userId, clientInfo(context));
      setSession(context.req, context.res, token);
    }
    return { workspaceId: result.workspaceId };
  }),
});
