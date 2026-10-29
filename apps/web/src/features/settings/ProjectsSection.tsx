import { type Label, LABEL_COLORS, type LabelColor, type Project, type Repo, type Workspace } from "@mado/contract";
import { Button, Card, cn, Dialog, Field, IconButton, Input, Select, Spinner, Textarea } from "@mado/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ChevronRight, GitBranch, Plus, Trash2 } from "@mado/ui/fluent";
import { useEffect, useState } from "react";
import { client, errorMessage, orpc, queryClient } from "../../lib/orpc";
import { useCommands } from "../../lib/shortcuts";
import { ago } from "../../lib/time";
import { toast } from "../../lib/toast";
import { useWorkspace } from "../../lib/workspace";
import { KeyStatus, suggestKey, useKeyCheck } from "../auth/OnboardingPage";
import { ConfirmDialog, CopyField, EmptyLine, InlineInput, SettingsGroup, SettingsRow, TitleAction, touchInput } from "./shared";

export function ProjectsSection() {
  const ws = useWorkspace();
  const { id } = useSearch({ strict: false }) as { id?: string };
  const [creating, setCreating] = useState(false);
  const project = id ? ws.projects.find((p) => p.id === id) : undefined;
  useCommands([{ id: "projects.new", title: "New project", group: "Settings", icon: <Plus />, run: () => setCreating(true) }], []);

  if (project) return <ProjectDetail key={project.id} project={project} />;
  return (
    <>
      {ws.role === "owner" && (
        <TitleAction>
          <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
            New project
          </Button>
        </TitleAction>
      )}
      {ws.projects.length === 0 ? (
        <EmptyLine>No projects yet.</EmptyLine>
      ) : (
        <Card>
          {ws.projects.map((p) => (
            <Link
              key={p.id}
              to="/$ws/settings/$section"
              params={{ ws: ws.slug, section: "projects" }}
              search={{ id: p.id }}
              className="flex min-h-12 items-center gap-3 px-4 py-2 outline-none hover:bg-state-hover active:bg-state-active"
            >
              <span className="w-12 shrink-0 text-label font-medium text-ink-subtle">{p.key}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{p.name}</span>
              <span className="shrink-0 text-label text-ink-subtle">{p.openTaskCount} open</span>
              <ChevronRight className="size-4 shrink-0 text-ink-faint" />
            </Link>
          ))}
        </Card>
      )}
      <NewProjectDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [edited, setEdited] = useState(false);
  const state = useKeyCheck(key);
  useEffect(() => {
    if (!open) {
      setName("");
      setKey("");
      setEdited(false);
    }
  }, [open]);
  const create = useMutation({
    mutationFn: () => client.project.create({ workspaceId: ws.id, name: name.trim(), key }),
    onSuccess: async (p) => {
      await queryClient.invalidateQueries({ queryKey: orpc.workspace.list.key() });
      onOpenChange(false);
      toast(`${p.name} created. Tasks will be ${p.key}-1, ${p.key}-2 …`);
      navigate({ to: "/$ws/settings/$section", params: { ws: ws.slug, section: "projects" }, search: { id: p.id } });
    },
  });
  const ok = name.trim() && (state === "free" || state === "unknown");
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New project" className="max-w-md">
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) create.mutate();
        }}
      >
        <h2 className="text-base font-semibold text-ink">New project</h2>
        <Field label="Name">
          <Input
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!edited) setKey(suggestKey(e.target.value));
            }}
          />
        </Field>
        <div className="flex flex-col gap-1.5">
          <Field label="Key" hint="prefixes every task ID, can't change later">
            <Input
              value={key}
              maxLength={5}
              onChange={(e) => {
                setEdited(true);
                setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5));
              }}
            />
          </Field>
          <KeyStatus state={state} />
        </div>
        {create.error && <p className="text-label text-danger">{errorMessage(create.error)}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!ok} loading={create.isPending}>
            Create project
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function patchProject(id: string, patch: Partial<Project>) {
  const key = orpc.workspace.list.queryKey();
  const prev = queryClient.getQueryData<Workspace[]>(key);
  if (prev) queryClient.setQueryData(key, prev.map((w) => ({ ...w, projects: w.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) })));
  return () => queryClient.setQueryData(key, prev);
}

