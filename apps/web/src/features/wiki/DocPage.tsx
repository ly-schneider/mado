import type { Doc, Workspace } from "@mado/contract";
import { Badge, Button, cn, Dialog, EmptyState, IconButton, Menu, Popover, Spinner } from "@mado/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import type { EditorView } from "@codemirror/view";
import {
  Check,
  Ellipsis,
  Eye,
  FileDown,
  FilePlus,
  FileText,
  FolderInput,
  History,
  Link2,
  List,
  PenLine,
  RotateCcw,
  Share,
  Sparkles,
  Star,
  Trash2,
} from "@mado/ui/fluent";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { client, errorMessage, orpc, queryClient } from "../../lib/orpc";
import { useCommands } from "../../lib/shortcuts";
import { toast } from "../../lib/toast";
import { pushRecent } from "../../lib/ui";
import { useMe, useWorkspace } from "../../lib/workspace";
import { MarkdownEditor } from "../editor/MarkdownEditor";
import { MarkdownView } from "../editor/MarkdownView";
import { outline } from "../editor/markdown";
import { type Crumb, PageHeader } from "../shell/PageHeader";
import { useAutosave } from "./autosave";
import { exportDoc, invalidateTree, moveDoc, patchDoc, patchTree, toggleFavorite, useCreateDoc, useDeleteDoc } from "./data";
import { MoveDialog, SummaryDialog } from "./DocDialogs";
import { LinkedFromCard, LinkedFromPills, Outline } from "./DocRail";
import { HistoryPanel, RevisionContent } from "./HistoryPanel";
import { EditedBy, TitleInput, useIsPhone } from "./parts";
import { SharePanel } from "./ShareDialog";

