import type { DocNode } from "@mado/contract";
import { Button, Dialog, Spinner } from "@mado/ui";
import { useQuery } from "@tanstack/react-query";
import { Command as Cmdk } from "cmdk";
import { Copy, FileText, FolderInput, Sparkles } from "@mado/ui/fluent";
import { useMemo } from "react";
import { orpc } from "../../lib/orpc";
import { MarkdownView } from "../editor/MarkdownView";
import { childrenMap, descendants } from "./data";

export function MoveDialog({
  open,
  onOpenChange,
  tree,
  doc,
  onMove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tree: DocNode[];
  doc: { id: string; projectId: string | null; parentId: string | null };
  onMove: (parentId: string | null) => void;
}) {
  const options = useMemo(() => {
    const blocked = descendants(tree, doc.id);
    const kids = childrenMap(tree.filter((n) => n.projectId === doc.projectId));
    const out: { node: DocNode; depth: number }[] = [];
    const walk = (pid: string | null, depth: number) => {
      for (const n of kids.get(pid) ?? []) {
        if (blocked.has(n.id)) continue;
        out.push({ node: n, depth });
        walk(n.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [tree, doc.id, doc.projectId]);

  const item = "flex h-8 cursor-default items-center gap-2.5 rounded-md px-2 text-sm text-ink-muted data-[selected=true]:bg-state-active data-[selected=true]:text-ink [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-subtle";
  return (
    <Dialog open={open} onOpenChange={onOpenChange} position="top" title="Move page" className="max-w-[480px]">
      <Cmdk label="Move page" className="flex min-h-0 flex-col">
        <div className="flex h-12 items-center gap-2.5 border-b border-edge px-4">
          <FolderInput className="size-4 text-ink-subtle" />
          <Cmdk.Input autoFocus placeholder="Move to…" className="h-full flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint touch:text-touch" />
        </div>
        <Cmdk.List className="max-h-[360px] overflow-y-auto p-1">
          <Cmdk.Empty className="px-3 py-6 text-center text-label text-ink-subtle">No matching pages</Cmdk.Empty>
          {doc.parentId !== null && (
            <Cmdk.Item value="__top Top level" onSelect={() => onMove(null)} className={item}>
              <FolderInput />
              Top level
            </Cmdk.Item>
          )}
          {options.map(({ node, depth }) => (
            <Cmdk.Item
              key={node.id}
              value={`${node.id} ${node.title}`}
              keywords={[node.title]}
              disabled={node.id === doc.parentId}
              onSelect={() => onMove(node.id)}
              className={`${item} data-[disabled=true]:opacity-40`}
              style={{ paddingLeft: 8 + depth * 16 }}
            >
              <FileText />
              <span className="truncate">{node.title || "Untitled"}</span>
              {node.id === doc.parentId && <span className="ml-auto text-label text-ink-faint">current</span>}
            </Cmdk.Item>
          ))}
        </Cmdk.List>
      </Cmdk>
    </Dialog>
  );
}

export function SummaryDialog({ open, onOpenChange, docId, workspaceId }: { open: boolean; onOpenChange: (open: boolean) => void; docId: string; workspaceId: string }) {
  const { data, isFetching, error } = useQuery(
    orpc.doc.summarize.queryOptions({ input: { id: docId }, enabled: open, staleTime: 5 * 60_000, gcTime: 5 * 60_000, retry: false }),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Summary" className="max-w-[560px]">
      <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
        <Sparkles className="size-4 text-ink-subtle" />
        <span className="text-sm font-semibold text-ink">Summary</span>
        {data && <span className="ml-auto text-label text-ink-subtle">{data.model}</span>}
      </div>
      <div className="max-h-[60vh] overflow-y-auto px-4 py-4">
        {isFetching && !data ? (
          <div className="flex items-center gap-2.5 py-6 text-sm text-ink-subtle">
            <Spinner /> Reading the page…
          </div>
        ) : error ? (
          <div className="py-4 text-sm text-ink-subtle">
            {(error as { message?: string }).message ?? "Could not summarize."} AI features need an OpenRouter key in Settings › AI.
          </div>
        ) : data ? (
          <MarkdownView markdown={data.summary} workspaceId={workspaceId} />
        ) : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-edge px-4 py-3">
        {data && (
          <Button icon={<Copy />} onClick={() => navigator.clipboard.writeText(data.summary)}>
            Copy
          </Button>
        )}
        <Button variant="primary" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}
