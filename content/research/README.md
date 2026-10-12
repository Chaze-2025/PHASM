# October 10, 2026 USA research conversion

This directory contains public conversion inputs and provenance, not the internal research handoff. Keep the original ZIP and extracted files separately; they contain editorial notes and image candidates that are not approved website content.

- `catalog-before-usa-130.json`: the ten public records reconciled before this import.
- `usa-130-access.json`: reviewed native access and tour classifications. `unknown` does not mean prohibited. Lodging or investigation availability alone does not establish a tour.
- `usa-130-public-copy.json`: 25 narrowly edited public paragraphs that remove writing instructions while retaining stories and visitor restrictions. Each replacement is guarded by the original paragraph's SHA-256 digest.
- `usa-130-provenance.json`: all 130 stable research IDs, native ID/slug mappings, claim-based source roles, original physical categories and input checksums.
- `usa-130-sources.json`: public bibliographic metadata for all 431 original sources plus reviewed coordinate-enrichment references. Geographic references are not classified as historical or paranormal evidence. Internal editorial notes remain in the original handoff.
- `usa-130-geocodes.json`: when present, reviewed coordinate enrichment keyed by research ID. Every entry identifies the inspected source, coordinate pair, precision, kind of map point, supporting evidence and inspection date. The converter preserves the 55 original public research points and only adds previously missing coordinates.

Run `npx tsx scripts/research-import.ts /path/to/extracted-handoff` to validate conversion without writing files. Add `--write` to regenerate the catalog, provenance and public bibliography. It reads the canonical `phasm_usa_locations.json` and `phasm_sources.json`; older expansion batches are not import inputs. See [the integration guide](../../docs/USA-ATLAS-130.md) for database and deployment procedures.

Introductions precede the complete attributed report paragraphs. History is optional when the research supplies none; a report citation is not relabelled as historical evidence. Multiple inspected records for the same URL and claim role become one public link, with every original source ID retained in provenance. Existing four US identities and image credits remain, and the six international records are unchanged. All 126 additions use a labelled original nonphotographic illustration.

The converter reads coordinate enrichment automatically when its file is present, validates its evidence metadata, and records its SHA-256 digest and per-location geographic provenance. Approximate points identify source-mapped features; they do not promise surveyed visitor entrances or permission to enter. Narrative review dates remain separate from geocode inspection dates. Generic conversion still supports a withheld marker for future records without reviewed coordinates.
