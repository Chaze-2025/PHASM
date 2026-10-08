# PHASM Phase 1.3 — Midnight Séance

[Open the Cloudflare preview](https://phasm-phase-1-3-preview.wj7djnw2j2.workers.dev) · [Haunted Atlas](https://phasm-phase-1-3-preview.wj7djnw2j2.workers.dev/map) · [Stanley Hotel dossier](https://phasm-phase-1-3-preview.wj7djnw2j2.workers.dev/locations/stanley-hotel)

Development branch: **`dev/phasm-phase-1-3`**, based on Phase 1.1 `cf915ba2c39856346ceb087e374f2f371cc327ca`. Original Phase 1 commit `9da89485891f07d584a426d487f707af6ef06f46` remains in its history. No merge to main or production deployment is part of this phase.

## What changed

- A shared Midnight Séance token system replaces the dominant green and warm accents with midnight black, storm blue, mist silver and ghost ivory. Brass is reserved for sparse historical and brand details.
- The corridor hero, spectral search controls, photographic cards, archival feature, compact recent-record rows and region links establish a stronger haunted-place identity. Case files and trails remain explicitly planned.
- Genuine nineteenth-century spirit photography from Getty's CC0 collection has visible attribution, provenance and an explanation of the staged photographic effects. No archival sitter or illusion is connected to a PHASM location. The Stanley excerpt uses real Stanley photography and its existing attributed folklore.
- The atlas has cold cartography, brighter geographic labels, silver markers, distinct selection rings, consistent filters and compact mobile previews. Its real geography, search, clusters, list view and data loading remain intact.
- Location dossiers have framed contemporary photography, restrained registration ornament, a history/report reading key, clearly qualified haunting narratives, comfortable source lists, and official visiting controls.

## Review evidence

- [Before-and-after desktop and mobile screenshots](screenshots.md)
- [Design system and presentation rules](DESIGN-SYSTEM.md)
- [Historical image provenance and licensing](IMAGE-PROVENANCE.md)
- [Test results and reproducible commands](TEST-RESULTS.md)
- [Cloudflare preview isolation and deployment](PREVIEW.md)

Screenshots compare the unchanged Phase 1.1 preview with the Phase 1.3 implementation at the same viewport sizes. Browser and touch simulation are Chromium-based; no physical iPhone or Safari testing is claimed.

## Preserved scope and remaining limits

The ten location records, original image-credit records, database migrations, backend, shared types, editorial editor and original Cloudflare configurations are unchanged. Search remains a search of the sourced catalog. Existing local saved-place behavior is preserved; accounts and synchronized collections are not active. Public reviews, uploads and submissions remain disabled. No fabricated location content or testimony was added.

This is a visual evaluation preview. Five existing locations still have labelled image placeholders. The Getty archive photograph is a cultural-history feature, not new evidence about a haunted location. Source research did not identify a cleared free historical Stanley photograph suitable for this release, so its licensed contemporary photograph remains in use.

The new Worker is separate from production and earlier preview Workers, and uses the existing preview D1 database through a read-only application wrapper. It denies administrative and development routes, receives no administrative secret, disables indexing, and enables no paid service. Workers Free and D1 quotas and the external map provider's availability still apply; see [service limits](../SERVICES.md).

Evaluate the live preview on a real iPhone next, especially map gestures, selected-location previews, navigation and long-form reading. Further content population, community features and production readiness remain separate phases.
