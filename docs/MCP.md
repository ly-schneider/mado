# MCP and agent access

Mado serves an MCP server (Streamable HTTP) at `<publicUrl>/mcp`. Agents sign in with OAuth 2.1 (Dynamic Client Registration + PKCE); you pick projects, levels, resource types and expiry on the consent screen. Manage or revoke agents later in Settings › Connected agents.

## Connect Claude Code

```sh
claude mcp add --transport http mado <publicUrl>/mcp
```

Then run `/mcp` in Claude Code and pick `mado` to sign in. Your browser opens the Mado consent screen.

For local development: `claude mcp add --transport http mado http://localhost:4100/mcp`.

## Connect the Claude app

Settings › Connectors › Add custom connector, URL `<publicUrl>/mcp`.

## Clients without OAuth

Create a personal access token in Settings › Connected agents (same picker as the consent screen). It is shown once and starts with `mado_pat_`. Send it as `Authorization: Bearer mado_pat_…`:

```sh
claude mcp add --transport http mado <publicUrl>/mcp --header "Authorization: Bearer mado_pat_…"
```

## Endpoints

| Path | Purpose |
| --- | --- |
| `/.well-known/oauth-protected-resource` | Resource metadata (RFC 9728), linked from the 401 `WWW-Authenticate` header |
| `/.well-known/oauth-authorization-server` | Authorization server metadata (RFC 8414) |
| `/oauth/register` | Dynamic Client Registration (RFC 7591), public clients only |
| `/oauth/authorize` | Authorization code + PKCE (S256 only), forwards to `/oauth/consent` |
| `/oauth/token` | `authorization_code` and `refresh_token`. Access tokens last 15 min; refresh tokens rotate on every use and live 30 days, never longer than the grant |
| `/oauth/revoke` | Token revocation (RFC 7009). Revoking a refresh token ends all tokens of that grant |

## Rules

- Tokens carry only the grant id. Every MCP call re-reads the grant, so edits apply on the agent's next call and revoking cuts it off at once.
- A grant never exceeds the user's own rights. Purge is not grantable; deletes via MCP are soft (Trash, 30 days).
- Missing privileges come back as a tool error starting with `insufficient_scope` that names the level, resource type and project needed.
- Reusing a rotated refresh token is treated as theft: every token of the grant is revoked and the agent has to reconnect.
- Each MCP session is one agent session (short id like `7f3a`). All its writes can be reverted in one click under Connected agents.

## Tools

`whoami`, `list_projects`, `search`, `get_task`, `list_tasks`, `create_task`, `update_task`, `delete_task`, `comment_task`, `get_doc`, `list_docs`, `create_doc`, `update_doc`, `delete_doc`, `list_leads`, `get_lead`, `create_lead`, `update_lead`. Wiki pages are also readable as resources: `mado://doc/<id>`.
