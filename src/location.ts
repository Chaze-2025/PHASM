import type { Location } from "../shared/types";

/** Only the original top-level asset pipeline creates paired card derivatives. */
export function locationImageSources(image: string): string | undefined {
  return /^\/images\/[^/?#]+\.webp$/.test(image)
    ? `${image.replace(/\.webp$/, "-card.webp")} 720w, ${image} 1920w`
    : undefined;
}

export function hasMapCoordinates<
  T extends Pick<Location, "latitude" | "longitude" | "coordinatePrecision">,
>(location: T): location is T & { latitude: number; longitude: number } {
  return (
    location.coordinatePrecision !== "withheld" &&
    typeof location.latitude === "number" &&
    Number.isFinite(location.latitude) &&
    typeof location.longitude === "number" &&
    Number.isFinite(location.longitude)
  );
}

export function hasLocationPhotograph(
  location: Pick<Location, "image" | "imageLicense">,
): boolean {
  return Boolean(
    location.image &&
    !/\/(?:archive|location)-placeholder\.svg(?:[?#]|$)/.test(location.image) &&
    location.imageLicense !== "PHASM original illustration",
  );
}

export function coordinateReferenceLabel(
  location: Pick<Location, "coordinateReference">,
): string | undefined {
  const reference = location.coordinateReference;
  if (!reference) return;
  const scope = {
    site: "Site reference",
    locality: "Town/area reference",
    county: "County reference",
    state: "State reference",
  }[reference.scope];
  return `${scope}: ${reference.label}`;
}

export function coordinateReferenceDescription(
  location: Pick<Location, "coordinateReference">,
): string | undefined {
  const reference = location.coordinateReference;
  if (!reference) return;
  return reference.scope === "site"
    ? "This pin marks a sourced site reference point. Check official visitor information for the entrance and permitted access."
    : "This pin marks the recorded area, not the site's exact position. Check official visitor information before traveling.";
}

export function coordinateReferenceAttribution(
  location: Pick<Location, "coordinateReference">,
): { name: string; license?: { name: string; url: string } } {
  try {
    const host = new URL(location.coordinateReference?.sourceUrl || "")
      .hostname;
    if (host === "geonames.org" || host.endsWith(".geonames.org"))
      return {
        name: "GeoNames",
        license: {
          name: "CC BY 4.0",
          url: "https://creativecommons.org/licenses/by/4.0/",
        },
      };
    if (host === "census.gov" || host.endsWith(".census.gov"))
      return { name: "U.S. Census Bureau" };
  } catch {
    // Profiles without reference metadata keep their existing display.
  }
  return { name: "Map reference source" };
}
