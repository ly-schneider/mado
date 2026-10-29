import { EXPIRY_OPTIONS, type ExpiryOption, type ShareLink } from "@mado/contract";
import { Button, cn, Field, IconButton, Input, Segmented, Select } from "@mado/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, Eye, Link2, Lock, PenLine } from "lucide-react";
import { useState } from "react";
import { client, errorMessage, orpc, queryClient } from "../../lib/orpc";
import { ago, shortDate } from "../../lib/time";
import { toast } from "../../lib/toast";
import { patchDoc } from "./data";

const EXPIRY_LABEL: Record<ExpiryOption, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days", never: "Never" };

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  return {
    copied,
    copy: (id: string, text: string) =>
      navigator.clipboard.writeText(text).then(() => {
        setCopied(id);
        setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
      }),
  };
}

function linkMeta(l: ShareLink) {
  const parts = [l.type === "edit" ? "Edit" : "View"];
  parts.push(l.expiresAt ? (new Date(l.expiresAt) < new Date() ? "expired" : `expires ${shortDate(l.expiresAt)}`) : "no expiry");
  parts.push(l.lastUsedAt ? `used ${ago(l.lastUsedAt, { long: true })}` : "not used yet");
  return parts.join(" · ");
}

/** Share links for a page and its sub-pages. Rendered in a popover on desktop and a sheet on phones. */
export function SharePanel({ docId, docTitle, workspaceId }: { docId: string; docTitle: string; workspaceId: string }) {
  const [type, setType] = useState<"view" | "edit">("view");
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<ExpiryOption>("never");
  const [pin, setPin] = useState("");
  const [created, setCreated] = useState<ShareLink | null>(null);
  const { copied, copy } = useCopy();
  const listKey = orpc.share.list.queryKey({ input: { workspaceId, docId } });
  const { data: links = [] } = useQuery(orpc.share.list.queryOptions({ input: { workspaceId, docId } }));
  const active = links.filter((l) => !l.revokedAt);

  const pinValid = /^\d{4,8}$/.test(pin);
  const canCreate = name.trim().length > 0 && (type === "edit" ? pinValid : pin === "" || pinValid);

  const create = useMutation({
    mutationFn: () => client.share.create({ docId, name: name.trim(), type, expiry, pin: pin || undefined }),
    onSuccess: (link) => {
      queryClient.setQueryData<ShareLink[]>(listKey, (prev) => [link, ...(prev ?? [])]);
      queryClient.invalidateQueries({ queryKey: orpc.share.list.key() });
      patchDoc(docId, { shareLinks: active.length + 1 });
      setCreated(link);
      setName("");
      setPin("");
      copy(link.id, link.url).catch(() => {});
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const revoke = async (link: ShareLink) => {
    const prev = queryClient.getQueryData<ShareLink[]>(listKey);
    queryClient.setQueryData<ShareLink[]>(listKey, (p) => (p ?? []).filter((l) => l.id !== link.id));
    if (created?.id === link.id) setCreated(null);
    try {
      await client.share.revoke({ id: link.id });
      patchDoc(docId, { shareLinks: Math.max(0, active.length - 1) });
      queryClient.invalidateQueries({ queryKey: orpc.share.list.key() });
      toast(`Revoked “${link.name}”`);
    } catch (e) {
      queryClient.setQueryData(listKey, prev);
      toast.error(errorMessage(e));
    }
  };

  const setLinkType = (t: "view" | "edit") => {
    setType(t);
    setExpiry(t === "edit" ? "7d" : "never");
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-0.5 px-4 pb-3 pt-3.5">
        <div className="text-sm font-semibold text-ink">Share by link</div>
        <div className="truncate text-label text-ink-subtle">“{docTitle || "Untitled"}” and its sub-pages. Guests need no login.</div>
      </div>

      {created ? (
        <div className="flex flex-col gap-2.5 border-t border-edge px-4 py-3.5">
          <div className="flex items-center gap-2 text-label text-ink-subtle">
            <Check className="size-4 text-ink" />
            <span className="text-ink">“{created.name}” is ready</span>
            <span>· copied</span>
          </div>
          <div className="flex gap-2">
            <Input readOnly value={created.url} onFocus={(e) => e.currentTarget.select()} className="flex-1" />
            <Button icon={copied === created.id ? <Check /> : <Copy />} onClick={() => copy(created.id, created.url)}>
              Copy
            </Button>
          </div>
          {created.hasPin && <div className="text-label text-ink-subtle">Send the PIN separately, not in the same message as the link.</div>}
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setCreated(null)}>
            Create another link
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3 border-t border-edge px-4 py-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (canCreate) create.mutate();
          }}
        >
          <Segmented
            value={type}
            onChange={setLinkType}
            className="w-full [&>button]:flex-1"
            options={[
              { value: "view", label: "View" },
              { value: "edit", label: "Edit" },
            ]}
          />
          <Field label="Name" hint="shown in history as “Guest via …”">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ops review" maxLength={60} />
          </Field>
          <div className="flex gap-3">
            <Field label="Expires" className="flex-1">
              <Select value={expiry} onChange={setExpiry} options={EXPIRY_OPTIONS.map((o) => ({ value: o, label: EXPIRY_LABEL[o] }))} />
            </Field>
            <Field label="PIN" hint={type === "edit" ? "required" : "optional"} className="flex-1">
              <Input
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                inputMode="numeric"
                autoComplete="off"
                placeholder="4–8 digits"
                aria-invalid={pin !== "" && !pinValid}
                className={cn(pin !== "" && !pinValid && "border-danger focus:border-danger")}
              />
            </Field>
          </div>
          {type === "edit" && (
            <p className="text-label text-ink-subtle">An edit link without login is a password anyone can forward, so it expires and needs a PIN.</p>
          )}
          <Button type="submit" variant="primary" disabled={!canCreate} loading={create.isPending} icon={<Link2 />}>
            Create link
          </Button>
        </form>
      )}

      {active.length > 0 && (
        <div className="flex flex-col border-t border-edge px-2 py-2">
          <div className="px-2 pb-1 pt-1 text-label font-medium text-ink-subtle">Links to this page</div>
          {active.map((l) => (
            <div key={l.id} className="group flex min-h-11 items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-state-hover">
              <span className="text-ink-subtle [&_svg]:size-4">{l.type === "edit" ? <PenLine /> : <Eye />}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm text-ink">
                  <span className="truncate">{l.name}</span>
                  {l.hasPin && <Lock className="size-3 shrink-0 text-ink-subtle" aria-label="PIN" />}
                </span>
                <span className="block truncate text-label text-ink-subtle">{linkMeta(l)}</span>
              </span>
              <IconButton label="Copy link" size="sm" onClick={() => copy(l.id, l.url)}>
                {copied === l.id ? <Check /> : <Copy />}
              </IconButton>
              <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={() => revoke(l)}>
                Revoke
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
