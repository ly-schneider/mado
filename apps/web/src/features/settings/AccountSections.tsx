import type { Me } from "@mado/contract";
import { Button, Card, CardRow, cn, Field, Input, Kbd, Segmented } from "@mado/ui";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check } from "@mado/ui/fluent";
import { useEffect, useRef, useState } from "react";
import { client, errorMessage, orpc, queryClient } from "../../lib/orpc";
import { apiOrigin, isMac } from "../../lib/platform";
import { type Accent, DEFAULT_ACCENT, setAccent, setTheme, type ThemePref, useTheme } from "../../lib/theme";
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

/** Quick picks only; any colour works. */
const SUGGESTED: { hex: Accent; name: string }[] = [
  { hex: DEFAULT_ACCENT, name: "Blue" },
  { hex: "#a589f0", name: "Violet" },
  { hex: "#ec76b2", name: "Pink" },
  { hex: "#f2734f", name: "Red" },
  { hex: "#f0a43a", name: "Orange" },
  { hex: "#4ec982", name: "Green" },
  { hex: "#3cc4c4", name: "Teal" },
  { hex: "#f5f5f5", name: "White" },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

export function AppearanceSection() {
  const { pref, accent } = useTheme();
  const update = useUpdateProfile();
  const [draft, setDraft] = useState(accent);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setDraft(accent), [accent]);

  // The colour input fires on every drag step: apply live, save once the user settles.
  const pick = (hex: string) => {
    setDraft(hex);
    if (!HEX.test(hex)) return;
    const value = hex.toLowerCase();
    setAccent(value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => update.mutate({ accent: value }), 400);
  };

  return (
    <>
      <SettingsGroup title="Theme" description="Black and white. System follows your device.">
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

      <SettingsGroup title="Accent" description="The only colour in mado: links, focus and selection. Pick anything; it's adjusted per theme so links stay readable.">
        <Card>
          <CardRow title="Colour" description="Saved to your account.">
            <div className="flex items-center gap-2">
              <label className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-md border border-edge" style={{ background: HEX.test(draft) ? draft : accent }}>
                <input type="color" value={HEX.test(draft) ? draft : accent} onChange={(e) => pick(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Pick accent colour" />
              </label>
              <Input value={draft} onChange={(e) => pick(e.target.value)} className="w-28" aria-label="Accent hex" spellCheck={false} />
            </div>
          </CardRow>
          <div className="flex flex-wrap gap-2 px-4 py-3" role="radiogroup" aria-label="Suggested accents">
            {SUGGESTED.map((s) => {
              const selected = accent.toLowerCase() === s.hex.toLowerCase();
              return (
                <button
                  key={s.hex}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={s.name}
                  title={s.name}
                  onClick={() => pick(s.hex)}
                  className={cn("flex size-7 items-center justify-center rounded-full border border-edge outline-none active:scale-95", selected && "ring-2 ring-ink ring-offset-2 ring-offset-panel")}
                  style={{ background: s.hex }}
                >
                  {selected && <Check className="size-3.5 text-black/70" filled />}
                </button>
              );
            })}
          </div>
        </Card>
        <p className="text-sm text-ink-muted">
          Preview: <span className="text-accent">a link to GAT-109</span> and a <span className="rounded bg-state-selected px-1">selected row</span>.
        </p>
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
