import { Controller, Get, Options, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { config } from "../config";
import { MCP_RESOURCE } from "../lib/agent-auth";
import { OAuthError, OAuthService } from "../services/oauth.service";

const MAX_BODY = 64 * 1024;

/** Global body parsing is off (main.ts), so the OAuth endpoints read their own small bodies. */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new OAuthError("invalid_request", "Request body too large");
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  const type = req.headers["content-type"] ?? "";
  if (type.includes("application/json")) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      throw new OAuthError("invalid_request", "Body is not valid JSON");
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

const strings = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "string")) as Record<string, string>;

/** MCP clients in browsers (MCP Inspector, web apps) call discovery, registration and token cross-origin. */
function cors(res: Response) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, MCP-Protocol-Version");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function sendError(res: Response, e: unknown) {
  if (e instanceof OAuthError) {
    res.status(e.status).setHeader("Cache-Control", "no-store").json({ error: e.error, error_description: e.description });
    return;
  }
  console.error(e);
  res.status(500).json({ error: "server_error", error_description: "Internal error" });
}

@Controller()
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  @Options([
    ".well-known/oauth-protected-resource",
    ".well-known/oauth-protected-resource/*path",
    ".well-known/oauth-authorization-server",
    ".well-known/oauth-authorization-server/*path",
    ".well-known/openid-configuration",
    "oauth/register",
    "oauth/token",
    "oauth/revoke",
  ])
  preflight(@Res() res: Response) {
    cors(res);
    res.status(204).end();
  }

  /** RFC 9728. Clients find this through the WWW-Authenticate header of a 401 from /mcp. */
  @Get([".well-known/oauth-protected-resource", ".well-known/oauth-protected-resource/*path"])
  protectedResource(@Res() res: Response) {
    cors(res);
    res.json({
      resource: MCP_RESOURCE,
      authorization_servers: [config.publicUrl],
      scopes_supported: ["mcp"],
      bearer_methods_supported: ["header"],
      resource_name: "Mado",
    });
  }

  /** RFC 8414. The OIDC alias is served too because some clients only probe that path. */
  @Get([".well-known/oauth-authorization-server", ".well-known/oauth-authorization-server/*path", ".well-known/openid-configuration"])
  authorizationServer(@Res() res: Response) {
    cors(res);
    const url = config.publicUrl;
    res.json({
      issuer: url,
      authorization_endpoint: `${url}/oauth/authorize`,
      token_endpoint: `${url}/oauth/token`,
      registration_endpoint: `${url}/oauth/register`,
      revocation_endpoint: `${url}/oauth/revoke`,
      scopes_supported: ["mcp"],
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      client_id_metadata_document_supported: false,
    });
  }

  @Post("oauth/register")
  async register(@Req() req: Request, @Res() res: Response) {
    cors(res);
    try {
      const client = await this.oauth.register(await readBody(req));
      res.status(201).setHeader("Cache-Control", "no-store").json(client);
    } catch (e) {
      sendError(res, e);
    }
  }

  @Get("oauth/authorize")
  async authorize(@Req() req: Request, @Res() res: Response) {
    const query = strings(req.query as Record<string, unknown>);
    const result = await this.oauth.authorize(query);
    if ("fatal" in result) {
      res.status(400).type("text/plain").send(`Mado could not start this sign-in: ${result.fatal}`);
      return;
    }
    res.redirect(302, "redirect" in result ? result.redirect : config.publicUrl + result.consentUrl);
  }

  @Post("oauth/token")
  async token(@Req() req: Request, @Res() res: Response) {
    cors(res);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    try {
      const params = strings(await readBody(req));
      // Public clients may still send HTTP Basic with an empty secret; take the client_id from it.
      const basic = req.headers.authorization?.match(/^Basic\s+(.+)$/i)?.[1];
      if (basic && !params.client_id) params.client_id = decodeURIComponent(Buffer.from(basic, "base64").toString("utf8").split(":")[0] ?? "");
      res.status(200).json(await this.oauth.token(params));
    } catch (e) {
      sendError(res, e);
    }
  }

  @Post("oauth/revoke")
  async revoke(@Req() req: Request, @Res() res: Response) {
    cors(res);
    try {
      await this.oauth.revoke(strings(await readBody(req)));
      res.status(200).end();
    } catch (e) {
      sendError(res, e);
    }
  }
}
