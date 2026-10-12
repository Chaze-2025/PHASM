export interface Source {
  title: string;
  url: string;
  kind: "history" | "reports" | "visiting";
}
export interface Location {
  id: string;
  slug: string;
  name: string;
  city: string;
  state: string;
  country: string;
  region: string;
  latitude: number | null;
  longitude: number | null;
  category: string;
  classification: "established" | "local-legend" | "community-discovery";
  summary: string;
  history: string;
  reports: string;
  phenomena: string[];
  access: "public" | "restricted" | "private" | "unknown";
  tours: "yes" | "no" | "unknown";
  accessNotes: string;
  officialUrl: string;
  sources: Source[];
  image: string;
  imageAlt: string;
  imageCredit: string;
  imageLicense: string;
  imageSource: string;
  status: "draft" | "published" | "archived";
  coordinatePrecision: "exact" | "approximate" | "withheld";
  featured: boolean;
  updatedAt: string;
}
// Public cards keep their display and map fields without downloading the full
// history, reports, source bibliography, and visiting prose for every result.
export type LocationSummary = Omit<
  Location,
  | "history"
  | "reports"
  | "accessNotes"
  | "officialUrl"
  | "sources"
  | "imageCredit"
  | "imageSource"
>;
export interface LocationPage<T = Location> {
  locations: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface AtlasFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    id: string;
    slug: string;
    name: string;
    category: string;
    count?: number;
    clustered?: boolean;
  };
}
export interface AtlasGeoJSON {
  type: "FeatureCollection";
  features: AtlasFeature[];
  total: number;
  truncated?: boolean;
}
export const categories = [
  "Hotel",
  "Historic house",
  "Hospital",
  "Prison",
  "Cemetery",
  "Castle",
  "Theater",
  "Road or bridge",
  "Natural landmark",
  "Ghost town",
  "Other",
];
export const phenomena = [
  "Apparitions",
  "Unexplained sounds",
  "Objects moving",
  "Unusual sensations",
  "Lights and shadows",
];