export function DocPage() {
  const { docId } = useParams({ from: "/$ws/wiki/$docId" });
  const ws = useWorkspace();
  const { data: doc, error, isPending } = useQuery(orpc.doc.get.queryOptions({ input: { id: docId } }));

  useEffect(() => {
    if (doc) pushRecent({ type: "doc", id: doc.id, title: doc.title, ref: doc.id });
  }, [doc?.id, doc?.title]);

  if (isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (error || !doc) {
    const code = (error as { code?: string } | null)?.code;
    return (
      <div className="flex h-full flex-col">
        <PageHeader crumbs={[{ label: "Wiki", to: "/$ws/wiki", params: { ws: ws.slug } }, { label: "Not found" }]} mobileBack />
        <EmptyState icon={<FileText />} title={code === "NOT_FOUND" ? "This page doesn’t exist" : "Could not open this page"}>
          {code === "NOT_FOUND" ? (
            <>
              It may have been moved to the{" "}
              <Link to="/$ws/trash" params={{ ws: ws.slug }} className="text-accent">
                trash
              </Link>
              .
            </>
          ) : (
            errorMessage(error)
          )}
        </EmptyState>
      </div>
    );
  }
  return <DocScreen key={doc.id} doc={doc} ws={ws} />;
}

function DocScreen({ doc, ws }: { doc: Doc; ws: Workspace }) {
  const search = useSearch({ from: "/$ws/wiki/$docId" });
  const navigate = useNavigate();
  const { data: me } = useMe();
  const phone = useIsPhone();
  const [mobileEdit, setMobileEdit] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [compare, setCompare] = useState(true);
  const [activeHeading, setActiveHeading] = useState(-1);
  const scroller = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const createDoc = useCreateDoc(ws);
  const deleteDoc = useDeleteDoc(ws);
  const { data: tree = [] } = useQuery(orpc.doc.tree.queryOptions({ input: { workspaceId: ws.id } }));
  const project = ws.projects.find((p) => p.id === doc.projectId);

  const save = useAutosave({
    doc,
    save: (input) => client.doc.save({ id: doc.id, ...input }),
    onSaved: (res, patch) => {
      patchDoc(doc.id, {
        ...patch,
        revisionNumber: res.revisionNumber,
        revisionCount: res.revisionCount ?? doc.revisionCount,
        updatedAt: res.updatedAt,
        updatedBy: me ? { type: "user", id: me.id, name: me.name, initials: me.initials } : doc.updatedBy,
      });
      queryClient.invalidateQueries({ queryKey: orpc.revision.list.queryKey({ input: { entityType: "doc", entityId: doc.id } }) });
    },
  });

  const editable = doc.canEdit && (!phone || mobileEdit) && !search.rev;
  const history = !!search.history;
  const content = useDeferredValue(save.content);
  const headings = useMemo(() => outline(content), [content]);
  const parent = doc.path[doc.path.length - 1];
  const freshTitle = !doc.content && (doc.title === "" || doc.title === "Untitled") && doc.canEdit;

  const setTitle = (title: string) => {
    save.setTitle(title);
    patchTree(ws.id, (t) => t.map((n) => (n.id === doc.id ? { ...n, title } : n)));
  };

  const setSearch = useCallback(
    (patch: { history?: true; rev?: string }) =>
      navigate({ to: "/$ws/wiki/$docId", params: { ws: ws.slug, docId: doc.id }, search: patch, replace: true }),
    [navigate, ws.slug, doc.id],
  );
  const toggleHistory = () => setSearch(history ? {} : { history: true });

  const focusBody = () => {
    const view = viewRef.current;
    if (!view) return;
    view.focus();
    view.dispatch({ selection: { anchor: 0 } });
  };

  // Heading offsets inside the scroller: from the editor's height map while editing, from the DOM when reading.
  const headingTops = useCallback(() => {
    const el = scroller.current;
    if (!el) return [];
    const base = el.getBoundingClientRect().top - el.scrollTop;
    const view = viewRef.current;
    if (view && editable) {
      return headings.map((h) => {
        const line = view.state.doc.line(Math.min(h.line, view.state.doc.lines));
        return view.documentTop + view.lineBlockAt(line.from).top - base;
      });
    }
    return headings.map((_, i) => {
      const node = el.querySelector(`[data-heading="${i}"]`);
      return node ? node.getBoundingClientRect().top - base : Number.POSITIVE_INFINITY;
    });
  }, [headings, editable]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const y = el.scrollTop + 120;
    let idx = -1;
    headingTops().forEach((top, i) => {
      if (top <= y) idx = i;
    });
    setActiveHeading(idx);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: recompute when the outline changes
  useEffect(onScroll, [headings]);

  const jump = (i: number) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: i < 0 ? 0 : Math.max(0, headingTops()[i]! - 24) });
    setOutlineOpen(false);
  };

  const restore = async () => {
    if (!search.rev) return;
    await save.flush();
    try {
      await client.revision.restore({ id: search.rev });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.doc.get.queryKey({ input: { id: doc.id } }) }),
        queryClient.invalidateQueries({ queryKey: orpc.revision.list.key() }),
        invalidateTree(),
      ]);
      setSearch({ history: true });
      toast("Revision restored as the newest version");
    } catch (e) {
      toast.error(`Could not restore: ${errorMessage(e)}`);
    }
  };

  const copyLink = () =>
    navigator.clipboard.writeText(`${location.origin}/${ws.slug}/wiki/${doc.id}`).then(() => toast("Link copied"));
  const remove = async () => {
    await save.flush();
    deleteDoc({ id: doc.id, title: save.title, parentId: doc.parentId, projectId: doc.projectId });
  };
  const live = { ...doc, title: save.title };

  useCommands(
    [
      { id: "wiki.new", title: "New page", keys: "d", hint: "D", group: "Wiki", run: () => createDoc({ projectId: doc.projectId, parentId: doc.parentId }) },
      { id: "wiki.subpage", title: "New sub-page", keys: "Shift+D", hint: "⇧D", group: "Wiki", run: () => createDoc({ parentId: doc.id }) },
      { id: "wiki.history", title: history ? "Close history" : "Show page history", keys: "h", hint: "H", group: "Wiki", run: toggleHistory },
      { id: "wiki.favorite", title: doc.favorite ? "Remove from favorites" : "Add to favorites", keys: "f", hint: "F", group: "Wiki", run: () => toggleFavorite(doc) },
      { id: "wiki.share", title: "Share page…", keys: "Shift+S", hint: "⇧S", group: "Wiki", run: () => setShareOpen(true), when: () => doc.canEdit },
      { id: "wiki.copyLink", title: "Copy page link", group: "Wiki", run: copyLink },
      { id: "wiki.export", title: "Export page as Markdown", group: "Wiki", run: () => exportDoc(ws.id, live) },
      { id: "wiki.move", title: "Move page…", group: "Wiki", run: () => setMoveOpen(true), when: () => doc.canEdit },
      { id: "wiki.summarize", title: "Summarize page with AI", group: "Wiki", run: () => setSummaryOpen(true) },
      { id: "wiki.delete", title: "Delete page", group: "Wiki", run: remove, when: () => doc.canEdit },
      { id: "wiki.checkpoint", title: "Save checkpoint", keys: "$mod+s", hint: "⌘S", group: "Wiki", global: true, run: () => save.flush(true) },
    ],
    [doc.id, doc.favorite, doc.canEdit, history, save.title],
  );

  const crumbs: Crumb[] = [
    parent
      ? { label: parent.title || "Untitled", to: "/$ws/wiki/$docId", params: { ws: ws.slug, docId: parent.id } }
      : { label: "Wiki", to: "/$ws/wiki", params: { ws: ws.slug }, search: { project: project?.key } },
    {
      label: search.rev ? (
        <span className="flex items-center gap-2.5">
          {save.title || "Untitled"}
          <RevisionBadge docId={doc.id} rev={search.rev} />
        </span>
      ) : (
        save.title || "Untitled"
      ),
    },
  ];

  const menu = (
    <Menu.Popup align="end" className="w-60">
      {phone && doc.canEdit && (
        <Menu.Item icon={mobileEdit ? <Check /> : <PenLine />} onClick={() => setMobileEdit((v) => !v)}>
          {mobileEdit ? "Done editing" : "Edit"}
        </Menu.Item>
      )}
      <Menu.Item icon={<History />} kbd={phone ? undefined : "H"} onClick={toggleHistory}>
        {history ? "Close history" : "Page history"}
      </Menu.Item>
      {phone && doc.canEdit && (
        <Menu.Item icon={<Share />} onClick={() => setShareOpen(true)}>
          Share…
        </Menu.Item>
      )}
      <Menu.Item icon={<Star />} kbd={phone ? undefined : "F"} onClick={() => toggleFavorite(doc)}>
        {doc.favorite ? "Remove from favorites" : "Add to favorites"}
      </Menu.Item>
      {doc.canEdit && (
        <Menu.Item icon={<FilePlus />} kbd="⇧D" onClick={() => createDoc({ parentId: doc.id })}>
          New sub-page
        </Menu.Item>
      )}
      <Menu.Item icon={<Link2 />} onClick={copyLink}>
        Copy link
      </Menu.Item>
      <Menu.Item icon={<FileDown />} onClick={() => exportDoc(ws.id, live)}>
        Export as Markdown
      </Menu.Item>
      {doc.canEdit && (
        <Menu.Item icon={<FolderInput />} onClick={() => setMoveOpen(true)}>
          Move to…
        </Menu.Item>
      )}
      <Menu.Item icon={<Sparkles />} onClick={() => setSummaryOpen(true)}>
        Summarize with AI
      </Menu.Item>
      {doc.canEdit && (
        <>
          <Menu.Separator />
          <Menu.Item icon={<Trash2 />} danger onClick={remove}>
            Delete
          </Menu.Item>
        </>
      )}
    </Menu.Popup>
  );

  const phoneHistoryList = phone && history && !search.rev;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumbs={crumbs}
        mobileBack
        mobileActions={
          search.rev ? (
            <Button size="touch" variant="primary" icon={<RotateCcw />} onClick={restore}>
              Restore
            </Button>
          ) : (
            <>
              {headings.length > 0 && !history && (
                <IconButton label="On this page" size="touch" variant="secondary" className="rounded-full" onClick={() => setOutlineOpen(true)}>
                  <List className="size-[18px]" />
                </IconButton>
              )}
              <Menu.Root>
                <Menu.Trigger
                  aria-label="More"
                  className="flex size-9 items-center justify-center rounded-full border border-edge bg-raised text-ink active:bg-overlay"
                >
                  <Ellipsis className="size-[18px]" />
                </Menu.Trigger>
                {menu}
              </Menu.Root>
            </>
          )
        }
      >
        {search.rev ? (
          <>
            <IconButton
              label={compare ? "Hide changes" : "Compare with current"}
              aria-pressed={compare}
              className={cn(compare && "bg-state-active text-ink")}
              onClick={() => setCompare((c) => !c)}
            >
              <Eye />
            </IconButton>
            {doc.canEdit && (
              <Button variant="primary" icon={<RotateCcw />} onClick={restore}>
                Restore this revision
              </Button>
            )}
          </>
        ) : (
          <>
            {!doc.canEdit && <Badge>Read only</Badge>}
            <EditedBy actor={doc.updatedBy} at={doc.updatedAt} meId={me?.id} state={save.state} className="hidden lg:flex" />
            {doc.canEdit && (
              <Popover.Root open={shareOpen && !phone} onOpenChange={setShareOpen}>
                <Popover.Trigger render={<Button icon={<Share />} />}>Share</Popover.Trigger>
                <Popover.Popup align="end" className="w-[360px]">
                  <SharePanel docId={doc.id} workspaceId={ws.id} />
                </Popover.Popup>
              </Popover.Root>
            )}
            <Menu.Root>
              <Menu.Trigger aria-label="More" className="flex size-7 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-state-hover hover:text-ink">
                <Ellipsis className="size-4" />
              </Menu.Trigger>
              {menu}
            </Menu.Root>
          </>
        )}
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        {phoneHistoryList ? (
          <HistoryPanel
            docId={doc.id}
            workspaceId={ws.id}
            className="w-full border-l-0"
            onClose={toggleHistory}
            onSelect={(r) => setSearch(r.current ? { history: true } : { history: true, rev: r.id })}
          />
        ) : (
          <div ref={scroller} onScroll={onScroll} data-doc-scroll className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[728px] px-4 pb-32 pt-1 md:px-6 md:pt-8">
              {search.rev ? (
                <RevisionContent revisionId={search.rev} current={save} compare={compare} workspaceId={ws.id} />
              ) : (
                <>
                  <TitleInput
                    value={save.title}
                    onChange={setTitle}
                    onEnter={focusBody}
                    readOnly={!editable}
                    autoFocus={freshTitle && !phone}
                    className="max-md:text-[28px] max-md:leading-[34px]"
                  />
                  <EditedBy actor={doc.updatedBy} at={doc.updatedAt} meId={me?.id} state={save.state} className="mt-2 md:hidden" />
                  <div className="mt-4">
                    {editable ? (
                      <MarkdownEditor
                        value={save.content}
                        onChange={save.setContent}
                        workspaceId={ws.id}
                        variant="page"
                        placeholder="Write something, or press / for commands"
                        onCheckpoint={() => save.flush(true)}
                        viewRef={viewRef}
                      />
                    ) : (
                      <MarkdownView markdown={save.content} workspaceId={ws.id} onToggleTask={doc.canEdit ? save.setContent : undefined} />
                    )}
                  </div>
                  {phone ? (
                    <LinkedFromCard backlinks={doc.backlinks} ws={ws.slug} />
                  ) : (
                    <LinkedFromPills backlinks={doc.backlinks} ws={ws.slug} />
                  )}
                </>
              )}
            </div>
          </div>
        )}
        {history && !phone ? (
          <HistoryPanel
            docId={doc.id}
            workspaceId={ws.id}
            selected={search.rev}
            onClose={toggleHistory}
            onSelect={(r) => setSearch(r.current ? { history: true } : { history: true, rev: r.id })}
          />
        ) : (
          !phone && (
            <aside className="hidden w-[280px] shrink-0 flex-col gap-7 overflow-y-auto px-6 pb-6 pt-10 xl:flex" aria-label="Page info">
              {headings.length > 0 && <Outline title={save.title} headings={headings} active={activeHeading} onJump={jump} />}
            </aside>
          )
        )}
      </div>

      {phone && (
        <Dialog open={shareOpen} onOpenChange={setShareOpen} position="sheet" title="Share" className="top-auto max-h-[85dvh]">
          <div className="overflow-y-auto pb-safe">
            <div className="px-4 pt-4 text-base font-semibold text-ink">Share</div>
            <SharePanel docId={doc.id} workspaceId={ws.id} />
          </div>
        </Dialog>
      )}
      <Dialog open={outlineOpen} onOpenChange={setOutlineOpen} position="sheet" title="On this page" className="top-auto max-h-[70dvh]">
        <div className="flex flex-col overflow-y-auto px-2 pb-safe pt-2">
          <div className="px-3 pb-2 pt-2 text-label font-medium text-ink-subtle">On this page</div>
          {[{ text: save.title || "Untitled", level: 1 }, ...headings].map((h, i) => (
            <button
              key={i}
              type="button"
              onClick={() => jump(i - 1)}
              className={cn(
                "flex min-h-11 items-center rounded-lg px-3 text-left text-touch active:bg-state-active",
                activeHeading === i - 1 ? "text-ink" : "text-ink-muted",
              )}
              style={{ paddingLeft: 12 + Math.max(0, h.level - 1) * 14 }}
            >
              <span className="truncate">{h.text}</span>
            </button>
          ))}
          <div className="h-4" />
        </div>
      </Dialog>
      <MoveDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        tree={tree}
        doc={doc}
        onMove={(parentId) => {
          setMoveOpen(false);
          moveDoc(ws.id, doc.id, parentId);
        }}
      />
      <SummaryDialog open={summaryOpen} onOpenChange={setSummaryOpen} docId={doc.id} workspaceId={ws.id} />
    </div>
  );
}

function RevisionBadge({ docId, rev }: { docId: string; rev: string }) {
  const { data } = useQuery(orpc.revision.list.queryOptions({ input: { entityType: "doc", entityId: docId } }));
  const r = data?.find((x) => x.id === rev);
  if (!r || !data) return null;
  return <Badge className="font-normal">revision {r.number} of {Math.max(...data.map((x) => x.number))}</Badge>;
}

