# Paranormal storytelling and charcoal cartography

This revision refines the public voice across the homepage, atlas, cards, profiles, phenomena index, About page, saved-place messages, planned features, metadata, and server-rendered profile content. It works from the preserved `8ffeb28` fog revision on `dev/phasm-editorial-voice`.

The atlas returns to neutral charcoal land (`#0C0C0C`), dark gray water (`#1B1B1D`), and silver labels (`#ADADAD`). Brass markers and ivory selected states remain distinct. The homepage map thumbnail is a fresh capture of the real map with its provider attribution. The site's green-and-brass palette, unfiltered photography, and homepage-only mist remain intact.

## The voice

Write for people drawn to ghosts, hauntings, folklore, and the unexplained. Invite them into a place through its stories and history. Use concrete details, comfortable language, and natural attribution: the hotel's ghost lore, a visitor's account, or a local tradition. Do not interrupt each story with a verdict about supernatural proof.

Keep historical facts in their own narrative context and tell folklore as folklore. Preserve specific distinctions when they matter: Dracula is a fictional character; Pendle's witchcraft accusations concern real people; staged Victorian spirit photographs are historical photographic constructions. Never invent a witness, quotation, event, image, or review to enrich the atmosphere.

Profiles now follow **The Story → The Hauntings → The History**, with photographs, **Visitor Experiences**, sources, and **Plan Your Visit**. Sources stay available without dominating the narrative. Community wording is welcoming, while making clear that submissions are not open yet. Practical access restrictions, unknown tour availability, privacy protections, and internal editorial verification remain in place.

All ten existing profiles were revised against their cited material. Two broken official source URLs were repaired without removing source records. See the [source review](SOURCE-REVIEW.md) for per-location findings, the old and new URLs, and access limitations encountered during research.

## Database preservation

The revised preview has a separate D1 database cloned from the existing preview. The original shared database and previous Phase 1/1.1 previews retain their prior content. The content update changes only `summary`, `history`, `reports`, and the two reviewed source URLs. It preserves location IDs, coordinates, taxonomy, publication/access status, images, dates, source row IDs, existing audit history, and all other relationships. Ten audit entries record the copy revision.

`scripts/editorial-revision.ts` generates SQL only; it has no database connection or deployment capability. It validates the fixed baseline and revised records, rejects broader changes, checks all expected database content before any write, and is safe to reapply. Source URL repairs update existing source rows in place. Database tests cover preservation, search, idempotence, and refusal to overwrite independent editorial changes.

For a fresh checkout, `npm run setup` seeds the revised catalog. For an existing local database that still exactly matches the preserved baseline:

```sh
npx tsx scripts/editorial-revision.ts /tmp/phasm-editorial-review.sql
# Review the generated SQL before applying it to the local database.
npx wrangler d1 execute phasm-db --local --file /tmp/phasm-editorial-review.sql
```

The generator refuses to overwrite an existing output file. Do not apply this revision to the original shared preview database or a production database. The [preview guide](PREVIEW.md) identifies the isolated editorial target and explains the cloned full-text search index.

## Review

- [Before/after screenshots and test results](QA.md)
- [Cloudflare preview](https://phasm-phase-1-3-preview.wj7djnw2j2.workers.dev)
- [Source review and historical boundaries](SOURCE-REVIEW.md)

No Phase 2 expansion, public reviews, accounts, uploads, or production launch is included.
