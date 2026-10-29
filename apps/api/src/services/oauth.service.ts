import type { ConsentRequest, GrantInput } from "@mado/contract";
import { agentGrants, agentTokens, oauthClients, oauthCodes, type Tx, users } from "@mado/db";
import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { DbService } from "../db";
import type { Actor } from "../lib/actor";
import { isAllowedRedirectUri, isOurResource, MCP_RESOURCE, redirectUriMatches, verifyPkce } from "../lib/agent-auth";
import { randomToken, sha256 } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { AccessService } from "./access.service";
import { AgentService } from "./agent.service";

const REQUEST_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 5 * 60_000;
export const ACCESS_TTL_S = 15 * 60;
const REFRESH_TTL_MS = 30 * 86_400_000;

/** RFC 6749 §5.2 error response for the token, registration and revocation endpoints. */
export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}

interface PendingRequest {
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  resource: string;
  expiresAt: number;
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

type Params = Record<string, string | undefined>;

/** OAuth 2.1 authorization server for MCP clients: DCR, authorize + consent, token, revoke. */
@Injectable()
export class OAuthService {
  /** Consent requests live only between /oauth/authorize and approve/deny, so memory is enough. */
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    private readonly dbs: DbService,
    private readonly access: AccessService,
    private readonly agents: AgentService,
  ) {}

  // ── Dynamic Client Registration (RFC 7591) ──────────────────────────

  async register(body: Record<string, unknown>) {
    const redirectUris = body.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > 10) {
      throw new OAuthError("invalid_redirect_uri", "redirect_uris must be a non-empty array");
    }
    for (const uri of redirectUris) {
      if (typeof uri !== "string" || !isAllowedRedirectUri(uri)) {
        throw new OAuthError("invalid_redirect_uri", `Redirect URI not allowed: ${String(uri)}. Use https, or http on localhost.`);
      }
    }
    const grantTypes = Array.isArray(body.grant_types) ? (body.grant_types as string[]) : ["authorization_code", "refresh_token"];
    if (grantTypes.some((g) => g !== "authorization_code" && g !== "refresh_token")) {
      throw new OAuthError("invalid_client_metadata", "Only authorization_code and refresh_token are supported");
    }
    const responseTypes = Array.isArray(body.response_types) ? (body.response_types as string[]) : ["code"];
    if (responseTypes.some((r) => r !== "code")) throw new OAuthError("invalid_client_metadata", "Only response_type code is supported");

