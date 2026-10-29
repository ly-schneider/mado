import type { AiSettings } from "@mado/contract";
import { Badge, Button, Card, CardRow, Input, Spinner } from "@mado/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "@mado/ui/fluent";
import { useState } from "react";
import { client, errorMessage, orpc, queryClient } from "../../lib/orpc";
import { toast } from "../../lib/toast";
import { ConfirmDialog, InlineInput, SettingsGroup } from "./shared";

const FEATURES: { key: keyof AiSettings["models"]; title: string; description: string }[] = [
  { key: "taskDraft", title: "Task drafts", description: "One sentence → title, description, acceptance criteria." },
  { key: "docSummary", title: "Page summaries", description: "Summarise a wiki page on request." },
  { key: "leadAnalysis", title: "Lead analysis", description: "Fit, timing and risk for a lead." },
  { key: "emailDraft", title: "Email drafts", description: "A personal email you send yourself." },
];

export function AiSection() {
  const ai = useQuery(orpc.settings.ai.queryOptions());
  const key = orpc.settings.ai.queryKey();
  const [apiKey, setApiKey] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const save = useMutation({
    mutationFn: (patch: Parameters<typeof client.settings.updateAi>[0]) => client.settings.updateAi(patch),
    onMutate: (patch) => {
      const prev = queryClient.getQueryData<AiSettings>(key);
      if (prev)
        queryClient.setQueryData<AiSettings>(key, {
          hasKey: patch.apiKey === undefined ? prev.hasKey : patch.apiKey !== null,
          models: { ...prev.models, ...patch.models },
        });
      return { prev };
    },
    onError: (e, _p, ctx) => {
      queryClient.setQueryData(key, ctx?.prev);
      toast.error(`Couldn't save: ${errorMessage(e)}`);
    },
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });

  if (ai.isPending) return <Spinner className="self-center" />;
  if (ai.isError) return <p className="text-label text-ink-subtle">{errorMessage(ai.error)}</p>;
  const s = ai.data;
  const showInput = !s.hasKey || replacing;

  return (
    <>
      <SettingsGroup
        title="OpenRouter key"
        description="mado stores the key encrypted on the server and never shows it again. Calls are billed to your OpenRouter account."
      >
        <Card>
          {showInput ? (
            <form
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
              onSubmit={(e) => {
                e.preventDefault();
                if (!apiKey.trim()) return;
                save.mutate(
                  { apiKey: apiKey.trim() },
                  {
                    onSuccess: () => {
                      setApiKey("");
                      setReplacing(false);
                      toast("Key saved");
                    },
                  },
                );
              }}
            >
              <Input
                type="password"
                autoComplete="off"
                placeholder="sk-or-v1-…"
                className="flex-1"
                value={apiKey}
                autoFocus={replacing}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <div className="flex gap-2">
                {replacing && <Button onClick={() => setReplacing(false)}>Cancel</Button>}
                <Button type="submit" variant="primary" disabled={!apiKey.trim()} loading={save.isPending}>
                  Save key
                </Button>
              </div>
            </form>
          ) : (
            <CardRow
              title={
                <span className="flex items-center gap-2">
                  API key <Badge>set</Badge>
                </span>
              }
              description="AI buttons are on for everyone in your workspaces."
            >
              <Button size="sm" onClick={() => setReplacing(true)}>
                Replace
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(true)}>
                Remove
              </Button>
            </CardRow>
          )}
        </Card>
        <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="flex items-center gap-1 self-start text-label text-accent">
          Get a key on openrouter.ai <ArrowUpRight className="size-3.5" />
        </a>
      </SettingsGroup>

      <SettingsGroup title="Models" description="Any OpenRouter model ID, e.g. anthropic/claude-sonnet-5. Each feature can use a different one.">
        <Card>
          {FEATURES.map((f) => (
            <CardRow key={f.key} title={f.title} description={f.description}>
              <InlineInput
                label={`${f.title} model`}
                className="w-64"
                value={s.models[f.key]}
                onSave={(model) => save.mutate({ models: { [f.key]: model } }, { onSuccess: () => toast(`${f.title} use ${model}`) })}
              />
            </CardRow>
          ))}
        </Card>
      </SettingsGroup>

      <SettingsGroup title="What leaves the server">
        <div className="rounded-lg border border-edge bg-panel px-4 py-3 text-label text-ink-muted">
          Apart from your backups, the only outbound calls mado makes go to openrouter.ai, and only when someone presses an AI button: Draft task, Summarise, Analyse lead or Draft email. Each
          call sends that one item's text and nothing else. Nothing runs in the background, and without a key no call
          is ever made.
        </div>
      </SettingsGroup>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove the OpenRouter key?"
        confirmLabel="Remove key"
        danger
        onConfirm={() => {
          setConfirmRemove(false);
          save.mutate({ apiKey: null }, { onSuccess: () => toast("Key removed. AI buttons are off.") });
        }}
      >
        AI buttons turn off until a new key is added. Existing drafts and analyses stay.
      </ConfirmDialog>
    </>
  );
}
