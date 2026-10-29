import type { Me } from "@mado/contract";
import { Button, Card, CardRow, cn, Field, Input, Kbd, Segmented } from "@mado/ui";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import { client, errorMessage, orpc, queryClient } from "../../lib/orpc";
import { apiOrigin, isMac } from "../../lib/platform";
import { type Accent, setAccent, setTheme, type ThemePref, useTheme } from "../../lib/theme";
import { toast } from "../../lib/toast";
import { useMe } from "../../lib/workspace";
import { MIN_PASSWORD } from "../auth/SetupPage";
import { InlineInput, SettingsGroup } from "./shared";

function useUpdateProfile() {
  return useMutation({
    mutationFn: (patch: { name?: string; theme?: Me["theme"]; accent?: Me["accent"] }) => client.auth.updateProfile(patch),
    onMutate: (patch) => {
      const key = orpc.auth.me.queryKey();
      const prev = queryClient.getQueryData<Me | null>(key);
      if (prev) queryClient.setQueryData(key, { ...prev, ...patch });
      return { prev };
    },
    onError: (e, _p, ctx) => {
      queryClient.setQueryData(orpc.auth.me.queryKey(), ctx?.prev);
      toast.error(`Couldn't save: ${errorMessage(e)}`);
    },
    onSuccess: (me) => {
      queryClient.setQueryData(orpc.auth.me.queryKey(), me);
      queryClient.invalidateQueries({ queryKey: orpc.workspace.members.key() });
    },
  });
}

export function AccountSection() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const update = useUpdateProfile();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const change = useMutation({
    mutationFn: () => client.auth.changePassword({ current, next }),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      toast("Password changed");
    },
  });
  if (!me) return null;
  const short = next.length > 0 && next.length < MIN_PASSWORD;

  return (
    <>
      <SettingsGroup title="Profile">
        <Card>
          <CardRow title="Name" description="Shown on tasks, comments and in the audit log.">
            <InlineInput label="Name" className="w-56" value={me.name} onSave={(name) => update.mutate({ name }, { onSuccess: () => toast("Name saved") })} />
          </CardRow>
          <CardRow title="Email" description="Used to log in. Ask the instance owner to change it.">
            <span className="truncate text-sm text-ink-muted">{me.email}</span>
          </CardRow>
        </Card>
      </SettingsGroup>

      <SettingsGroup title="Password" description={`At least ${MIN_PASSWORD} characters. Other sessions stay signed in.`}>
        <form
          className="flex flex-col gap-4 rounded-lg border border-edge bg-panel p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!short && current && next) change.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Current password">
              <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field label="New password">
              <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-label text-danger">
              {short ? `Use at least ${MIN_PASSWORD} characters.` : change.error ? errorMessage(change.error) : null}
            </span>
            <Button type="submit" className="ml-auto" disabled={!current || !next || short} loading={change.isPending}>
              Change password
            </Button>
          </div>
        </form>
      </SettingsGroup>

      <SettingsGroup title="Session">
        <Card>
          <CardRow title="Log out" description="Ends this session on this device.">
            <Button
              onClick={async () => {
                await client.auth.logout();
                queryClient.clear();
                navigate({ to: "/login", search: { next: undefined } });
              }}
            >
              Log out
            </Button>
          </CardRow>
        </Card>
      </SettingsGroup>
    </>
  );
}

const ACCENTS: { id: Accent; name: string; note: string }[] = [
  { id: "lamp", name: "Lamp", note: "amber, default" },
  { id: "sora", name: "Sora", note: "sky" },
  { id: "ai", name: "Ai", note: "indigo" },
  { id: "shu", name: "Shu", note: "vermilion" },
];

/** Reads each accent token as the theme would resolve it, so the swatches never hard-code colours. */
function useAccentSwatches(resolved: string) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: recompute when the theme flips
  return useMemo(() => {
    const root = document.documentElement;
    const current = root.dataset.accent;
    const out = {} as Record<Accent, string>;
    for (const a of ACCENTS) {
      root.dataset.accent = a.id;
      out[a.id] = getComputedStyle(root).getPropertyValue("--color-accent").trim();
    }
    root.dataset.accent = current;
    return out;
  }, [resolved]);
}

export function AppearanceSection() {
  const { pref, accent, resolved } = useTheme();
  const update = useUpdateProfile();
  const swatches = useAccentSwatches(resolved);
  return (
    <>
      <SettingsGroup title="Theme" description="Dark and light use the same tones. System follows your device.">
        <Card>
          <CardRow title="Theme" description="Saved to your account, so other devices pick it up.">
            <Segmented<ThemePref>
              value={pref}
              onChange={(theme) => {
                setTheme(theme);
                update.mutate({ theme });
              }}
              options={[
                { value: "system", label: "System" },
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
              ]}
            />
          </CardRow>
        </Card>
      </SettingsGroup>

      <SettingsGroup
        title="Accent"
        description="The only colour in mado. It marks links, focus and selection — nothing else, so everything else stays greyscale."
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Accent">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={accent === a.id}
              onClick={() => {
                setAccent(a.id);
                update.mutate({ accent: a.id });
              }}
              className={cn(
                "flex flex-col gap-3 rounded-lg border border-edge bg-panel p-3 text-left outline-none hover:bg-state-hover active:scale-[0.98]",
                accent === a.id && "border-accent bg-state-selected hover:bg-state-selected",
              )}
            >
              <span className="flex items-center justify-between">
                <span className="flex size-6 items-center justify-center rounded-full" style={{ background: swatches[a.id] }}>
                  {accent === a.id && <Check className="size-3.5 text-on-ink" strokeWidth={3} />}
                </span>
              </span>
              <span>
                <span className="block text-sm font-medium text-ink">{a.name}</span>
                <span className="block text-label text-ink-subtle">{a.note}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="text-label text-ink-subtle">Accent is stored on this device only.</p>
      </SettingsGroup>
    </>
  );
}

export function DesktopSection() {
  const [server, setServer] = useState(apiOrigin());
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    try {
      const url = new URL(server.trim());
      localStorage.setItem("mado.server", url.origin);
      queryClient.clear();
      location.reload();
    } catch {
      setError("Enter a full URL, e.g. https://mado.example.ch");
    }
  };
  return (
    <>
      <SettingsGroup title="Server" description="The desktop app talks to one mado server. Changing it signs you out of this one.">
        <form
          className="flex flex-col gap-3 rounded-lg border border-edge bg-panel p-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Field label="Server URL">
            <Input value={server} onChange={(e) => (setServer(e.target.value), setError(null))} placeholder="https://mado.example.ch" />
          </Field>
          <div className="flex items-center gap-3">
            <span className="text-label text-danger">{error}</span>
            <Button type="submit" className="ml-auto" disabled={server.trim() === apiOrigin()}>
              Connect
            </Button>
          </div>
        </form>
      </SettingsGroup>
      <SettingsGroup title="Shortcuts" description="Global shortcuts work while mado runs in the background.">
        <Card>
          <CardRow title="Quick capture" description="Opens the capture window from anywhere.">
            <span className="flex gap-1">
              <Kbd>{isMac ? "⌥" : "Alt"}</Kbd>
              <Kbd>Space</Kbd>
            </span>
          </CardRow>
          <CardRow title="Command palette" description="Inside the app.">
            <span className="flex gap-1">
              <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
              <Kbd>K</Kbd>
            </span>
          </CardRow>
        </Card>
      </SettingsGroup>
    </>
  );
}
