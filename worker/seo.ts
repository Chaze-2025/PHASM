import type { Location } from "../shared/types";

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
