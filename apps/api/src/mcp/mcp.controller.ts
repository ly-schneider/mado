import { randomUUID } from "node:crypto";
import { All, Controller, type OnModuleDestroy, Req, Res } from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
import { config } from "../config";
import { bearerToken, wwwAuthenticate } from "../lib/agent-auth";
import { RouterService } from "../rpc/router.service";
import { AgentService } from "../services/agent.service";
import { registerTools, SERVER_INSTRUCTIONS } from "./tools";

const MAX_BODY = 5 * 1024 * 1024;
const IDLE_MS = 60 * 60_000;
const TOUCH_MS = 30_000;

interface LiveSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  grantId: string;
  /** Short id of the agent_sessions row shown in the UI ("session 7f3a"). */
  agentSessionId: string;
  lastSeen: number;
  lastTouched: number;
}

function jsonRpcError(res: Response, status: number, message: string, code = -32000) {
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}

async function readJson(req: Request): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("too_large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Streamable HTTP MCP endpoint. Every request re-authenticates its bearer token and re-reads the
 * grant; each MCP session maps to one agent_sessions row so all writes of a run share its id.
 */
@Controller()
export class McpController implements OnModuleDestroy {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly sweeper = setInterval(() => this.sweep(), 5 * 60_000);

  constructor(
    private readonly agents: AgentService,
    private readonly router: RouterService,
  ) {
    this.sweeper.unref?.();
  }

  @All(["mcp", "mcp/"])
  async handle(@Req() req: Request, @Res() res: Response) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, WWW-Authenticate");
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID");
      res.status(204).end();
      return;
    }

    const token = bearerToken(req.headers.authorization);
    const ip = req.ip ?? null;
    const actor = token ? await this.agents.authenticate(token, ip) : null;
    if (!actor) {
      res.setHeader(
        "WWW-Authenticate",
        wwwAuthenticate(token ? { code: "invalid_token", description: "The access token is invalid, expired or revoked" } : undefined),
      );
      res.status(401).json({ error: token ? "invalid_token" : "unauthorized", error_description: "Bearer token required. Connect via OAuth." });
      return;
    }

    let body: unknown;
    if (req.method === "POST") {
      try {
        body = await readJson(req);
      } catch (e) {
        return jsonRpcError(res, (e as Error).message === "too_large" ? 413 : 400, "Parse error: invalid JSON body", -32700);
      }
    }

    const sid = req.header("mcp-session-id");
    let live: LiveSession | undefined;
    if (sid) {
      live = this.sessions.get(sid);
      // A token of another grant must not ride on someone else's session.
      if (!live || live.grantId !== actor.grant.id) return jsonRpcError(res, 404, "Session not found. Start a new session with initialize.", -32001);
    } else {
      if (req.method !== "POST" || !(Array.isArray(body) ? body.some(isInitializeRequest) : isInitializeRequest(body))) {
        return jsonRpcError(res, 400, "Bad request: no valid Mcp-Session-Id. Send initialize first.");
      }
      live = await this.open(actor.grant.id);
    }

    live.lastSeen = Date.now();
    if (req.method === "POST" && live.lastSeen - live.lastTouched > TOUCH_MS) {
      live.lastTouched = live.lastSeen;
      await this.agents.touchSession(live.agentSessionId);
    }
    const sessionActor = { ...actor, sessionId: live.agentSessionId };
    Object.assign(req, { auth: { token: token!, clientId: actor.grant.id, scopes: ["mcp"], extra: { actor: sessionActor, ip } } });
    await live.transport.handleRequest(req, res, body);
  }

  private async open(grantId: string): Promise<LiveSession> {
    const agentSessionId = await this.agents.startSession(grantId);
    const server = new McpServer({ name: "mado", title: "Mado", version: config.version }, { instructions: SERVER_INSTRUCTIONS });
    registerTools(server, { router: this.router, agents: this.agents });
    const now = Date.now();
    const live: LiveSession = {
      server,
      grantId,
      agentSessionId,
      lastSeen: now,
      lastTouched: now,
      transport: new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          this.sessions.set(id, live);
        },
        onsessionclosed: (id) => {
          this.sessions.delete(id);
        },
      }),
    };
    live.transport.onclose = () => {
      if (live.transport.sessionId) this.sessions.delete(live.transport.sessionId);
    };
    await server.connect(live.transport);
    return live;
  }

  private sweep() {
    const cutoff = Date.now() - IDLE_MS;
    for (const [id, live] of this.sessions) {
      if (live.lastSeen < cutoff) {
        this.sessions.delete(id);
        void live.server.close().catch(() => {});
      }
    }
  }

  async onModuleDestroy() {
    clearInterval(this.sweeper);
    await Promise.all([...this.sessions.values()].map((s) => s.server.close().catch(() => {})));
    this.sessions.clear();
  }
}
