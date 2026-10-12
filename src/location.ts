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
