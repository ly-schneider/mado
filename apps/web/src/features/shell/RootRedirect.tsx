import { Spinner } from "@mado/ui";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useSearch } from "@tanstack/react-router";
import { orpc } from "../../lib/orpc";
import { useMe, useWorkspaces } from "../../lib/workspace";

/** "/" → setup on a fresh instance, login when signed out, onboarding with no workspace, else the last workspace. */
export function RootRedirect() {
  const setup = useQuery(orpc.auth.setupStatus.queryOptions());
  const me = useMe();
  const workspaces = useWorkspaces();
  // The PWA manifest shortcut opens /?capture=task.
  const wantsCapture = (useSearch({ strict: false }) as { capture?: string }).capture === "task";
  if (setup.data?.needsSetup) return <Navigate to="/setup" />;
  if (me.isPending || setup.isPending) return <Center />;
  if (!me.data) return <Navigate to="/login" search={{ next: undefined }} />;
  if (workspaces.isPending) return <Center />;
  const list = workspaces.data ?? [];
  if (list.length === 0) return <Navigate to="/onboarding" />;
  const last = localStorage.getItem("mado.lastWorkspace");
  const ws = list.find((w) => w.slug === last) ?? list[0]!;
  if (wantsCapture) return <Navigate to="/$ws/capture" params={{ ws: ws.slug }} />;
  return <Navigate to="/$ws/my-tasks" params={{ ws: ws.slug }} />;
}

function Center() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  );
}
