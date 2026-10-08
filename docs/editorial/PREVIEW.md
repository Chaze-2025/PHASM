# Editorial voice preview operations

This revision updates the existing isolated Cloudflare preview and gives it a separate D1 database. The database separation prevents editorial copy changes from altering the older previews that share the original data.

| Item                         | Value                                                               |
| ---------------------------- | ------------------------------------------------------------------- |
| Branch                       | `dev/phasm-editorial-voice`                                         |
| Worker                       | `phasm-phase-1-3-preview`                                           |
| HTTPS origin                 | `https://phasm-phase-1-3-preview.wj7djnw2j2.workers.dev`            |
| Configuration                | `deploy/midnight-preview/wrangler.json`                             |
| Editorial database           | `phasm-editorial-preview-db`                                        |
| Editorial database UUID      | `fe55176f-43e7-4b79-82c2-02884e4161a0`                              |
| Original database, preserved | `phasm-phase-1-preview-db` / `30400e9a-8eb0-4605-a3a4-0db6470301d1` |
| Preserved fog baseline       | `8ffeb28e4e36a4fb2169f1fbcbf1d23b2c75e839`                          |

## Free-tier preflight

On 2026-10-08, current Wrangler authorization was verified against the existing configured account. Before the clone there were three D1 databases using approximately 0.67 MB combined; PHASM's original preview was 299 KB. Creating this clone brought the count to four. The owner had already confirmed the Workers Free plan. No billing changes, paid products, or additional service bindings were enabled.

Current official [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) allow 10 databases per Free account, 500 MB per database, and 5 GB total storage. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) includes 5 million rows read and 100,000 rows written daily on Free; usage beyond the free allowance produces query errors rather than an authorized paid upgrade. The clone import used 290 row writes and approximately 299 KB, within these limits. Account-wide usage from other applications still shares the allowance.

## Clone and preservation

The original database was read only. Cloudflare's full export rejected its FTS5 virtual table, so ordinary tables were exported explicitly and the exact schema definitions were read from `sqlite_master`. The clone restored all 19 ordinary tables and their row IDs, including 10 locations, 32 source relationships, 11 phenomenon relationships, 10 editorial audit entries, and two migration records. Community tables remained empty.

Eight indexes and three FTS maintenance triggers were preserved, together with the original FTS5 definition. Only the derived full-text index was rebuilt in the new database. The clone was checked for ordinary-table equality, schema parity, migration sequence preservation, foreign-key integrity, and FTS search parity. Operational SQL exports and internal records remain outside the repository in private workspace scratch storage; they are not website assets.

Editorial changes are applied using reviewed guarded SQL, not a seed import or record replacement. Approved differences are public summary/history/reports text and individually reviewed source URL repairs. Source relationship IDs, unrelated fields, coordinates, taxonomy, timestamps, audit history, and internal metadata must remain intact. The applied reviewed revision contained 64 guarded SQL statements: 10 location JSON updates, two source URL repairs that preserved source row IDs, and 10 appended `copy-refined:editorial-voice` audit entries. It used 44 row writes in the isolated clone. Existing audit entries and all other table values remain intact. The original database must retain its pre-change fingerprint after both editing and deployment.

## Deployment and verification

The preparation script requires `dev/phasm-editorial-voice`, a clean working tree, and ancestry from the preserved Phase 1, Phase 1.1, Midnight Séance, and fog commits. Run the [explicit preview workflow](../../deploy/midnight-preview/README.md); never deploy the default production configuration.

The Worker name and public HTTPS URL remain unchanged. The wrapper still denies admin/development endpoints and all public writes, including community submissions. It forwards only `DB`, `ASSETS`, and public `SITE_URL`; no administrative secret is configured. Preview indexing is disabled, though the URL remains publicly reachable for evaluation.

The handoff records the deployed source commit, Cloudflare version ID, content and source-link validation, preserved original catalog, neutral map rendering, and live interaction checks. The ignored `.generated/source.json` records the exact clean source used for each build. Browser mobile emulation does not claim physical iPhone/Safari testing.