function ProjectDetail({ project }: { project: Project }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const owner = ws.role === "owner";
  const [description, setDescription] = useState(project.description);
  const [deleting, setDeleting] = useState(false);

  const update = useMutation({
    mutationFn: (patch: { name?: string; description?: string }) => client.project.update({ id: project.id, ...patch }),
    onMutate: (patch) => ({ rollback: patchProject(project.id, patch) }),
    onError: (e, _p, ctx) => {
      ctx?.rollback();
      toast.error(`Couldn't save: ${errorMessage(e)}`);
    },
  });
  const remove = useMutation({
    mutationFn: () => client.project.delete({ id: project.id }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orpc.workspace.list.key() });
      queryClient.invalidateQueries({ queryKey: orpc.trash.key() });
      toast(`${project.name} moved to the trash`, {
        action: { label: "Undo", run: () => client.trash.restore({ entityType: "project", id: project.id }).then(() => queryClient.invalidateQueries({ queryKey: orpc.workspace.list.key() })) },
      });
      navigate({ to: "/$ws/settings/$section", params: { ws: ws.slug, section: "projects" }, search: {} });
    },
    onError: (e) => toast.error(`Couldn't delete: ${errorMessage(e)}`),
  });

  return (
    <>
      <SettingsGroup>
        <Card>
          <SettingsRow label="Name" stack>
            <InlineInput label="Project name" className="sm:w-64" value={project.name} disabled={!owner} onSave={(name) => update.mutate({ name })} />
          </SettingsRow>
          <SettingsRow label="Key" description="Fixed, because task IDs are never reused.">
            <span className="text-sm font-medium text-ink">{project.key}</span>
          </SettingsRow>
          <div className="flex flex-col gap-2 px-4 py-3">
            <span className="text-sm text-ink">Description</span>
            <Textarea
              rows={3}
              value={description}
              disabled={!owner}
              className="max-md:text-touch"
              placeholder="What this project is about. Agents read it first."
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => description !== project.description && update.mutate({ description }, { onSuccess: () => toast("Description saved") })}
            />
          </div>
        </Card>
      </SettingsGroup>
      <LabelsGroup projectId={project.id} />
      <ReposGroup projectId={project.id} />
      {owner && (
        <SettingsGroup title="Danger zone">
          <Card>
            <SettingsRow label="Delete project">
              <Button variant="danger" icon={<Trash2 />} onClick={() => setDeleting(true)}>
                Delete project
              </Button>
            </SettingsRow>
          </Card>
        </SettingsGroup>
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${project.name} (${project.key})?`}
        confirmLabel="Delete project"
        danger
        loading={remove.isPending}
        onConfirm={() => {
          setDeleting(false);
          remove.mutate();
        }}
      >
        {project.openTaskCount} open tasks, its pages and leads move to the trash. You can restore the project from there within 30 days.
      </ConfirmDialog>
    </>
  );
}

const COLOR_OPTIONS = LABEL_COLORS.map((c) => ({ value: c, label: c[0]!.toUpperCase() + c.slice(1) }));

function LabelsGroup({ projectId }: { projectId: string }) {
  const labels = useQuery(orpc.project.labels.queryOptions({ input: { projectId } }));
  const key = orpc.project.labels.queryKey({ input: { projectId } });
  const [name, setName] = useState("");
  const [color, setColor] = useState<LabelColor>("grey");

  const optimistic = (fn: (l: Label[]) => Label[]) => {
    const prev = queryClient.getQueryData<Label[]>(key);
    if (prev) queryClient.setQueryData(key, fn(prev));
    return { prev };
  };
  const rollback = (e: unknown, _v: unknown, ctx?: { prev?: Label[] }) => {
    queryClient.setQueryData(key, ctx?.prev);
    toast.error(errorMessage(e));
  };
  const settle = () => queryClient.invalidateQueries({ queryKey: key });

  const create = useMutation({
    mutationFn: (v: { name: string; color: LabelColor; tempId: string }) => client.project.createLabel({ projectId, name: v.name, color: v.color }),
    onMutate: (v) => optimistic((l) => [...l, { id: v.tempId, projectId, name: v.name, color: v.color, taskCount: 0 }]),
    onError: rollback,
    onSettled: settle,
  });
  const update = useMutation({
    mutationFn: (v: { id: string; name?: string; color?: LabelColor }) => client.project.updateLabel(v),
    onMutate: (v) => optimistic((l) => l.map((x) => (x.id === v.id ? { ...x, ...v } : x))),
    onError: rollback,
    onSettled: settle,
  });
  const remove = useMutation({
    mutationFn: (l: Label) => client.project.deleteLabel({ id: l.id }),
    onMutate: (l) => optimistic((list) => list.filter((x) => x.id !== l.id)),
    onError: rollback,
    onSuccess: (_r, l) => toast(`Label “${l.name}” moved to the trash`),
    onSettled: settle,
  });

  return (
    <SettingsGroup title="Labels">
      <Card>
        {labels.isPending ? (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        ) : (
          (labels.data ?? []).map((l) => (
            <div key={l.id} className="flex min-h-12 items-center gap-3 px-4 py-2">
              <span className="size-2 shrink-0 rounded-full bg-ink-subtle" />
              <InlineInput label="Label name" className="max-w-56 flex-1" value={l.name} onSave={(n) => update.mutate({ id: l.id, name: n })} />
              <Select className="w-28" value={l.color} onChange={(c) => update.mutate({ id: l.id, color: c })} options={COLOR_OPTIONS} />
              <span className="ml-auto hidden text-label text-ink-subtle sm:inline">
                {l.taskCount} task{l.taskCount === 1 ? "" : "s"}
              </span>
              <IconButton label={`Delete ${l.name}`} size="sm" onClick={() => remove.mutate(l)}>
                <Trash2 />
              </IconButton>
            </div>
          ))
        )}
        <form
          className="flex items-center gap-3 px-4 py-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            create.mutate({ name: name.trim(), color, tempId: crypto.randomUUID() });
            setName("");
          }}
        >
          <span className="size-2 shrink-0 rounded-full border border-ink-faint" />
          <Input className={cn("max-w-56 flex-1", touchInput)} aria-label="New label" placeholder="New label" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          <Select className="w-28" value={color} onChange={setColor} options={COLOR_OPTIONS} />
          <Button type="submit" size="sm" className="ml-auto" disabled={!name.trim()}>
            Add
          </Button>
        </form>
      </Card>
    </SettingsGroup>
  );
}

function ReposGroup({ projectId }: { projectId: string }) {
  const repos = useQuery(orpc.project.repos.queryOptions({ input: { projectId } }));
  const key = orpc.project.repos.queryKey({ input: { projectId } });
  const [provider, setProvider] = useState<"github" | "gitlab">("github");
  const [fullName, setFullName] = useState("");
  const [fresh, setFresh] = useState<Repo | null>(null);
  const [removing, setRemoving] = useState<Repo | null>(null);

  const add = useMutation({
    mutationFn: () => client.project.addRepo({ projectId, provider, fullName: fullName.trim() }),
    onSuccess: (r) => {
      setFresh(r);
      setFullName("");
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const remove = useMutation({
    mutationFn: (r: Repo) => client.project.removeRepo({ id: r.id }),
    onMutate: (r) => {
      const prev = queryClient.getQueryData<Repo[]>(key);
      if (prev) queryClient.setQueryData(key, prev.filter((x) => x.id !== r.id));
      if (fresh?.id === r.id) setFresh(null);
      return { prev };
    },
    onError: (e, _r, ctx) => {
      queryClient.setQueryData(key, ctx?.prev);
      toast.error(errorMessage(e));
    },
  });

  return (
    <SettingsGroup title="Git repositories">
      {fresh?.secret && (
        <div className="flex animate-pop flex-col gap-3 rounded-lg border border-edge bg-panel p-4">
          <div>
            <div className="text-sm font-medium text-ink">Add this webhook to {fresh.fullName}</div>
            <div className="text-label text-ink-subtle">
              {fresh.provider === "github" ? "JSON, push and pull request events." : "Push and merge request events."} The secret is shown only now.
            </div>
          </div>
          <Field label="Payload URL">
            <CopyField value={fresh.webhookUrl} label="Copy URL" />
          </Field>
          <Field label={fresh.provider === "github" ? "Secret" : "Secret token"}>
            <CopyField value={fresh.secret} label="Copy secret" />
          </Field>
          <Button size="sm" className="self-end" onClick={() => setFresh(null)}>
            Done
          </Button>
        </div>
      )}
      <Card>
        {(repos.data ?? []).map((r) => (
          <div key={r.id} className="flex min-h-12 items-center gap-3 py-2 pl-4 pr-2">
            <GitBranch className="size-4 shrink-0 text-ink-subtle" />
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{r.fullName}</span>
            <span className="hidden shrink-0 text-label text-ink-subtle sm:inline">{r.lastEventAt ? `last event ${ago(r.lastEventAt)}` : "no events yet"}</span>
            <Button size="sm" variant="ghost" onClick={() => setRemoving(r)}>
              Remove
            </Button>
          </div>
        ))}
        <form
          className="flex flex-wrap items-center gap-3 px-4 py-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (fullName.trim().length >= 3) add.mutate();
          }}
        >
          <Select
            className="w-28"
            value={provider}
            onChange={setProvider}
            options={[
              { value: "github", label: "GitHub" },
              { value: "gitlab", label: "GitLab" },
            ]}
          />
          <Input className={cn("min-w-40 flex-1", touchInput)} aria-label="Repository" placeholder="owner/repository" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <Button type="submit" size="sm" disabled={fullName.trim().length < 3} loading={add.isPending}>
            Connect
          </Button>
          {add.error && <p className="w-full text-label text-danger">{errorMessage(add.error)}</p>}
        </form>
      </Card>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Disconnect ${removing?.fullName}?`}
        confirmLabel="Disconnect"
        danger
        onConfirm={() => {
          if (removing) remove.mutate(removing);
          setRemoving(null);
        }}
      >
        Its webhook stops being accepted. Links to commits and PRs already on tasks stay. Remove the webhook on {removing?.provider === "gitlab" ? "GitLab" : "GitHub"} too.
      </ConfirmDialog>
    </SettingsGroup>
  );
}
