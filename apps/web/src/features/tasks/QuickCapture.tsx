import { Dialog } from "@mado/ui";
import { useEffect, useState } from "react";
import { closeCapture, setUi, useUi } from "../../lib/ui";
import { CapturePanel, type CaptureKind } from "./CapturePanel";
import { useIsPhone } from "./data";

/** Mounted once by AppShell; opened with C, the FAB, ⌥Space (desktop) or openCapture(). */
export function QuickCapture() {
  const capture = useUi((s) => s.capture);
  const isPhone = useIsPhone();
  // Remount the panel on every open so it starts empty.
  const [session, setSession] = useState(0);
  useEffect(() => {
    if (capture.open) setSession((n) => n + 1);
  }, [capture.open]);

  const setKind = (kind: CaptureKind) => setUi((s) => ({ capture: { ...s.capture, kind } }));

  return (
    <Dialog
      open={capture.open}
      onOpenChange={(o) => !o && closeCapture()}
      position={isPhone ? "sheet" : "top"}
      title="Quick capture"
      className={isPhone ? "" : "top-[18vh] max-w-[680px]"}
    >
      {capture.open && (
        <CapturePanel
          key={session}
          kind={capture.kind}
          setKind={setKind}
          initialProjectId={capture.projectId}
          initialStatus={capture.status}
          onClose={closeCapture}
          variant={isPhone ? "sheet" : "panel"}
        />
      )}
    </Dialog>
  );
}
