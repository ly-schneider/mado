# Releasing the desktop app

The Release workflow builds a universal macOS app and publishes it with each approved release. It signs the app with a Developer ID certificate, has Apple notarize it, and attaches a signed updater archive plus `latest.json`. Installed apps check `releases/latest/download/latest.json` on launch and every 6 hours, install updates in the background and offer a restart. **Check for Updates…** in the app menu does the same on demand.

The workflow stops before building if one of these repository secrets is missing.

## Secrets

| Secret | What |
| --- | --- |
| `APPLE_CERTIFICATE` | The *Developer ID Application* certificate with its private key, as a base64 `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | The password chosen when exporting the `.p12` |
| `APPLE_API_KEY` | App Store Connect API key ID, for notarization |
| `APPLE_API_ISSUER` | App Store Connect issuer ID |
| `APPLE_API_KEY_P8` | Contents of the key's `AuthKey_<id>.p8` file |
| `TAURI_SIGNING_PRIVATE_KEY` | Updater private key: contents of `~/.tauri/mado_updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Its password: `~/.tauri/mado_updater_password.txt` |

### Developer ID certificate

1. Keychain Access › My Certificates › *Developer ID Application: …* › Export as `mado.p12` with a password.
2. `base64 -i mado.p12 | gh secret set APPLE_CERTIFICATE` and `gh secret set APPLE_CERTIFICATE_PASSWORD`.
3. Delete `mado.p12`.

### Notarization key

1. App Store Connect › Users and Access › Integrations › Team Keys › add a key with the *Developer* role.
2. `gh secret set APPLE_API_KEY` (Key ID), `gh secret set APPLE_API_ISSUER` (Issuer ID above the table).
3. Download the key (only possible once): `gh secret set APPLE_API_KEY_P8 < AuthKey_<id>.p8`.

### Updater key

```sh
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/mado_updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD < ~/.tauri/mado_updater_password.txt
```

Back up both files in a password manager. Installed apps only accept updates signed with this key (its public half is in `tauri.conf.json`), so losing it means every user has to download the next version by hand.

## Local builds

`bun run desktop:build` doesn't create updater artifacts, so it needs none of the above. Set `APPLE_SIGNING_IDENTITY` to sign with a certificate from your keychain.