    const fallbackName = new URL(redirectUris[0] as string).hostname;
    const name = (typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim() : fallbackName).slice(0, 80);
    const clientId = randomToken(16, "mcp_");
    const [client] = await this.dbs.db
      .insert(oauthClients)
      .values({ clientId, name, redirectUris: redirectUris as string[], verified: false })
      .returning();
    return {
      client_id: clientId,
      client_id_issued_at: Math.floor(client!.createdAt.getTime() / 1000),
      client_name: name,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "mcp",
    };
  }

  private async client(clientId: string | undefined) {
    if (!clientId) return null;
    const [client] = await this.dbs.db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId));
    return client ?? null;
  }

  // ── Authorize ───────────────────────────────────────────────────────

  /**
   * Validates the request and parks it for the consent screen. Errors about the client or redirect
   * URI must not redirect (the redirect target is untrusted); everything else goes back to the client.
   */
  async authorize(q: Params): Promise<{ consentUrl: string } | { redirect: string } | { fatal: string }> {
    const client = await this.client(q.client_id);
    if (!client) return { fatal: "Unknown client_id. The client has to register first." };
    const redirectUri = q.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
    if (!redirectUri || !client.redirectUris.some((r) => redirectUriMatches(r, redirectUri))) {
      return { fatal: "redirect_uri does not match a registered redirect URI." };
    }
    const back = (error: string, description: string) => ({ redirect: withParams(redirectUri, { error, error_description: description, state: q.state }) });

    if (q.response_type !== "code") return back("unsupported_response_type", "Only response_type=code is supported");
    if (!q.code_challenge) return back("invalid_request", "PKCE code_challenge is required");
    if (q.code_challenge_method !== "S256") return back("invalid_request", "code_challenge_method must be S256");
    if (!/^[A-Za-z0-9\-_]{43}$/.test(q.code_challenge)) return back("invalid_request", "Malformed code_challenge");
    if (!isOurResource(q.resource)) return back("invalid_target", `Unknown resource. Use ${MCP_RESOURCE}`);
    if (q.scope && !q.scope.split(" ").every((s) => s === "mcp" || s === "")) return back("invalid_scope", "Only the mcp scope exists");

    this.sweep();
    const id = randomToken(18);
    this.pending.set(id, {
      clientId: client.clientId,
      redirectUri,
      state: q.state ?? null,
      codeChallenge: q.code_challenge,
      resource: MCP_RESOURCE,
      expiresAt: Date.now() + REQUEST_TTL_MS,
    });
    return { consentUrl: `/oauth/consent?request=${encodeURIComponent(id)}` };
  }

  private sweep() {
    const now = Date.now();
    for (const [id, r] of this.pending) if (r.expiresAt < now) this.pending.delete(id);
  }

  private request(requestId: string) {
    const req = this.pending.get(requestId);
    if (!req || req.expiresAt < Date.now()) {
      this.pending.delete(requestId);
      throw new AppError("NOT_FOUND", "This sign-in request expired. Start the connection again from your agent.");
    }
    return req;
  }

  async consent(actor: Actor, requestId: string): Promise<ConsentRequest> {
    const user = this.access.requireUser(actor);
    const req = this.request(requestId);
    const client = (await this.client(req.clientId))!;
    const [u] = await this.dbs.db.select({ name: users.name }).from(users).where(eq(users.id, user.userId));
    const projects = await this.agents.userProjects(user.userId);
    return {
      requestId,
      client: {
        id: client.clientId,
        name: client.name,
        verified: client.verified,
        redirectUri: req.redirectUri,
        registeredAt: client.createdAt.toISOString(),
      },
      user: { name: u?.name ?? user.name, role: projects.some((p) => p.role === "owner") ? "owner" : "member" },
      projects: projects.map((p) => ({
        id: p.id,
        workspaceId: p.workspaceId,
        workspaceName: p.workspaceName,
        key: p.key,
        name: p.name,
        description: p.description,
        openTaskCount: 0,
        nextNumber: 0,
      })),
    };
  }

  async approve(actor: Actor, requestId: string, input: GrantInput) {
    const user = this.access.requireUser(actor);
    const req = this.request(requestId);
    const client = (await this.client(req.clientId))!;
    const code = randomToken(32);
    await this.dbs.db.transaction(async (tx) => {
      const grant = await this.agents.createGrant(tx, user.userId, input, { kind: "oauth", clientId: client.clientId, clientName: client.name });
      await tx.insert(oauthCodes).values({
        codeHash: sha256(code),
        grantId: grant.id,
        clientId: client.clientId,
        redirectUri: req.redirectUri,
        codeChallenge: req.codeChallenge,
        resource: req.resource,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      });
    });
    this.pending.delete(requestId);
    return { redirectTo: withParams(req.redirectUri, { code, state: req.state ?? undefined }) };
  }

  async deny(actor: Actor, requestId: string) {
    this.access.requireUser(actor);
    const req = this.request(requestId);
    this.pending.delete(requestId);
    return {
      redirectTo: withParams(req.redirectUri, { error: "access_denied", error_description: "The user denied access", state: req.state ?? undefined }),
    };
  }

  // ── Token ───────────────────────────────────────────────────────────

  async token(p: Params): Promise<TokenResponse> {
    if (p.grant_type === "authorization_code") return this.exchangeCode(p);
    if (p.grant_type === "refresh_token") return this.refresh(p);
    throw new OAuthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
  }

  private async exchangeCode(p: Params): Promise<TokenResponse> {
    if (!p.code || !p.code_verifier || !p.client_id) throw new OAuthError("invalid_request", "code, code_verifier and client_id are required");
    if (!isOurResource(p.resource)) throw new OAuthError("invalid_target", `Unknown resource. Use ${MCP_RESOURCE}`);
    const result = await this.dbs.db.transaction(async (tx) => {
      const [code] = await tx.select().from(oauthCodes).where(eq(oauthCodes.codeHash, sha256(p.code!))).for("update");
      if (!code) return new OAuthError("invalid_grant", "Unknown authorization code");
      if (code.usedAt) {
        // Replay of a used code: assume it leaked and kill everything issued from it.
        await this.agents.revokeTokens(tx, code.grantId);
        return new OAuthError("invalid_grant", "Authorization code was already used");
      }
      // Burned on the first attempt, successful or not, so a verifier can't be guessed repeatedly.
      await tx.update(oauthCodes).set({ usedAt: new Date() }).where(eq(oauthCodes.codeHash, code.codeHash));
      if (code.expiresAt < new Date()) return new OAuthError("invalid_grant", "Authorization code expired");
      if (code.clientId !== p.client_id) return new OAuthError("invalid_grant", "Code was issued to another client");
      if (p.redirect_uri !== undefined && p.redirect_uri !== code.redirectUri) {
        return new OAuthError("invalid_grant", "redirect_uri does not match the authorization request");
      }
      if (!verifyPkce(p.code_verifier!, code.codeChallenge)) return new OAuthError("invalid_grant", "PKCE verification failed");
      const [grant] = await tx.select().from(agentGrants).where(eq(agentGrants.id, code.grantId));
      if (!grant || grant.revokedAt) return new OAuthError("invalid_grant", "Grant was revoked");
      return this.issue(tx, grant);
    });
    // Burning the code and revoking on replay must commit, so errors are thrown after the transaction.
    if (result instanceof OAuthError) throw result;
    return result;
  }

  /**
   * Refresh tokens rotate on every use. Presenting an already rotated (revoked) refresh token means
   * two parties hold it, so every token of the grant dies and the user has to reconnect.
   */
  private async refresh(p: Params): Promise<TokenResponse> {
    if (!p.refresh_token || !p.client_id) throw new OAuthError("invalid_request", "refresh_token and client_id are required");
    if (!isOurResource(p.resource)) throw new OAuthError("invalid_target", `Unknown resource. Use ${MCP_RESOURCE}`);
    const result = await this.dbs.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ token: agentTokens, grant: agentGrants })
        .from(agentTokens)
        .innerJoin(agentGrants, eq(agentGrants.id, agentTokens.grantId))
        .where(and(eq(agentTokens.tokenHash, sha256(p.refresh_token!)), eq(agentTokens.type, "refresh")))
        .for("update");
      if (!row) return new OAuthError("invalid_grant", "Unknown refresh token");
      if (row.grant.clientId !== p.client_id) return new OAuthError("invalid_grant", "Refresh token was issued to another client");
      if (row.token.revokedAt) {
        await this.agents.revokeTokens(tx, row.grant.id);
        return new OAuthError("invalid_grant", "Refresh token was already used. All tokens of this grant were revoked; reconnect the agent.");
      }
      const now = new Date();
      if (row.token.expiresAt && row.token.expiresAt <= now) return new OAuthError("invalid_grant", "Refresh token expired");
      if (row.grant.revokedAt) return new OAuthError("invalid_grant", "Grant was revoked");
      if (row.grant.expiresAt && row.grant.expiresAt <= now) return new OAuthError("invalid_grant", "Grant expired");
      await tx.update(agentTokens).set({ revokedAt: now }).where(eq(agentTokens.id, row.token.id));
      return this.issue(tx, row.grant);
    });
    // Theft detection must commit, so errors are thrown after the transaction.
    if (result instanceof OAuthError) throw result;
    return result;
  }

  private async issue(tx: Tx, grant: typeof agentGrants.$inferSelect): Promise<TokenResponse> {
    const now = Date.now();
    const access = randomToken(32, "mado_at_");
    const refresh = randomToken(32, "mado_rt_");
    let refreshExpires = new Date(now + REFRESH_TTL_MS);
    if (grant.expiresAt && grant.expiresAt < refreshExpires) refreshExpires = grant.expiresAt;
    let accessExpires = new Date(now + ACCESS_TTL_S * 1000);
    if (grant.expiresAt && grant.expiresAt < accessExpires) accessExpires = grant.expiresAt;
    await tx.insert(agentTokens).values([
      { grantId: grant.id, type: "access", tokenHash: sha256(access), expiresAt: accessExpires },
      { grantId: grant.id, type: "refresh", tokenHash: sha256(refresh), expiresAt: refreshExpires },
    ]);
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: Math.max(1, Math.floor((accessExpires.getTime() - now) / 1000)),
      refresh_token: refresh,
      scope: "mcp",
    };
  }

  // ── Revoke (RFC 7009) ───────────────────────────────────────────────

  /** Unknown tokens are not an error (RFC 7009 §2.2). Revoking a refresh token ends the whole grant's session. */
  async revoke(p: Params) {
    if (!p.token) throw new OAuthError("invalid_request", "token is required");
    const [row] = await this.dbs.db
      .select({ token: agentTokens, clientId: agentGrants.clientId })
      .from(agentTokens)
      .innerJoin(agentGrants, eq(agentGrants.id, agentTokens.grantId))
      .where(eq(agentTokens.tokenHash, sha256(p.token)));
    if (!row || row.token.type === "pat") return;
    if (p.client_id && row.clientId !== p.client_id) return;
    if (row.token.type === "refresh") {
      await this.dbs.db.transaction((tx) => this.agents.revokeTokens(tx, row.token.grantId));
    } else {
      await this.dbs.db.update(agentTokens).set({ revokedAt: new Date() }).where(and(eq(agentTokens.id, row.token.id), isNull(agentTokens.revokedAt)));
    }
  }
}

export function withParams(uri: string, params: Record<string, string | undefined>) {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  return url.toString();
}
