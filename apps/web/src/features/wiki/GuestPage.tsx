import type { Doc, DocNode, GuestSession } from "@mado/contract";
import { Button, cn, Dialog, EmptyState, IconButton, Input, MadoWordmark, Menu, Spinner } from "@mado/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import type { EditorView } from "@codemirror/view";
import { ChevronRight, Ellipsis, FilePlus, FileText, Folder, FolderOpen, Link2Off, Lock, PanelLeft, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { client, errorMessage } from "../../lib/orpc";
import { shortDate } from "../../lib/time";
import { toast } from "../../lib/toast";
import { MarkdownEditor } from "../editor/MarkdownEditor";
import { MarkdownView } from "../editor/MarkdownView";
import { findByTitle, type OpenLink } from "../editor/links";
import { readMinutes, wordCount } from "../editor/markdown";
import { useAutosave } from "./autosave";
import { childrenMap } from "./data";
import { EditedBy, EditorStatus, saveLabel, TitleInput, useIsPhone } from "./parts";

const pinKey = (token: string) => `mado.guestPin.${token}`;

function readPin(token: string) {
  try {
    return sessionStorage.getItem(pinKey(token)) ?? undefined;
  } catch {
    return undefined;
  }
}

type GuestError = { code?: string; message?: string; data?: { pinRequired?: boolean; wrongPin?: boolean; attemptsLeft?: number; expired?: boolean } };

/** Public page behind a share link: no app chrome, only the shared subtree. */
export function GuestPage() {
  const { token } = useParams({ from: "/s/$token" });
  const [pin, setPin] = useState(() => readPin(token));
  const session = useQuery({
    queryKey: ["guest", token, "session", pin ?? ""],
    queryFn: () => client.guest.open({ token, pin }),
    retry: false,
    staleTime: 30_000,
    gcTime: 0,
  });

  const err = session.error as GuestError | null;
  if (session.isPending) {
    return (
      <div className="flex h-full items-center justify-center bg-page">
        <Spinner />
      </div>
    );
  }
  if (err?.data?.pinRequired || err?.code === "TOO_MANY_REQUESTS") {
    return (
      <PinScreen
        error={pin ? err : null}
        onSubmit={(p) => {
          try {
            sessionStorage.setItem(pinKey(token), p);
          } catch {}
          setPin(p);
        }}
      />
    );
  }
  if (err || !session.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 bg-page px-6">
        <MadoWordmark className="h-6 text-ink" />
        <EmptyState icon={<Link2Off />} title={err?.data?.expired ? "This link has expired" : "This link is no longer valid"}>
          {err?.code === "NOT_FOUND" ? "Ask the person who shared it for a new link." : (err?.message ?? "Could not open the shared page.")}
        </EmptyState>
      </div>
    );
  }
  return <GuestShell token={token} pin={pin} session={session.data} />;
}

function PinScreen({ error, onSubmit }: { error: GuestError | null; onSubmit: (pin: string) => void }) {
  const [value, setValue] = useState("");
  const locked = error?.code === "TOO_MANY_REQUESTS";
  const valid = /^\d{4,8}$/.test(value);
  const message = locked
    ? (error?.message ?? "Too many wrong PINs. Try again later.")
    : error?.data?.wrongPin
      ? `Wrong PIN${error.data.attemptsLeft !== undefined ? ` · ${error.data.attemptsLeft} ${error.data.attemptsLeft === 1 ? "try" : "tries"} left` : ""}`
      : null;
  return (
    <div className="flex h-full items-center justify-center bg-page px-4">
      <form
        className="flex w-full max-w-[360px] animate-pop flex-col items-center gap-5 rounded-xl border border-edge bg-panel px-6 pb-6 pt-8 text-center"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !locked) onSubmit(value);
        }}
      >
        <span className="flex size-10 items-center justify-center rounded-lg border border-edge bg-raised text-ink-subtle">
          <Lock className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-title text-ink">Enter the PIN</h1>
          <p className="text-sm text-ink-subtle">This shared page is protected. Ask the person who sent you the link for its PIN.</p>
        </div>
        <div className="flex w-full flex-col gap-2">
          <Input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="PIN"
            aria-invalid={!!message}
            disabled={locked}
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder="4–8 digits"
            className={cn("h-11 text-center text-title tracking-[0.3em] placeholder:tracking-normal placeholder:text-sm", message && "border-danger focus:border-danger")}
          />
          <p className={cn("min-h-[18px] text-label", message ? "text-danger" : "text-ink-faint")} role={message ? "alert" : undefined}>
            {message ?? "The PIN stays in this tab only."}
          </p>
        </div>
        <Button type="submit" variant="primary" className="w-full" size="md" disabled={!valid || locked}>
          Open page
        </Button>
        <MadoWordmark className="mt-1 h-3.5 text-ink-faint" />
      </form>
    </div>
  );
}

