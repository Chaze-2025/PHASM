# October 10, 2026 USA research conversion

This directory contains public conversion inputs and provenance, not the internal research handoff. Keep the original ZIP and extracted files separately; they contain editorial notes and image candidates that are not approved website content.

- `catalog-before-usa-130.json`: the ten public records reconciled before this import.
- `usa-130-access.json`: reviewed native access and tour classifications. `unknown` does not mean prohibited. Lodging or investigation availability alone does not establish a tour.
- `usa-130-public-copy.json`: 25 narrowly edited public paragraphs that remove writing instructions while retaining stories and visitor restrictions. Each replacement is guarded by the original paragraph's SHA-256 digest.
- `usa-130-provenance.json`: all 130 stable research IDs, native ID/slug mappings, claim-based source roles, original physical categories and input checksums.
- `usa-130-sources.json`: public bibliographic metadata for all 431 sources, including geography references that are not classified as historical or paranormal evidence. Internal inspection notes remain in the original handoff.

Run `npx tsx scripts/research-import.ts /path/to/extracted-handoff` to validate conversion without writing files. Add `--write` to regenerate the catalog, provenance and public bibliography. It reads the canonical `phasm_usa_locations.json` and `phasm_sources.json`; older expansion batches are not import inputs. See [the integration guide](../../docs/USA-ATLAS-130.md) for database and deployment procedures.

Introductions precede the complete attributed report paragraphs. History is optional when the research supplies none; a report citation is not relabelled as historical evidence. Multiple inspected records for the same URL and claim role become one public link, with every original source ID retained in provenance. Existing four US identities and image credits remain, and the six international records are unchanged. All 126 additions use a labelled original nonphotographic illustration.
