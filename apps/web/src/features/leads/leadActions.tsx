import { type ActionEntry, StatusIcon } from "@mado/ui";
import { LEAD_STAGES, type LeadSummary, STAGE_LABEL } from "@mado/contract";
import { ArrowRight, Check, Copy, Link2, Mail, Trash2 } from "@mado/ui/fluent";
import { client, errorMessage, orpc, queryClient } from "../../lib/orpc";
import { toast } from "../../lib/toast";
import { useWorkspace } from "../../lib/workspace";
import { copyText } from "../settings/shared";
import { STAGE_ICON, useUpdateLead } from "./leadData";

/** Soft delete with an undo toast; the row leaves the list before the request returns. */
export async function deleteLead(lead: Pick<LeadSummary, "id" | "projectId" | "company">, onDeleted?: () => void) {
  const listKey = orpc.crm.list.queryKey({ input: { projectId: lead.projectId } });
  const prev = queryClient.getQueryData<LeadSummary[]>(listKey);
  if (prev) queryClient.setQueryData(listKey, prev.filter((l) => l.id !== lead.id));
  onDeleted?.();
  try {
    await client.crm.delete({ id: lead.id });
  } catch (e) {
    queryClient.setQueryData(listKey, prev);
    toast.error(`Couldn't delete: ${errorMessage(e)}`);
    return;
  }
  void queryClient.invalidateQueries({ queryKey: orpc.trash.key() });
  toast(`${lead.company.name || "Lead"} moved to the trash`, {
    action: {
      label: "Undo",
      run: () => client.trash.restore({ entityType: "lead", id: lead.id }).then(() => queryClient.invalidateQueries({ queryKey: listKey })),
    },
  });
}

/** One list for the row/card right-click menu and the ⋯ menu in the lead detail. */
export function useLeadActions(
  lead: LeadSummary,
  { projectKey, onOpen, onDeleted, extra = [] }: { projectKey: string; onOpen?: () => void; onDeleted?: () => void; extra?: ActionEntry[] },
): ActionEntry[] {
  const ws = useWorkspace();
  const update = useUpdateLead(lead.projectId);
  const email = lead.contact?.email ?? "";
  return [
    ...(onOpen ? [{ label: "Open", icon: <ArrowRight />, kbd: "↵", onSelect: onOpen }, { separator: true as const }] : []),
    {
      label: "Stage",
      icon: <StatusIcon status={STAGE_ICON[lead.stage]} />,
      children: LEAD_STAGES.map((s) => ({
        label: STAGE_LABEL[s],
        icon: s === lead.stage ? <Check /> : <StatusIcon status={STAGE_ICON[s]} />,
        onSelect: () => s !== lead.stage && update.mutate({ id: lead.id, patch: { stage: s } }),
      })),
    },
    { separator: true },
    { label: "Copy email", icon: <Copy />, disabled: !email, onSelect: () => copyText(email, "Email copied") },
    { label: "Open in Mail", icon: <Mail />, disabled: !email, onSelect: () => window.open(`mailto:${encodeURIComponent(email)}`, "_self") },
    { label: "Copy link", icon: <Link2 />, onSelect: () => copyText(`${location.origin}/${ws.slug}/p/${projectKey}/leads?lead=${lead.id}`, "Link copied") },
    ...extra,
    { separator: true },
    { label: "Delete lead", icon: <Trash2 />, danger: true, onSelect: () => deleteLead(lead, onDeleted) },
  ];
}
