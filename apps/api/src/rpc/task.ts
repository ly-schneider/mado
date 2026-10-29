import { authed } from "./base";
import type { Services } from "./services";

const ok = { ok: true as const };

export const taskRouter = (s: Services) => ({
  list: authed.task.list.handler(({ input, context }) => s.task.list(context.actor, input.projectId, input.filter)),
  mine: authed.task.mine.handler(({ input, context }) => s.task.mine(context.actor, input.tab)),
  epics: authed.task.epics.handler(({ input, context }) => s.task.epics(context.actor, input.projectId)),
  get: authed.task.get.handler(({ input, context }) => s.task.get(context.actor, input.key)),
  create: authed.task.create.handler(({ input, context }) => s.task.create(context.actor, input)),
  update: authed.task.update.handler(({ input, context }) => s.task.update(context.actor, input.id, input.patch)),
  delete: authed.task.delete.handler(async ({ input, context }) => {
    await s.task.delete(context.actor, input.id);
    return ok;
  }),
  linkDoc: authed.task.linkDoc.handler(async ({ input, context }) => {
    await s.task.linkDoc(context.actor, input.taskId, input.docId, true);
    return ok;
  }),
  unlinkDoc: authed.task.unlinkDoc.handler(async ({ input, context }) => {
    await s.task.linkDoc(context.actor, input.taskId, input.docId, false);
    return ok;
  }),
  comment: authed.task.comment.handler(({ input, context }) => s.task.comment(context.actor, input.taskId, input.body)),
  deleteComment: authed.task.deleteComment.handler(async ({ input, context }) => {
    await s.task.deleteComment(context.actor, input.id);
    return ok;
  }),
  draft: authed.task.draft.handler(({ input, context }) => s.task.draft(context.actor, input.projectId, input.sentence)),
});
