import { type Lead, type LeadStage, type LeadSummary, type TaskStatus } from "@mado/contract";
import { useMutation } from "@tanstack/react-query";
import { client, errorMessage, orpc, queryClient } from "../../lib/orpc";
import { toast } from "../../lib/toast";

/** Lead stages reuse the task status glyphs so the pipeline reads like the board. */
export const STAGE_ICON: Record<LeadStage, TaskStatus> = {
  new: "backlog",
  contacted: "todo",
  replied: "in_progress",
  qualified: "in_review",
  won: "done",
  lost: "canceled",
};

/** List view groups the warmest leads first; the pipeline goes left to right in funnel order. */
export const LIST_ORDER: LeadStage[] = ["replied", "qualified", "contacted", "new", "won", "lost"];

export type LeadPatch = Parameters<typeof client.crm.update>[0]["patch"];

export function byLastContact(a: LeadSummary, b: LeadSummary) {
  if (a.lastContactAt && b.lastContactAt) return b.lastContactAt.localeCompare(a.lastContactAt);
  if (a.lastContactAt) return -1;
  if (b.lastContactAt) return 1;
  return b.updatedAt.localeCompare(a.updatedAt);
}

function applyPatch<T extends LeadSummary>(l: T, patch: LeadPatch): T {
  const { company, contact, ...rest } = patch;
  return {
    ...l,
    ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
    company: company ? { ...l.company, ...company } : l.company,
    contact: contact ? { id: l.contact?.id ?? "", name: "", role: "", email: "", phone: "", ...l.contact, ...contact } : l.contact,
  };
}

/** Optimistic lead update: patches the list and the detail cache, rolls both back on error. */
export function useUpdateLead(projectId: string) {
  const listKey = orpc.crm.list.queryKey({ input: { projectId } });
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: LeadPatch }) => client.crm.update({ id, patch }),
    onMutate: ({ id, patch }) => {
      const getKey = orpc.crm.get.queryKey({ input: { id } });
      const prevList = queryClient.getQueryData<LeadSummary[]>(listKey);
      const prevGet = queryClient.getQueryData<Lead>(getKey);
      if (prevList) queryClient.setQueryData(listKey, prevList.map((l) => (l.id === id ? applyPatch(l, patch) : l)));
      if (prevGet) queryClient.setQueryData(getKey, applyPatch(prevGet, patch));
      return { prevList, prevGet, getKey };
    },
    onError: (e, _v, ctx) => {
      if (ctx) {
        queryClient.setQueryData(listKey, ctx.prevList);
        queryClient.setQueryData(ctx.getKey, ctx.prevGet);
      }
      toast.error(`Couldn't save: ${errorMessage(e)}`);
    },
    onSuccess: (summary) => {
      queryClient.setQueryData<LeadSummary[]>(listKey, (list) => list?.map((l) => (l.id === summary.id ? summary : l)));
    },
  });
}
