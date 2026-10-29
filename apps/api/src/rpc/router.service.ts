import { Injectable } from "@nestjs/common";
import { createRouterClient, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/node";
import type { Request, Response } from "express";
import { config } from "../config";
import type { Actor } from "../lib/actor";
import { AccessService } from "../services/access.service";
import { AgentService } from "../services/agent.service";
import { AiService } from "../services/ai.service";
import { AuditService } from "../services/audit.service";
import { AuthService } from "../services/auth.service";
import { CrmService } from "../services/crm.service";
import { DocService } from "../services/doc.service";
import { InboxService } from "../services/inbox.service";
import { OAuthService } from "../services/oauth.service";
import { ProjectService } from "../services/project.service";
import { RefsService } from "../services/refs.service";
import { SearchService } from "../services/search.service";
import { SettingsService } from "../services/settings.service";
import { ShareService } from "../services/share.service";
import { TaskService } from "../services/task.service";
import { TrashService } from "../services/trash.service";
import { WorkspaceService } from "../services/workspace.service";
import { createRouter } from "./router";
import type { Services } from "./services";

/**
 * Builds the oRPC router once. /rpc serves it over HTTP; MCP calls it in-process with an agent actor,
 * so agents go through exactly the same validation and authorization as the UI.
 */
@Injectable()
export class RouterService {
  readonly services: Services;
  readonly router: ReturnType<typeof createRouter>;
  readonly handler: RPCHandler<any>;

  constructor(
    access: AccessService,
    agent: AgentService,
    ai: AiService,
    audit: AuditService,
    auth: AuthService,
    crm: CrmService,
    doc: DocService,
    inbox: InboxService,
    oauth: OAuthService,
    project: ProjectService,
    refs: RefsService,
    search: SearchService,
    settings: SettingsService,
    share: ShareService,
    task: TaskService,
    trash: TrashService,
    workspace: WorkspaceService,
  ) {
    this.services = { access, agent, ai, audit, auth, crm, doc, inbox, oauth, project, refs, search, settings, share, task, trash, workspace };
    this.router = createRouter(this.services);
    this.handler = new RPCHandler(this.router, {
      interceptors: [
        onError((error) => {
          const code = (error as { code?: string }).code;
          if (config.dev && !["UNAUTHORIZED", "NOT_FOUND", "FORBIDDEN", "BAD_REQUEST", "CONFLICT"].includes(code ?? "")) console.error(error);
        }),
      ],
    });
  }

  /** Typed in-process client acting as `actor`. Used by MCP tools. */
  clientFor(actor: Actor, ip: string | null = null) {
    const stub = {} as Request & Response;
    return createRouterClient(this.router, { context: { req: stub, res: stub, actor, ip } });
  }
}