function GuestTree({
  session,
  activeId,
  onOpen,
  onAdd,
}: {
  session: GuestSession;
  activeId: string;
  onOpen: (id: string) => void;
  onAdd?: (parentId: string) => void;
}) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const kids = useMemo(() => childrenMap(session.tree.filter((n) => n.id !== session.rootId)), [session]);
  const root = session.tree.find((n) => n.id === session.rootId);
  const render = (node: DocNode, depth: number): ReactNode => {
    const children = kids.get(node.id) ?? [];
    const open = !closed[node.id];
    const icon = children.length ? open ? <FolderOpen /> : <Folder /> : <FileText />;
    return (
      <div key={node.id}>
        <div
          className={cn(
            "group flex h-8 items-center rounded-md pr-1 text-sm font-medium text-ink-muted hover:bg-state-hover max-md:h-11 [&_svg]:size-4 [&_svg]:shrink-0",
            node.id === activeId && "bg-state-selected text-ink hover:bg-state-selected",
          )}
          style={{ paddingLeft: depth * 16 }}
        >
          <button
            type="button"
            aria-label={open ? "Collapse" : "Expand"}
            onClick={() => setClosed((c) => ({ ...c, [node.id]: open }))}
            className={cn("flex size-6 items-center justify-center text-ink-faint", !children.length && "invisible")}
          >
            <ChevronRight className={cn("size-3.5!", open && "rotate-90")} />
          </button>
          <button type="button" onClick={() => onOpen(node.id)} className="flex h-full min-w-0 flex-1 items-center gap-2 text-left outline-none [&_svg]:text-ink-subtle">
            {icon}
            <span className="truncate">{node.title || "Untitled"}</span>
          </button>
          {onAdd && (
            <IconButton label="New page inside" size="sm" className="hidden size-6 group-hover:inline-flex" onClick={() => onAdd(node.id)}>
              <Plus />
            </IconButton>
          )}
        </div>
        {open && children.map((c) => render(c, depth + 1))}
      </div>
    );
  };
  return root ? <>{render(root, 0)}</> : null;
}

function GuestShell({ token, pin, session }: { token: string; pin?: string; session: GuestSession }) {
  const search = useSearch({ from: "/s/$token" });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const phone = useIsPhone();
  const [treeOpen, setTreeOpen] = useState(false);
  const docId = search.doc && session.tree.some((n) => n.id === search.doc) ? search.doc : session.rootId;
  const canEdit = session.type === "edit";

  const openDoc = (id: string) => {
    navigate({ to: "/s/$token", params: { token }, search: { doc: id === session.rootId ? undefined : id } });
    setTreeOpen(false);
  };
  const refreshSession = () => qc.invalidateQueries({ queryKey: ["guest", token, "session"] });

  const create = async (parentId: string) => {
    try {
      const node = await client.guest.create({ token, pin, parentId, title: "Untitled" });
      await refreshSession();
      openDoc(node.id);
    } catch (e) {
      toast.error(`Could not create the page: ${errorMessage(e)}`);
    }
  };

  const tree = <GuestTree session={session} activeId={docId} onOpen={openDoc} onAdd={canEdit ? create : undefined} />;

  return (
    <div className="flex h-full flex-col bg-page">
      <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-edge px-4 pt-safe md:px-5">
        {phone && (
          <IconButton label="Pages" size="touch" variant="secondary" className="-ml-1 rounded-full" onClick={() => setTreeOpen(true)}>
            <PanelLeft className="size-[18px]" />
          </IconButton>
        )}
        <MadoWordmark className="h-[18px] shrink-0 text-ink" />
        <span className="flex h-6 min-w-0 items-center gap-1.5 rounded-full border border-edge px-2.5 text-label text-ink-muted">
          <span className="truncate">Guest via “{session.linkName}”</span>
        </span>
        <span className="hidden truncate text-label text-ink-subtle md:inline">
          {session.workspaceName} · {canEdit ? "can edit" : "view only"}
          {session.expiresAt && ` · until ${shortDate(session.expiresAt)}`}
        </span>
        {canEdit && (
          <Button className="ml-auto max-md:hidden" icon={<FilePlus />} onClick={() => create(docId)}>
            New page
          </Button>
        )}
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-edge bg-panel px-2 py-3 md:block" aria-label="Shared pages">
          <div className="px-2 pb-1.5 text-label font-medium text-ink-subtle">Shared pages</div>
          {tree}
        </aside>
        <GuestDoc key={docId} token={token} pin={pin} session={session} docId={docId} onOpenDoc={openDoc} onCreate={create} onChanged={refreshSession} />
      </div>
      <Dialog open={treeOpen} onOpenChange={setTreeOpen} position="sheet" title="Shared pages" className="top-auto max-h-[75dvh]">
        <div className="overflow-y-auto px-2 pb-safe pt-3">
          <div className="px-2 pb-1.5 text-label font-medium text-ink-subtle">Shared pages</div>
          {tree}
          <div className="h-4" />
        </div>
      </Dialog>
    </div>
  );
}

