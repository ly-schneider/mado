import { agentsRouter } from "./agents";
import { auditRouter } from "./audit";
import { authRouter } from "./auth";
import { crmRouter } from "./crm";
import { docRouter } from "./doc";
import { guestRouter } from "./guest";
import { inboxRouter } from "./inbox";
import { oauthRouter } from "./oauth";
import { projectRouter } from "./project";
import { revisionRouter } from "./revision";
import { searchRouter } from "./search";
import type { Services } from "./services";
import { settingsRouter } from "./settings";
import { shareRouter } from "./share";
import { taskRouter } from "./task";
import { trashRouter } from "./trash";
import { workspaceRouter } from "./workspace";

export function createRouter(s: Services) {
  return {
    auth: authRouter(s),
    workspace: workspaceRouter(s),
    project: projectRouter(s),
    task: taskRouter(s),
    doc: docRouter(s),
    revision: revisionRouter(s),
    share: shareRouter(s),
    guest: guestRouter(s),
    search: searchRouter(s),
    trash: trashRouter(s),
    audit: auditRouter(s),
    agents: agentsRouter(s),
    oauth: oauthRouter(s),
    inbox: inboxRouter(s),
    crm: crmRouter(s),
    settings: settingsRouter(s),
  };
}
