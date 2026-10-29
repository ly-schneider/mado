import { authed } from "./base";
import type { Services } from "./services";

const ok = { ok: true as const };

export const projectRouter = (s: Services) => ({
  create: authed.project.create.handler(({ input, context }) => s.project.create(context.actor, input)),
  update: authed.project.update.handler(({ input, context }) => s.project.update(context.actor, input)),
  delete: authed.project.delete.handler(async ({ input, context }) => {
    await s.project.delete(context.actor, input.id);
    return ok;
  }),
  keyAvailable: authed.project.keyAvailable.handler(({ input, context }) => s.project.keyAvailable(context.actor, input.key)),
  labels: authed.project.labels.handler(({ input, context }) => s.project.labels(context.actor, input.projectId)),
  createLabel: authed.project.createLabel.handler(({ input, context }) => s.project.createLabel(context.actor, input)),
  updateLabel: authed.project.updateLabel.handler(({ input, context }) => s.project.updateLabel(context.actor, input)),
  deleteLabel: authed.project.deleteLabel.handler(async ({ input, context }) => {
    await s.project.deleteLabel(context.actor, input.id);
    return ok;
  }),
  repos: authed.project.repos.handler(({ input, context }) => s.project.repos(context.actor, input.projectId)),
  addRepo: authed.project.addRepo.handler(({ input, context }) => s.project.addRepo(context.actor, input)),
  removeRepo: authed.project.removeRepo.handler(async ({ input, context }) => {
    await s.project.removeRepo(context.actor, input.id);
    return ok;
  }),
});
