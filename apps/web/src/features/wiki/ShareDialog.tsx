import { EXPIRY_OPTIONS, type ExpiryOption, type ShareLink } from "@mado/contract";
import { Button, cn, IconButton, Input, Segmented, Select } from "@mado/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, Eye, Link2Off, Lock, PenLine } from "@mado/ui/fluent";
import { useState } from "react";
import { client, errorMessage, orpc, queryClient } from "../../lib/orpc";
import { shortDate } from "../../lib/time";
import { toast } from "../../lib/toast";
import { patchDoc } from "./data";
import { useIsPhone } from "./parts";

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

function expiryText(l: ShareLink) {
  if (!l.expiresAt) return null;
  return new Date(l.expiresAt) < new Date() ? "Expired" : `Until ${shortDate(l.expiresAt)}`;
}

/** Share links for a page and its sub-pages. Rendered in a popover on desktop and a sheet on phones. */
export function SharePanel({ docId, workspaceId }: { docId: string; workspaceId: string }) {
  const [type, setType] = useState<"view" | "edit">("view");
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<ExpiryOption>("never");
  const [pin, setPin] = useState("");
  const { copied, copy } = useCopy();
  const phone = useIsPhone();
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
      setName("");
      setPin("");
      copy(link.id, link.url)
        .then(() => toast("Link created and copied"))
        .catch(() => toast("Link created"));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const revoke = async (link: ShareLink) => {
    const prev = queryClient.getQueryData<ShareLink[]>(listKey);
    queryClient.setQueryData<ShareLink[]>(listKey, (p) => (p ?? []).filter((l) => l.id !== link.id));
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
      <form
        className="flex flex-col gap-2.5 p-3 max-md:px-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canCreate) create.mutate();
        }}
      >
        <Segmented
          value={type}
          onChange={setLinkType}
          size={phone ? "touch" : "md"}
          className="w-full [&>button]:flex-1"
          options={[
            { value: "view", label: "Can view" },
            { value: "edit", label: "Can edit" },
          ]}
        />
        <Input touch={phone} value={name} onChange={(e) => setName(e.target.value)} aria-label="Link name" placeholder="Link name, e.g. Ops review" maxLength={60} />
        <div className="flex gap-2">
          <Select
            value={expiry}
            onChange={setExpiry}
            className="min-w-0 flex-1"
            options={EXPIRY_OPTIONS.map((o) => ({ value: o, label: o === "never" ? "No expiry" : `Expires in ${EXPIRY_LABEL[o]}` }))}
          />
          <Input
            touch={phone}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            inputMode="numeric"
            autoComplete="off"
            aria-label="PIN"
            placeholder={type === "edit" ? "PIN (4–8 digits)" : "PIN (optional)"}
            aria-invalid={pin !== "" && !pinValid}
            className={cn("min-w-0 flex-1", pin !== "" && !pinValid && "border-danger focus:border-danger")}
          />
        </div>
        {type === "edit" && <p className="text-label text-ink-subtle">Edit links need a PIN.</p>}
        <Button type="submit" variant="primary" size={phone ? "touch" : "md"} disabled={!canCreate} loading={create.isPending}>
          Create link
        </Button>
      </form>

      {active.length > 0 && (
        <div className="flex flex-col border-t border-edge p-1.5">
          {active.map((l) => (
            <div key={l.id} className="flex h-9 items-center gap-2.5 rounded-md pl-2 hover:bg-state-hover max-md:h-11">
              <span className="text-ink-subtle [&_svg]:size-4" title={l.type === "edit" ? "Can edit" : "Can view"}>
                {l.type === "edit" ? <PenLine /> : <Eye />}
              </span>
              <span className="truncate text-sm text-ink">{l.name}</span>
              {l.hasPin && <Lock className="size-3 shrink-0 text-ink-subtle" aria-label="PIN" />}
              <span className="ml-auto shrink-0 pl-2 text-label text-ink-subtle">{expiryText(l)}</span>
              <span className="flex shrink-0">
                <IconButton label="Copy link" size="sm" onClick={() => copy(l.id, l.url)}>
                  {copied === l.id ? <Check /> : <Copy />}
                </IconButton>
                <IconButton label="Revoke" size="sm" onClick={() => revoke(l)}>
                  <Link2Off />
                </IconButton>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
