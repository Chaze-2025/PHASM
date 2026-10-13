import { findState } from "../shared/discovery";

export interface ClientMetadata {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
  image?: string;
  imageAlt?: string;
  type?: "website" | "article";
}

const description =
  "Discover haunted places, ghost stories, and the history behind them. Explore the PHASM Haunted Atlas and browse researched places across all 50 U.S. states.";

export function routeMetadata(
  pathname: string,
  search: string,
): ClientMetadata {
  const pages: Record<
    string,
    { title: string; description?: string; noindex?: boolean }
  > = {
    "/": { title: "PHASM — Haunted Places, Ghost Stories & the Haunted Atlas" },
    "/map": { title: "Haunted Places Map — The Haunted Atlas | PHASM" },
    "/about": {
      title: "About PHASM — Haunted Places, History & Our Approach",
      description:
        "How PHASM brings together haunted places, documented history, and local ghost lore, with sources, credited photographs, and respectful visiting information.",
    },
    "/encyclopedia": {
      title: "Ghosts & Paranormal Phenomena — The PHASM Index",
      description:
        "Explore the language of ghost stories: apparitions, unexplained sounds, moving objects, unusual sensations, and mysterious lights and shadows.",
    },
    "/saved": {
      title: "Your saved places — PHASM",
      description:
        "Your saved haunted places, stored privately in this browser.",
      noindex: true,
    },
    "/account": { title: "Your PHASM account — PHASM", noindex: true },
    "/cases": { title: "Case Files — PHASM", noindex: true },
    "/admin": { title: "Editorial desk — PHASM", noindex: true },
    "/admin/review": {
      title: "Private research review — PHASM",
      noindex: true,
    },
    "/haunted-places": {
      title: "Haunted Places by State | PHASM",
      description:
        "Explore haunted places across all 50 U.S. states. Browse ghost stories, documented histories, source links, and visiting information in the PHASM Haunted Atlas.",
    },
  };
  const known = pages[pathname];
  if (known) return { description, ...known, path: pathname };
  const stateMatch = /^\/haunted-places\/([^/]+)$/.exec(pathname);
  const state = stateMatch && findState(stateMatch[1]);
  if (state) {
    const value = Number(new URLSearchParams(search).get("page") || 1);
    const page =
      Number.isSafeInteger(value) && value > 1 && value <= 100000 ? value : 1;
    return {
      title: `Haunted Places in ${state.name}${page > 1 ? ` — Page ${page}` : ""} | PHASM`,
      description: `Explore haunted places and ghost stories in ${state.name}. Read local histories, reported encounters, sources, and visiting information in the PHASM Haunted Atlas.`,
      path: `/haunted-places/${state.slug}${page > 1 ? `?page=${page}` : ""}`,
    };
  }
  if (/^\/locations\/[a-z0-9-]+$/.test(pathname)) {
    return {
      title: "Haunted Place — Hauntings, History & Visiting Guide | PHASM",
      description,
      path: pathname,
    };
  }
  return {
    title: "Page not found — PHASM",
    description:
      "This page is not in the PHASM archive. Explore the Haunted Atlas to find a place with a story.",
    path: pathname,
    noindex: true,
  };
}

export function updateMetadata(page: ClientMetadata) {
  const existing = document.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  const origin = existing
    ? new URL(existing.href).origin
    : window.location.origin;
  const canonical = new URL(page.path, origin).href;
  const image = new URL(page.image || "/images/phasm-social.png", origin).href;
  const imageAlt =
    page.imageAlt ||
    "PHASM — a field guide to haunted places and the unexplained";
  const meta = (attribute: "name" | "property", key: string, value: string) => {
    let element = document.querySelector<HTMLMetaElement>(
      `meta[${attribute}="${key}"]`,
    );
    if (!element) {
      element = document.createElement("meta");
      element.setAttribute(attribute, key);
      document.head.appendChild(element);
    }
    element.content = value;
  };
  document.title = page.title;
  const link = existing || document.createElement("link");
  link.rel = "canonical";
  link.href = canonical;
  if (!existing) document.head.appendChild(link);
  meta("name", "description", page.description);
  meta(
    "name",
    "robots",
    page.noindex
      ? "noindex, nofollow"
      : "index, follow, max-image-preview:large",
  );
  meta("property", "og:site_name", "PHASM");
  meta("property", "og:locale", "en_US");
  meta("property", "og:type", page.type || "website");
  meta("property", "og:title", page.title);
  meta("property", "og:description", page.description);
  meta("property", "og:url", canonical);
  meta("property", "og:image", image);
  meta("property", "og:image:alt", imageAlt);
  meta("name", "twitter:card", "summary_large_image");
  meta("name", "twitter:title", page.title);
  meta("name", "twitter:description", page.description);
  meta("name", "twitter:image", image);
  meta("name", "twitter:image:alt", imageAlt);
  // A location photograph can have a different aspect ratio from the social card.
  document
    .querySelectorAll(
      'meta[property="og:image:width"], meta[property="og:image:height"]',
    )
    .forEach((element) => element.remove());
  if (!page.image) {
    meta("property", "og:image:width", "1200");
    meta("property", "og:image:height", "630");
  }
}
