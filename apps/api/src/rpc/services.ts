import type { AccessService } from "../services/access.service";
import type { AgentService } from "../services/agent.service";
import type { AiService } from "../services/ai.service";
import type { AuditService } from "../services/audit.service";
import type { AuthService } from "../services/auth.service";
import type { CrmService } from "../services/crm.service";
import type { DocService } from "../services/doc.service";
import type { InboxService } from "../services/inbox.service";
import type { OAuthService } from "../services/oauth.service";
import type { ProjectService } from "../services/project.service";
import type { RefsService } from "../services/refs.service";
import type { SearchService } from "../services/search.service";
import type { SettingsService } from "../services/settings.service";
import type { ShareService } from "../services/share.service";
import type { TaskService } from "../services/task.service";
import type { TrashService } from "../services/trash.service";
import type { WorkspaceService } from "../services/workspace.service";

/** Every Nest service the RPC router needs. RouterService builds this from DI. */
export interface Services {
  access: AccessService;
  agent: AgentService;
  ai: AiService;
  audit: AuditService;
  auth: AuthService;
  crm: CrmService;
  doc: DocService;
  inbox: InboxService;
  oauth: OAuthService;
  project: ProjectService;
  refs: RefsService;
  search: SearchService;
  settings: SettingsService;
  share: ShareService;
  task: TaskService;
  trash: TrashService;
  workspace: WorkspaceService;
}
