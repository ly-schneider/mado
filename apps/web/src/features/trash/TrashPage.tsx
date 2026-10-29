import { TRASH_RETENTION_DAYS, type TrashItem } from "@mado/contract";
import { Avatar, Button, Checkbox, cn, EmptyState, IconButton, Spinner } from "@mado/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, CircleCheck, FileText, FolderKanban, Info, MessageSquare, RotateCcw, Tag, Trash2, X } from "@mado/ui/fluent";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { client, errorMessage, orpc, queryClient } from "../../lib/orpc";
import { modKey } from "../../lib/platform";
import { useCommands, useListNavigation } from "../../lib/shortcuts";
import { ago } from "../../lib/time";
import { toast } from "../../lib/toast";
import { useWorkspace } from "../../lib/workspace";
import { SettingsNav } from "../settings/SettingsPage";
import { ConfirmDialog, useIsPhone } from "../settings/shared";
import { MobileTitle, PageHeader } from "../shell/PageHeader";

const TYPE_ICON: Record<TrashItem["entityType"], ReactNode> = {
  task: <CircleCheck />,
  doc: <FileText />,
  comment: <MessageSquare />,
  lead: <Building2 />,
  label: <Tag />,
  project: <FolderKanban />,
};

const TYPE_LABEL: Record<TrashItem["entityType"], string> = {
  task: "Task",
  doc: "Page",
  comment: "Comment",
  lead: "Lead",
  label: "Label",
  project: "Project",
};

const itemKey = (i: TrashItem) => `${i.entityType}:${i.id}`;

