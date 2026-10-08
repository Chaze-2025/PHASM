# Editorial seed and content expansion

The engineering milestone includes **10 real location profiles**, covering the United States, United Kingdom, Romania and Australia. They are available in the local application as `published` records so the complete map/profile flow can be evaluated. This does not constitute public-launch approval or completion of the 50-profile content milestone.

`content/locations.json` is the editable seed. Every record separates `history` from `reports`, includes source links and visiting guidance, and uses a shared `Location` contract. Empty phenomenon arrays are intentional: a place having ghost folklore does not justify inventing a specific sighting, sound or other reported event. `tours: "yes"` means the operator offers some form of public tour, not necessarily a paranormal investigation. Pendle guided-tour availability remains `unknown`.

## Research and limitations

Source review took place on 8 October 2026, using Exa retrieval of official operator, heritage, tourism and reference pages. Thirty-two source references accompany the ten records. Some links are reused for separate history/report roles. The review also consulted the English Wikipedia coordinates API for the named places. Pins identify landmarks, not guaranteed entrances or safe walking/driving routes. The Port Arthur article supplies a broad site-area coordinate, so that pin is explicitly approximate. Pendle Hill is also approximate and excludes private farm addresses.

Official operators are appropriate sources for their own visiting information and for identifying stories they tell. They are not independent verification of supernatural claims. The seed attributes those stories explicitly. Primary historical sources should be expanded in Phase 2; the Stanley profile already includes the National Park Service district nomination. Queen Mary's history presently cites a referenced encyclopedic summary and needs a primary archival source before the full public content release.

Several reviewed operator pages contained older event offers alongside current information. No prices, opening times, seasonal events, exact tour durations or promises of current availability have been copied into the seed. Visitors must check the linked operator before travel.

Eastern State's profile includes the operator's stated refusal to claim a haunting, reported by NPR/KPBS. Its seasonal haunted attraction is not paranormal evidence. Bran Castle is included for regional and literary folklore, with Dracula clearly identified as fictional. Pendle's witchcraft accusations are not represented as proof of supernatural powers. There are no invented reviews, star ratings, witnesses, quotations, investigation results or visit counts.

The content is a concise starting point, not exhaustive historical scholarship. All profiles still need a second editorial review, access recheck and source-by-source accuracy review before public launch. No community discoveries are seeded as approved places.

## Image licensing

Five genuine location photographs are stored locally as WebP. `content/image-credits.json` retains the exact Commons file, photographer, download URL, license URL, review date and conversion notes. License metadata was checked through the Wikimedia Commons API, and each downloaded photo was visually inspected against the location identity. The other five profiles use a clearly labelled original architectural illustration; it is not a representation of their actual buildings.

| Local image | Subject / photographer | License |
| --- | --- | --- |
| `stanley-hotel.webp` | Stanley Hotel / Ontherocks108 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `eastern-state-penitentiary.webp` | Cellblock gallery / Gangway Ghost | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `edinburgh-castle.webp` | Edinburgh Castle exterior / VegasGav7777 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `winchester-mystery-house.webp` | Winchester Mystery House / The wub | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `pendle-hill.webp` | Pendle Hill from Weets Hill / Dominic Nelson | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |

Each photographic asset also has a 720px `-card.webp` derivative for lists and discovery cards (approximately 38–71 KB per image). Use these for small display sizes and the full image for profile heroes.

`hero.webp` is an identical copy of the Edinburgh Castle WebP. It is naturally monochrome in the source photograph. No synthetic fog, architecture or paranormal details were added. Images were only resized and converted; CSS presentation may crop or tint them. Retain attribution, source and license links wherever they are displayed. Modified images remain available under their source's CC BY-SA 4.0 license. That image license does not imply that all application code has the same license.

Exact source URLs:

- [Stanley Hotel front](https://commons.wikimedia.org/wiki/File:Stanley_Hotel_front.jpg)
- [Eastern State cellblock gallery](https://commons.wikimedia.org/wiki/File:Eastern_state_penitentiary_cellblock_gallery.jpg)
- [Edinburgh Castle](https://commons.wikimedia.org/wiki/File:Edinburgh_Castle_ByVegasGav7777.jpg)
- [Winchester Mystery House](https://commons.wikimedia.org/wiki/File:Winchester_Mystery_House_2023-07-17_02.jpg)
- [Pendle Hill](https://commons.wikimedia.org/wiki/File:Pendle_Hill_-_view_from_Weets_Hill_-_Feb_2025.jpg)

## Publication checklist for the remaining 40+ profiles

1. Verify identity, region and privacy-safe coordinates against reliable mapping and an independent location source. Do not publish private residences or sensitive sites by default.
2. Write concise history from cited records. Keep supernatural claims in the reports field and identify whether they are local tradition, first-person testimony, tourism narration or another source type.
3. Confirm official links and access conditions. Use `unknown` rather than guessing. Permission to visit a business or historic site is not permission to investigate after hours.
4. Obtain a licensed image with full attribution, or retain the labelled placeholder. Never reuse unlicensed destination marketing photography.
5. Run the bulk-import validation and duplicate review. Import candidate records as drafts; an editor must approve publication.
6. Have a second editor check claims, geographic identity, source quality, image rights and sensitivity. Record recheck dates before publishing.

Prioritize greater geographic coverage, smaller regional destinations and non-institutional folklore. Do not pad the atlas with invented places, duplicated landmarks or unsupported claims. The 50-profile release milestone remains **40 additional researched profiles plus full editorial review**.
