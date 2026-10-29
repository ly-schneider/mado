import { Module } from "@nestjs/common";
import { DbService } from "./db";
import { JobsService } from "./jobs/jobs.service";
import { McpController } from "./mcp/mcp.controller";
import { OAuthController } from "./oauth/oauth.controller";
import { WebhooksController } from "./webhooks/webhooks.controller";
import { RouterService } from "./rpc/router.service";
import { RpcController } from "./rpc/rpc.controller";
import { AccessService } from "./services/access.service";
import { AgentService } from "./services/agent.service";
import { AiService } from "./services/ai.service";
import { AuditService } from "./services/audit.service";
import { AuthService } from "./services/auth.service";
import { CrmService } from "./services/crm.service";
import { DocService } from "./services/doc.service";
import { InboxService } from "./services/inbox.service";
import { OAuthService } from "./services/oauth.service";
import { ProjectService } from "./services/project.service";
import { RefsService } from "./services/refs.service";
import { SearchService } from "./services/search.service";
import { SettingsService } from "./services/settings.service";
import { ShareService } from "./services/share.service";
import { TaskService } from "./services/task.service";
import { TrashService } from "./services/trash.service";
import { WorkspaceService } from "./services/workspace.service";
import { SpaController } from "./spa.controller";

@Module({
  // SpaController must stay last: it catches every GET no other route took.
  controllers: [RpcController, McpController, OAuthController, WebhooksController, SpaController],
  providers: [
    DbService,
    JobsService,
    RouterService,
    AccessService,
    AgentService,
    AiService,
    AuditService,
    AuthService,
    CrmService,
    DocService,
    InboxService,
    OAuthService,
    ProjectService,
    RefsService,
    SearchService,
    SettingsService,
    ShareService,
    TaskService,
    TrashService,
    WorkspaceService,
  ],
})
export class AppModule {}
