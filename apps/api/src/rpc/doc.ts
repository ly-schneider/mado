import { authed } from "./base";
import type { Services } from "./services";

const ok = { ok: true as const };

export const docRouter = (s: Services) => ({
  tree: authed.doc.tree.handler(({ input, context }) => s.doc.tree(context.actor, input.workspaceId)),
  get: authed.doc.get.handler(({ input, context }) => s.doc.get(context.actor, input.id)),
  create: authed.doc.create.handler(({ input, context }) => s.doc.create(context.actor, input)),
  save: authed.doc.save.handler(({ input, context }) => s.doc.save(context.actor, input)),
  move: authed.doc.move.handler(async ({ input, context }) => {
    await s.doc.move(context.actor, input);
    return ok;
  }),
  delete: authed.doc.delete.handler(async ({ input, context }) => {
    await s.doc.delete(context.actor, input.id);
    return ok;
  }),
  favorite: authed.doc.favorite.handler(async ({ input, context }) => {
    await s.doc.favorite(context.actor, input.id, input.on);
    return ok;
  }),
  favorites: authed.doc.favorites.handler(({ input, context }) => s.doc.favorites(context.actor, input.workspaceId)),
  resolveTitle: authed.doc.resolveTitle.handler(({ input, context }) => s.doc.resolveTitle(context.actor, input.workspaceId, input.title)),
  export: authed.doc.export.handler(({ input, context }) => s.doc.export(context.actor, input)),
  summarize: authed.doc.summarize.handler(({ input, context }) => s.doc.summarize(context.actor, input.id)),
});
