import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { users } from "@mado/db";
import { DbService } from "../db";
import type { Actor } from "../lib/actor";
import { isAllowedRedirectUri, redirectUriMatches, verifyPkce } from "../lib/agent-auth";
import { AccessService } from "./access.service";
import { AgentService } from "./agent.service";
import { OAuthError, OAuthService } from "./oauth.service";

const challengeFor = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

describe("PKCE", () => {
  // RFC 7636 Appendix B test vector.
  test("accepts the RFC 7636 example", () => {
    expect(verifyPkce("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
  });

  test("rejects a wrong verifier", () => {
    const verifier = randomBytes(32).toString("base64url");
    expect(verifyPkce(verifier, challengeFor(randomBytes(32).toString("base64url")))).toBe(false);
  });

  test("rejects verifiers outside 43..128 unreserved chars", () => {
    expect(verifyPkce("short", challengeFor("short"))).toBe(false);
    const bad = `${"a".repeat(42)}!`;
    expect(verifyPkce(bad, challengeFor(bad))).toBe(false);
  });

  test("rejects plain (challenge == verifier)", () => {
    const verifier = randomBytes(32).toString("base64url");
    expect(verifyPkce(verifier, verifier)).toBe(false);
  });
});

describe("redirect URIs", () => {
  test("https anywhere, http only on loopback", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:3334/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:9/cb")).toBe(true);
    expect(isAllowedRedirectUri("http://evil.example/cb")).toBe(false);
    expect(isAllowedRedirectUri("https://x.example/cb#frag")).toBe(false);
    expect(isAllowedRedirectUri("javascript:alert(1)")).toBe(false);
  });

  test("exact match, loopback port may vary", () => {
    expect(redirectUriMatches("https://a.example/cb", "https://a.example/cb")).toBe(true);
    expect(redirectUriMatches("https://a.example/cb", "https://a.example/cb2")).toBe(false);
    expect(redirectUriMatches("http://localhost:1000/callback", "http://localhost:2000/callback")).toBe(true);
    expect(redirectUriMatches("http://localhost:1000/callback", "http://localhost:2000/other")).toBe(false);
  });
});

describe("token endpoint (database)", () => {
  const dbs = new DbService();
  const access = new AccessService(dbs);
  // Revert needs the domain services; the token flow doesn't touch them.
  const agents = new AgentService(dbs, access, ...([{}, {}, {}, {}] as [never, never, never, never]));
  const oauth = new OAuthService(dbs, access, agents);
  let actor: Actor;
  let clientId: string;
  const redirect = "http://localhost:4999/callback";

  beforeAll(async () => {
    const [user] = await dbs.db
      .insert(users)
      .values({ email: `oauth-test-${randomBytes(4).toString("hex")}@mado.local`, name: "OAuth Test", passwordHash: "x" })
      .returning();
    actor = { type: "user", userId: user!.id, name: user!.name };
    clientId = (await oauth.register({ client_name: "test", redirect_uris: [redirect] })).client_id;
  });

  afterAll(() => dbs.onApplicationShutdown());

  async function authorizeAndApprove(verifier: string) {
    const result = await oauth.authorize({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirect,
      code_challenge: challengeFor(verifier),
      code_challenge_method: "S256",
      state: "s1",
    });
    if (!("consentUrl" in result)) throw new Error(JSON.stringify(result));
    const requestId = new URL(result.consentUrl, "http://x").searchParams.get("request")!;
    const { redirectTo } = await oauth.approve(actor, requestId, {
      agentName: "Test agent",
      projectScope: "all",
      allLevel: "read",
      projects: [],
      resourceTypes: ["docs", "tasks"],
      expiry: "30d",
    });
    const url = new URL(redirectTo);
    expect(url.searchParams.get("state")).toBe("s1");
    return url.searchParams.get("code")!;
  }

  const expectOAuthError = async (p: Promise<unknown>, error: string) => {
    const e = await p.then(() => null, (e: unknown) => e);
    expect(e).toBeInstanceOf(OAuthError);
    expect((e as OAuthError).error).toBe(error);
  };

  test("authorization code needs the right PKCE verifier and is single use", async () => {
    const verifier = randomBytes(32).toString("base64url");
    const code = await authorizeAndApprove(verifier);
    await expectOAuthError(
      oauth.token({ grant_type: "authorization_code", code, code_verifier: randomBytes(32).toString("base64url"), client_id: clientId, redirect_uri: redirect }),
      "invalid_grant",
    );
    // A failed attempt burns the code too.
    await expectOAuthError(oauth.token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: redirect }), "invalid_grant");

    const code2 = await authorizeAndApprove(verifier);
    const tokens = await oauth.token({ grant_type: "authorization_code", code: code2, code_verifier: verifier, client_id: clientId, redirect_uri: redirect });
    expect(tokens.expires_in).toBe(900);
    expect(await agents.authenticate(tokens.access_token, null)).not.toBeNull();
    await expectOAuthError(oauth.token({ grant_type: "authorization_code", code: code2, code_verifier: verifier, client_id: clientId, redirect_uri: redirect }), "invalid_grant");
    // Replaying a used code revokes what it issued.
    expect(await agents.authenticate(tokens.access_token, null)).toBeNull();
  });

  test("refresh tokens rotate, and reuse revokes the whole grant's tokens", async () => {
    const verifier = randomBytes(32).toString("base64url");
    const code = await authorizeAndApprove(verifier);
    const first = await oauth.token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: redirect });

    const second = await oauth.token({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: clientId });
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(await agents.authenticate(second.access_token, null)).not.toBeNull();

    await expectOAuthError(oauth.token({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: clientId }), "invalid_grant");
    expect(await agents.authenticate(second.access_token, null)).toBeNull();
    await expectOAuthError(oauth.token({ grant_type: "refresh_token", refresh_token: second.refresh_token, client_id: clientId }), "invalid_grant");
  });

  test("refresh is bound to the client", async () => {
    const verifier = randomBytes(32).toString("base64url");
    const code = await authorizeAndApprove(verifier);
    const t = await oauth.token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: redirect });
    await expectOAuthError(oauth.token({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: "mcp_other" }), "invalid_grant");
  });
});
