import { os } from "./base";
import type { Services } from "./services";

/** Public: the share token (and PIN) is the credential on every call, no session. */
export const guestRouter = (s: Services) => ({
  open: os.guest.open.handler(({ input }) => s.share.open(input.token, input.pin)),
  get: os.guest.get.handler(({ input }) => s.share.guestGet(input.token, input.pin, input.docId)),
  save: os.guest.save.handler(({ input }) => s.share.guestSave(input.token, input.pin, input)),
  create: os.guest.create.handler(({ input }) => s.share.guestCreate(input.token, input.pin, input)),
  delete: os.guest.delete.handler(async ({ input }) => {
    await s.share.guestDelete(input.token, input.pin, input.docId);
    return { ok: true as const };
  }),
});
