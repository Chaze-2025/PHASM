# Atmospheric fog preview deployment

The focused atmospheric fog refinement updates the existing isolated Midnight Séance preview. Production, the separate Phase 1 and Phase 1.1 previews, and database records remain unchanged.

| Item                               | Target                                                   |
| ---------------------------------- | -------------------------------------------------------- |
| Development branch                 | `dev/phasm-atmospheric-fog`                              |
| Worker                             | `phasm-phase-1-3-preview`                                |
| HTTPS preview                      | `https://phasm-phase-1-3-preview.wj7djnw2j2.workers.dev` |
| Configuration                      | `deploy/midnight-preview/wrangler.json`                  |
| Existing preview D1                | `phasm-phase-1-preview-db`                               |
| Preserved Midnight Séance baseline | `d3c7a21db5c7e8134b81c7603eef274a0adbcf73`               |

## Reproducible preparation

Run from the repository root after reviewing and committing the change:

```sh
node deploy/midnight-preview/validate-config.mjs
node deploy/midnight-preview/prepare.mjs
npx wrangler deploy --config deploy/midnight-preview/wrangler.json --dry-run
npx wrangler deploy --config deploy/midnight-preview/wrangler.json
```

Preparation requires the exact development branch, a clean working tree, and ancestry from the preserved Phase 1 (`9da8948`), Phase 1.1 (`cf915ba`), and Midnight Séance (`d3c7a21`) commits. It performs a fresh production build, adds preview-only indexing restrictions, and records source provenance in the ignored `deploy/midnight-preview/.generated/source.json`. The `--allow-dirty` option is for local dry-run checks only and must not be used for a real deployment.

Use the existing account's Wrangler authorization. If it expires, complete Wrangler's supported authentication flow; never add credentials to client code or tracked files. The previously confirmed Workers Free plan remains in use. No service purchase, plan upgrade, custom domain, production route, or additional binding is required.

## Preserved isolation

The Worker name, HTTPS origin, preview D1 binding, and read-only wrapper are unchanged. No remote database migration, seed import, or content write is needed. The wrapper denies administrative/development paths, rejects writes and public community submissions, and forwards only `DB`, `ASSETS`, and public `SITE_URL`. No administrative secret is configured. Preview responses request `noindex`, and `robots.txt` disallows crawling; the preview remains publicly reachable for evaluation. Account-wide free-tier quotas still apply.

## Verify the update

Record the final deployed Git commit, Cloudflare version ID, and returned HTTPS URL in the handoff. Compare the public catalog with the preserved preview, confirm homepage/map/profile routes, search and filters, and verify read-only endpoint restrictions. Inspect atmospheric effects on desktop and mobile viewports: foreground content must remain readable, controls must remain interactive, and reduced motion must be respected. Browser emulation does not establish physical iPhone/Safari behavior.

See [the deployment guide](../../deploy/midnight-preview/README.md) for full operational details. The live URL alone is not proof of a particular revision; deployment output and recorded source provenance identify the actual update.
