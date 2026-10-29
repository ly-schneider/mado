import type { AiSettings } from "@mado/contract";
import { Button, Card, cn, Input, Spinner } from "@mado/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "@mado/ui/fluent";
import { useState } from "react";
import { client, errorMessage, orpc, queryClient } from "../../lib/orpc";
import { toast } from "../../lib/toast";
import { ConfirmDialog, EmptyLine, InlineInput, SettingsGroup, SettingsRow, touchInput } from "./shared";

const FEATURES: { key: keyof AiSettings["models"]; title: string }[] = [
  { key: "taskDraft", title: "Task drafts" },
  { key: "docSummary", title: "Page summaries" },
  { key: "leadAnalysis", title: "Lead analysis" },
  { key: "emailDraft", title: "Email drafts" },
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
  if (ai.isError) return <EmptyLine>{errorMessage(ai.error)}</EmptyLine>;
  const s = ai.data;
  const showInput = !s.hasKey || replacing;

  return (
    <>
      <SettingsGroup title="OpenRouter key">
        <Card>
          {showInput ? (
            <form
              className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center"
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
                aria-label="OpenRouter API key"
                placeholder="sk-or-v1-…"
                className={cn("flex-1", touchInput)}
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
            <SettingsRow label="API key">
              <span className="text-sm text-ink-muted">Saved</span>
              <div className="-mr-2 flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setReplacing(true)}>
                  Replace
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(true)}>
                  Remove
                </Button>
              </div>
            </SettingsRow>
          )}
        </Card>
        <p className="px-1 text-label text-ink-subtle">
          Only the item you run an AI action on is sent to openrouter.ai, nothing in the background.{" "}
          <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent">
            Get a key <ArrowUpRight className="size-3.5" />
          </a>
        </p>
      </SettingsGroup>

      <SettingsGroup title="Models">
        <Card>
          {FEATURES.map((f) => (
            <SettingsRow key={f.key} label={f.title} stack>
              <InlineInput
                label={`${f.title} model`}
                className="sm:w-64"
                placeholder="anthropic/claude-sonnet-5"
                value={s.models[f.key]}
                onSave={(model) => save.mutate({ models: { [f.key]: model } }, { onSuccess: () => toast(`${f.title} use ${model}`) })}
              />
            </SettingsRow>
          ))}
        </Card>
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
