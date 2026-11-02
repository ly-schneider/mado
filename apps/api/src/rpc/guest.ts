import { os } from "./base";
import type { Services } from "./services";

/** Public: the share token (and PIN) is the credential on every call, no session. */
export const guestRouter = (s: Services) => ({
  open: os.guest.open.handler(({ input, context }) => s.share.open(input.token, input.pin, context.ip)),
  get: os.guest.get.handler(({ input, context }) => s.share.guestGet(input.token, input.pin, input.docId, context.ip)),
  save: os.guest.save.handler(({ input, context }) => s.share.guestSave(input.token, input.pin, input, context.ip)),
  create: os.guest.create.handler(({ input, context }) => s.share.guestCreate(input.token, input.pin, input, context.ip)),
  delete: os.guest.delete.handler(async ({ input, context }) => {
    await s.share.guestDelete(input.token, input.pin, input.docId, context.ip);
    return { ok: true as const };
  }),
});
