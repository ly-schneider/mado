import type { InstanceInfo, InstanceUser } from "@mado/contract";
import { Card, Spinner, Switch } from "@mado/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { client, errorMessage, orpc, queryClient } from "../../lib/orpc";
import { toast } from "../../lib/toast";
import { useMe } from "../../lib/workspace";
import { EmptyLine, SettingsGroup, SettingsRow } from "./shared";

export function InstanceSection() {
  const me = useMe().data;
  const instance = useQuery(orpc.settings.instance.queryOptions());
  const users = useQuery({ ...orpc.settings.users.queryOptions(), enabled: !!me?.isAdmin });
  const instanceKey = orpc.settings.instance.queryKey();
  const usersKey = orpc.settings.users.queryKey();

  const update = useMutation({
    mutationFn: (membersCanCreateWorkspaces: boolean) => client.settings.updateInstance({ membersCanCreateWorkspaces }),
    onMutate: (membersCanCreateWorkspaces) => {
      const prev = queryClient.getQueryData<InstanceInfo>(instanceKey);
      if (prev) queryClient.setQueryData<InstanceInfo>(instanceKey, { ...prev, membersCanCreateWorkspaces });
      return { prev };
    },
    onError: (e, _v, ctx) => {
      queryClient.setQueryData(instanceKey, ctx?.prev);
      toast.error(`Couldn't save: ${errorMessage(e)}`);
    },
    onSuccess: (data) => queryClient.setQueryData(instanceKey, data),
  });

  const setAdmin = useMutation({
    mutationFn: (v: { userId: string; admin: boolean }) => client.settings.setAdmin(v),
    onMutate: ({ userId, admin }) => {
      const prev = queryClient.getQueryData<InstanceUser[]>(usersKey);
      queryClient.setQueryData<InstanceUser[]>(usersKey, (l) => l?.map((u) => (u.id === userId ? { ...u, isAdmin: admin } : u)));
      return { prev };
    },
    onError: (e, _v, ctx) => {
      queryClient.setQueryData(usersKey, ctx?.prev);
      toast.error(errorMessage(e));
    },
    onSuccess: (data, { userId }) => {
      queryClient.setQueryData(usersKey, data);
      if (userId === me?.id) queryClient.invalidateQueries({ queryKey: orpc.auth.me.queryKey() });
    },
  });

  if (!me?.isAdmin) return <EmptyLine>Only instance admins can change instance settings.</EmptyLine>;
  if (instance.isPending || users.isPending) return <Spinner className="self-center" />;

  return (
    <>
      <SettingsGroup title="Workspaces">
        <Card>
          <SettingsRow label="Members can create workspaces" description="Off: only instance admins can.">
            <Switch label="Members can create workspaces" checked={instance.data?.membersCanCreateWorkspaces ?? false} onChange={(v) => update.mutate(v)} />
          </SettingsRow>
        </Card>
      </SettingsGroup>

      <SettingsGroup title="Accounts">
        <Card>
          {(users.data ?? []).map((u) => (
            <SettingsRow key={u.id} label={u.id === me.id ? `${u.name} · you` : u.name} description={u.email}>
              <Switch label={`${u.name} is an admin`} checked={u.isAdmin} onChange={(admin) => setAdmin.mutate({ userId: u.id, admin })} />
            </SettingsRow>
          ))}
        </Card>
        <p className="px-1 text-label text-ink-subtle">Switched on: instance admin. Admins change the AI key and models, decide who creates workspaces, and pick other admins.</p>
      </SettingsGroup>
    </>
  );
}
