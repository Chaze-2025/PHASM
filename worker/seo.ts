import type { Location } from "../shared/types";

export const SITE_NAME = "PHASM";
export const SOCIAL_IMAGE = "/images/phasm-social.png";

export type PageMetadata = {
  title: string;
  description: string;
  canonical: string;
  image?: string;
  imageAlt?: string;
  type?: "website" | "article";
  structuredData?: unknown[];
  noindex?: boolean;
};

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

export function siteStructuredData(origin: string) {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${origin}/#organization`,
      name: SITE_NAME,
      url: `${origin}/`,
      logo: `${origin}/brand-mark.svg`,
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${origin}/#website`,
      name: SITE_NAME,
      alternateName: "PHASM Haunted Atlas",
      url: `${origin}/`,
      description:
        "A field guide to haunted places, ghost stories, and the histories behind them.",
      publisher: { "@id": `${origin}/#organization` },
      inLanguage: "en",
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${origin}/map?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
  ];
}

export function breadcrumbStructuredData(
  items: { name: string; url: string }[],
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function collectionStructuredData(
  name: string,
  description: string,
  canonical: string,
  entries: { name: string; url: string }[],
  offset = 0,
) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    description,
    url: canonical,
    isPartOf: { "@id": `${new URL(canonical).origin}/#website` },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: entries.map((entry, index) => ({
        "@type": "ListItem",
        position: offset + index + 1,
        name: entry.name,
        url: entry.url,
      })),
    },
  };
}

// The source-controlled Vite shell has a single empty root. Replacing only
// that shell keeps identical, crawlable content available before React starts.
export function renderPageHtml(
  template: string,
  page: PageMetadata,
  content: string,
): string {
  const origin = new URL(page.canonical).origin;
  const image = new URL(page.image || SOCIAL_IMAGE, origin).href;
  const imageAlt =
    page.imageAlt ||
    "PHASM — The Haunted Atlas. A gold triple-moon pentacle on deep green, with Haunted places. Histories. Ghost stories.";
  const structured = (page.structuredData || [])
    .map(
      (value) =>
        `<script type="application/ld+json" data-phasm-seo>${JSON.stringify(value).replace(/</g, "\\u003c")}</script>`,
    )
    .join("");
  const head = `<title>${escapeHtml(page.title)}</title>
<meta name="description" content="${escapeHtml(page.description)}">
<link rel="canonical" href="${escapeHtml(page.canonical)}">
<meta name="robots" content="${page.noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large"}">
<meta property="og:site_name" content="PHASM">
<meta property="og:locale" content="en_US">
<meta property="og:type" content="${page.type || "website"}">
<meta property="og:title" content="${escapeHtml(page.title)}">
<meta property="og:description" content="${escapeHtml(page.description)}">
<meta property="og:url" content="${escapeHtml(page.canonical)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:image:alt" content="${escapeHtml(imageAlt)}">
${image.endsWith(SOCIAL_IMAGE) ? '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' : ""}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(page.title)}">
<meta name="twitter:description" content="${escapeHtml(page.description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<meta name="twitter:image:alt" content="${escapeHtml(imageAlt)}">
${structured}`;
  const root = /<div\s+id=["']root["']\s*>\s*<\/div>/;
  if (!root.test(template))
    throw new Error("The application HTML shell is missing its empty root.");
  return template
    .replace(/<title[^>]*>[\s\S]*?<\/title>/gi, "")
    .replace(
      /<meta\b(?=[^>]*(?:name=["'](?:description|robots|twitter:[^"']+)["']|property=["']og:[^"']+["']))[^>]*>/gi,
      "",
    )
    .replace(/<link\b(?=[^>]*rel=["']canonical["'])[^>]*>/gi, "")
    .replace(
      /<script\b(?=[^>]*type=["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/gi,
      "",
    )
    .replace(/<\/head>/i, () => `${head}</head>`)
    .replace(root, () => `<div id="root">${content}</div>`);
}

export function locationStructuredData(location: Location, origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Place",
    name: location.name,
    description: location.summary.slice(0, 200),
    url: `${origin}/locations/${location.slug}`,
    image: new URL(location.image, origin).href,
    address: {
      "@type": "PostalAddress",
      addressLocality: location.city,
      addressRegion: location.state,
      addressCountry: location.country,
    },
    ...(location.coordinatePrecision === "exact" &&
    typeof location.latitude === "number" &&
    typeof location.longitude === "number"
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: location.latitude,
            longitude: location.longitude,
          },
        }
      : {}),
    ...(location.officialUrl ? { sameAs: location.officialUrl } : {}),
  };
}
