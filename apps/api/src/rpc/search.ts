import { authed } from "./base";
import type { Services } from "./services";

export const searchRouter = (s: Services) => ({
  query: authed.search.query.handler(({ input, context }) => s.search.query(context.actor, input)),
});