function purgeIn(i: TrashItem) {
  const days = Math.ceil((new Date(i.purgeAt).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "today";
  return days === 1 ? "in 1 day" : `in ${days} days`;
}

/** Restoring a project or page brings back what was deleted with it, so every list may change. */
function invalidateRestored() {
  for (const k of [orpc.task.key(), orpc.doc.key(), orpc.crm.key(), orpc.project.key(), orpc.workspace.list.key()]) {
    queryClient.invalidateQueries({ queryKey: k });
  }
}

type Confirm = { kind: "purge"; items: TrashItem[] } | { kind: "empty" } | null;

export function TrashPage() {
  const ws = useWorkspace();
  const phone = useIsPhone();
  const owner = ws.role === "owner";
  const key = orpc.trash.list.queryKey({ input: { workspaceId: ws.id } });
  const trash = useQuery(orpc.trash.list.queryOptions({ input: { workspaceId: ws.id } }));
  const items = useMemo(() => [...(trash.data ?? [])].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)), [trash.data]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [confirm, setConfirm] = useState<Confirm>(null);

  useEffect(() => {
    // Drop selections for items that left the list (restored elsewhere, purged).
    setSelected((s) => {
      const keys = new Set(items.map(itemKey));
      const next = new Set([...s].filter((k) => keys.has(k)));
      return next.size === s.size ? s : next;
    });
  }, [items]);

  const removeFromCache = (list: TrashItem[]) => {
    const prev = queryClient.getQueryData<TrashItem[]>(key);
    const gone = new Set(list.map(itemKey));
    if (prev) queryClient.setQueryData(key, prev.filter((i) => !gone.has(itemKey(i))));
    setSelected((s) => new Set([...s].filter((k) => !gone.has(k))));
    return { prev };
  };

  const restore = useMutation({
    mutationFn: async (list: TrashItem[]) => {
      const results = await Promise.allSettled(list.map((i) => client.trash.restore({ entityType: i.entityType, id: i.id })));
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed === list.length) throw (results[0] as PromiseRejectedResult).reason;
      return { restored: list.length - failed, failed };
    },
    onMutate: removeFromCache,
    onError: (e, _l, ctx) => {
      queryClient.setQueryData(key, ctx?.prev);
      toast.error(`Couldn't restore: ${errorMessage(e)}`);
    },
    onSuccess: (r, list) => {
      invalidateRestored();
      const what = list.length === 1 ? `“${list[0]!.title}”` : `${r.restored} items`;
      toast(r.failed ? `Restored ${what}, ${r.failed} failed` : `Restored ${what}`);
    },
    onSettled: (_r, e) => e || queryClient.invalidateQueries({ queryKey: key }),
  });

  const purge = useMutation({
    mutationFn: async (list: TrashItem[]) => {
      for (const i of list) await client.trash.purge({ entityType: i.entityType, id: i.id });
    },
    onMutate: removeFromCache,
    onError: (e, _l, ctx) => {
      queryClient.setQueryData(key, ctx?.prev);
      toast.error(`Couldn't delete: ${errorMessage(e)}`);
    },
    onSuccess: (_r, list) => toast(list.length === 1 ? `“${list[0]!.title}” deleted forever` : `${list.length} items deleted forever`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const empty = useMutation({
    mutationFn: () => client.trash.empty({ workspaceId: ws.id }),
    onMutate: () => removeFromCache(items),
    onError: (e, _v, ctx) => {
      queryClient.setQueryData(key, ctx?.prev);
      toast.error(`Couldn't empty the trash: ${errorMessage(e)}`);
    },
    onSuccess: (r) => toast(`Trash emptied · ${r.purged} item${r.purged === 1 ? "" : "s"} deleted forever`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const toggle = (i: TrashItem) =>
    setSelected((s) => {
      const next = new Set(s);
      const k = itemKey(i);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  const selectedItems = items.filter((i) => selected.has(itemKey(i)));
  const current = items[cursor];
  const targets = () => (selectedItems.length ? selectedItems : current ? [current] : []);

  useListNavigation(items, cursor, setCursor, toggle);
  useCommands(
    [
      { id: "trash.toggle", title: "Select item", keys: "x", hint: "X", group: "Actions", run: () => current && toggle(current) },
      { id: "trash.restore", title: "Restore", keys: "r", hint: "R", group: "Actions", icon: <RotateCcw />, run: () => targets().length && restore.mutate(targets()) },
      ...(owner
        ? [
            {
              id: "trash.purge",
              title: "Delete forever",
              keys: "$mod+Backspace",
              hint: `${modKey}⌫`,
              group: "Actions" as const,
              icon: <Trash2 />,
              run: () => targets().length && setConfirm({ kind: "purge", items: targets() }),
            },
            { id: "trash.empty", title: "Empty trash", group: "Actions" as const, icon: <Trash2 />, run: () => items.length && setConfirm({ kind: "empty" }) },
          ]
        : []),
      { id: "trash.clear", title: "Clear selection", keys: "Escape", group: "Actions", when: () => selected.size > 0, run: () => setSelected(new Set()) },
    ],
    [items, cursor, selected, owner],
  );

  const allChecked = items.length > 0 && selected.size === items.length;
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Settings", to: "/$ws/settings/$section", params: { ws: ws.slug, section: phone ? "menu" : "account" } }, { label: "Trash" }]}
        mobileBack
      >
        {owner && items.length > 0 && (
          <Button variant="danger" icon={<Trash2 />} onClick={() => setConfirm({ kind: "empty" })}>
            Empty trash
          </Button>
        )}
      </PageHeader>
      <div className="flex min-h-0 flex-1">
        <SettingsNav current="trash" className="lg:flex" />
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pb-32 md:pb-10">
          <MobileTitle title="Trash" subtitle={`${items.length} item${items.length === 1 ? "" : "s"}`} />
          <div className="flex items-center gap-2 border-b border-edge px-4 py-2.5 text-label text-ink-subtle md:px-5">
            <Info className="size-4 shrink-0" />
            <span className="truncate">Purged after {TRASH_RETENTION_DAYS} days{owner ? "" : " · only the owner can purge"}</span>
          </div>

          {trash.isPending ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : trash.isError ? (
            <EmptyState icon={<Trash2 />} title="Couldn't load the trash">
              {errorMessage(trash.error)}
            </EmptyState>
          ) : items.length === 0 ? (
            <EmptyState icon={<Trash2 />} title="Trash is empty" />
          ) : (
            <div role="table" aria-label="Trash">
              <div
                role="row"
                className="hidden h-8 grid-cols-[16px_minmax(0,1fr)_160px_96px_96px_176px] items-center gap-3 border-b border-edge px-5 text-label text-ink-subtle md:grid"
              >
                <Checkbox
                  checked={allChecked}
                  label="Select all"
                  onChange={(v) => setSelected(v ? new Set(items.map(itemKey)) : new Set())}
                />
                <span>Name</span>
                <span>Deleted by</span>
                <span>Deleted</span>
                <span>Purged</span>
                <span />
              </div>
              {items.map((i, idx) => {
                const k = itemKey(i);
                const checked = selected.has(k);
                return (
                  <div
                    key={k}
                    role="row"
                    onMouseMove={() => cursor !== idx && setCursor(idx)}
                    onClick={() => phone || toggle(i)}
                    className={cn(
                      "group grid min-h-11 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-3 border-b border-edge px-4 py-1.5 md:grid-cols-[16px_minmax(0,1fr)_160px_96px_96px_176px] md:px-5",
                      checked ? "bg-state-selected" : cursor === idx && "bg-state-hover",
                    )}
                  >
                    <Checkbox checked={checked} label={`Select ${i.title}`} onChange={() => toggle(i)} />
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="shrink-0 text-ink-subtle [&_svg]:size-4" title={TYPE_LABEL[i.entityType]}>
                        {TYPE_ICON[i.entityType]}
                      </span>
                      <span className="min-w-0 md:flex md:items-baseline md:gap-2">
                        <span className="block truncate text-sm text-ink">{i.title || "Untitled"}</span>
                        <span className="block truncate text-label text-ink-subtle">
                          {i.subtitle}
                          <span className="md:hidden">
                            {" · "}
                            {i.deletedBy.name} · {ago(i.deletedAt)} · purged {purgeIn(i)}
                          </span>
                        </span>
                      </span>
                    </span>
                    <span className="hidden min-w-0 items-center gap-2 md:flex">
                      <Avatar type={i.deletedBy.type} initials={i.deletedBy.initials} size="sm" />
                      <span className="truncate text-label text-ink-muted">{i.deletedBy.name}</span>
                    </span>
                    <span className="hidden text-label text-ink-muted md:block">{ago(i.deletedAt, { long: true })}</span>
                    <span className="hidden text-label text-ink-subtle md:block">{purgeIn(i)}</span>
                    <span
                      className={cn(
                        "flex items-center justify-end gap-1",
                        !phone && cursor !== idx && !checked && "opacity-0 group-focus-within:opacity-100",
                      )}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {phone ? (
                        <IconButton label={`Restore ${i.title}`} size="touch" onClick={() => restore.mutate([i])}>
                          <RotateCcw />
                        </IconButton>
                      ) : (
                        <>
                          <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => restore.mutate([i])}>
                            Restore
                          </Button>
                          {owner && (
                            <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => setConfirm({ kind: "purge", items: [i] })}>
                              Delete forever
                            </Button>
                          )}
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {selectedItems.length > 0 && (
        <div className="fixed inset-x-4 bottom-[max(env(safe-area-inset-bottom),88px)] z-30 flex justify-center md:bottom-6 md:left-60">
          <div className="flex h-11 animate-pop items-center gap-1 rounded-lg border border-edge bg-overlay pl-3.5 pr-1.5 shadow-[0_8px_32px_-8px_rgb(0_0_0/0.5)]">
            <span className="mr-2 text-sm text-ink">{selectedItems.length} selected</span>
            <Button size="sm" icon={<RotateCcw />} onClick={() => restore.mutate(selectedItems)}>
              Restore
            </Button>
            {owner && (
              <Button size="sm" variant="danger" onClick={() => setConfirm({ kind: "purge", items: selectedItems })}>
                Delete forever
              </Button>
            )}
            <IconButton label="Clear selection (Esc)" size="sm" onClick={() => setSelected(new Set())}>
              <X />
            </IconButton>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        danger
        title={
          confirm?.kind === "empty"
            ? `Empty the trash of ${ws.name}?`
            : confirm?.items.length === 1
              ? `Delete “${confirm.items[0]!.title || "Untitled"}” forever?`
              : `Delete ${confirm?.items.length} items forever?`
        }
        confirmLabel={confirm?.kind === "empty" ? "Empty trash" : "Delete forever"}
        onConfirm={() => {
          if (confirm?.kind === "empty") empty.mutate();
          else if (confirm) purge.mutate(confirm.items);
          setConfirm(null);
        }}
      >
        {confirm?.kind === "empty"
          ? `All ${items.length} items are removed from the database, with their revisions. This can't be undone.`
          : confirm?.items.length === 1
            ? `This ${TYPE_LABEL[confirm.items[0]!.entityType].toLowerCase()} and its revisions are removed from the database. This can't be undone.`
            : "These items and their revisions are removed from the database. This can't be undone."}
      </ConfirmDialog>
    </>
  );
}
