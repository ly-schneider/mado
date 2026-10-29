# Cloudflare Tunnel and Access

mado has no open ports. `cloudflared` runs on the VM (not in compose) and forwards to the API on `127.0.0.1:4100`. Cloudflare Access puts an email-code login in front of the UI. Paths that have their own auth bypass Access.

## Tunnel

```sh
cloudflared tunnel login
cloudflared tunnel create mado
cloudflared tunnel route dns mado mado.example.ch
```

`/etc/cloudflared/config.yml`:

```yaml
tunnel: mado
credentials-file: /etc/cloudflared/<tunnel-id>.json
ingress:
  - hostname: mado.example.ch
    service: http://127.0.0.1:4100
    originRequest:
      # MCP uses streamable HTTP; keep long responses open.
      keepAliveTimeout: 90s
  - service: http_status:404
```

```sh
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

Set `PUBLIC_URL=https://mado.example.ch` in `ops/.env`. The API trusts `X-Forwarded-*` from loopback only, which is where cloudflared connects from.

## Access

Zero Trust › Access › Applications. Create two self-hosted applications on the same hostname. Access matches the most specific path, so the bypass app wins for its paths.

**1. mado (UI)**: `mado.example.ch`, no path.

- Policy "People": Action *Allow*, Include *Emails* (you and your team) or *Emails ending in*. Login method: *One-time PIN*.
- Session duration 1 month. That is only the Access session; the app login is separate.
- Leave CORS settings off. The desktop app calls the API cross-origin with credentials and needs the API's own CORS headers to pass through.

**2. mado (bypass)**: same hostname with these paths, one entry each:

| Path | Own auth |
| --- | --- |
| `mcp` | OAuth 2.1 bearer tokens (agents can't do the email PIN) |
| `oauth/*` | OAuth endpoints; `/oauth/consent` is an SPA page and still requires the app login |
| `.well-known/*` | OAuth discovery metadata, must be public |
| `webhooks/*` | GitHub HMAC signature / GitLab token per repo |
| `s/*` | Guest share links (share token) |
| `rpc/guest/*` | API calls made from share links |
| `assets/*`, `manifest.webmanifest`, `sw.js`, `favicon*`, `icon-*`, `apple-touch-icon.png` | Static, needed so share links and the PWA load |

- Policy "Public": Action *Bypass*, Include *Everyone*.

## Desktop app and Access

The desktop app loads the SPA from `tauri://localhost` and calls `https://mado.example.ch/rpc` directly, where Access would answer with its login page. Pick one:

- Add a service token for the desktop app: Access › Service Auth › create token, add a *Service Auth* policy to the UI app. (Requires sending `CF-Access-Client-Id`/`-Secret` headers; not wired in the app yet.)
- Or bypass `rpc/*` for everyone and rely on the app login. The API requires a session on every procedure except login, setup status and guest calls, so this keeps the same protection the app already has. Recommended for v1.

## Checks

```sh
curl -sI https://mado.example.ch/ | grep -i cf-access     # UI: redirected to Access
curl -s https://mado.example.ch/.well-known/oauth-protected-resource   # JSON, no Access
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://mado.example.ch/webhooks/github   # 400, not 302
```