function GuestDoc({
  token,
  pin,
  session,
  docId,
  onOpenDoc,
  onCreate,
  onChanged,
}: {
  token: string;
  pin?: string;
  session: GuestSession;
  docId: string;
  onOpenDoc: (id: string) => void;
  onCreate: (parentId: string) => void;
  onChanged: () => void;
}) {
  const key = ["guest", token, "doc", docId];
  const { data: doc, error, isPending } = useQuery({ queryKey: key, queryFn: () => client.guest.get({ token, pin, docId }), retry: false });
  if (isPending) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (error || !doc) return <EmptyState icon={<FileText />} title="This page is not available">{errorMessage(error)}</EmptyState>;
  return <GuestEditor token={token} pin={pin} session={session} doc={doc} queryKey={key} onOpenDoc={onOpenDoc} onCreate={onCreate} onChanged={onChanged} />;
}

function GuestEditor({
  token,
  pin,
  session,
  doc,
  queryKey,
  onOpenDoc,
  onCreate,
  onChanged,
}: {
  token: string;
  pin?: string;
  session: GuestSession;
  doc: Doc;
  queryKey: unknown[];
  onOpenDoc: (id: string) => void;
  onCreate: (parentId: string) => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const phone = useIsPhone();
  const viewRef = useRef<EditorView | null>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const editable = session.type === "edit" && doc.canEdit;
  const save = useAutosave({
    doc,
    save: (input) => client.guest.save({ token, pin, docId: doc.id, title: input.title, content: input.content }),
    onSaved: (res, patch) => {
      qc.setQueryData<Doc>(queryKey, (d) => (d ? { ...d, ...patch, revisionNumber: res.revisionNumber, updatedAt: res.updatedAt } : d));
      if (patch.title !== undefined) onChanged();
    },
  });
  const words = useMemo(() => wordCount(save.content), [save.content]);
  const titles = useMemo(() => session.tree.map((n) => n.title), [session.tree]);

  const openLink: OpenLink = (target) => {
    if (target.type === "url") {
      window.open(target.href, "_blank", "noopener,noreferrer");
      return;
    }
    if (target.type === "page") {
      const hit = findByTitle(session.tree, target.title);
      if (hit) return onOpenDoc(hit.id);
    }
    toast("That page is not part of this share");
  };

  const remove = async () => {
    await save.flush();
    try {
      await client.guest.delete({ token, pin, docId: doc.id });
      toast(`Moved “${save.title || "Untitled"}” to trash`);
      onChanged();
      onOpenDoc(doc.parentId ?? session.rootId);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const parentTitle = doc.path[doc.path.length - 1]?.title;
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[728px] px-4 pb-24 pt-5 md:px-6 md:pt-10">
          <div className="mb-3 flex items-center gap-2 text-label text-ink-subtle md:mb-4">
            <FileText className="size-4 max-md:hidden" />
            {parentTitle && (
              <>
                <span className="truncate">{parentTitle}</span>
                <span className="text-ink-faint">·</span>
              </>
            )}
            <span className="shrink-0">{readMinutes(words)} min read</span>
            {editable && doc.id !== session.rootId && (
              <Menu.Root>
                <Menu.Trigger aria-label="More" className="ml-auto flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-state-hover">
                  <Ellipsis className="size-4" />
                </Menu.Trigger>
                <Menu.Popup align="end">
                  <Menu.Item icon={<FilePlus />} onClick={() => onCreate(doc.id)}>
                    New page inside
                  </Menu.Item>
                  <Menu.Separator />
                  <Menu.Item icon={<Trash2 />} danger onClick={remove}>
                    Delete
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Root>
            )}
            {editable && phone && doc.id === session.rootId && (
              <Button size="sm" variant="ghost" className="ml-auto" icon={<FilePlus />} onClick={() => onCreate(doc.id)}>
                New page
              </Button>
            )}
          </div>
          <TitleInput
            value={save.title}
            onChange={save.setTitle}
            readOnly={!editable}
            onEnter={() => {
              viewRef.current?.focus();
              viewRef.current?.dispatch({ selection: { anchor: 0 } });
            }}
          />
          <EditedBy actor={doc.updatedBy} at={doc.updatedAt} className="mt-2" />
          <div className="mt-5">
            {editable ? (
              <MarkdownEditor
                value={save.content}
                onChange={save.setContent}
                variant="page"
                placeholder="Write something, or press / for commands"
                onOpenLink={openLink}
                linkTitles={titles}
                onCheckpoint={() => save.flush(true)}
                onCursor={setCursor}
                viewRef={viewRef}
              />
            ) : (
              <MarkdownView markdown={save.content} onOpenLink={openLink} />
            )}
          </div>
        </div>
      </div>
      <EditorStatus
        hints={editable}
        items={editable ? ["Markdown", saveLabel(save.state, save.revision), `Ln ${cursor.line}, Col ${cursor.col}`] : ["Read only", `${words} words`]}
      />
    </div>
  );
}
