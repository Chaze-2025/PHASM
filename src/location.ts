import type { Location } from "../shared/types";

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
