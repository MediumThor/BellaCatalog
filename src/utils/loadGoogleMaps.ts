import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

/**
 * Soft bias toward Wisconsin (not a hard boundary).
 * Places API (New) allows at most **50,000 m** for a circle; a larger radius returns 400.
 * Using **bounds** biases statewide without that limit.
 */
export const WISCONSIN_LOCATION_BIAS: google.maps.LatLngBoundsLiteral = {
  south: 42.48,
  west: -92.95,
  north: 47.15,
  east: -86.05,
};

const apiKey = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "").trim();

let ready: Promise<void> | null = null;

export function hasGoogleMapsApiKey(): boolean {
  return apiKey.length > 0;
}

/**
 * Loads Maps JS API + Places library for {@link google.maps.places.PlaceAutocompleteElement}
 * (Places API — new). Rejects if `VITE_GOOGLE_MAPS_API_KEY` is missing or the script fails.
 */
export function loadGoogleMaps(): Promise<void> {
  if (!apiKey) {
    return Promise.reject(new Error("VITE_GOOGLE_MAPS_API_KEY is not set"));
  }
  if (!ready) {
    setOptions({
      key: apiKey,
      v: "weekly",
      region: "US",
    });
    ready = importLibrary("places").then(() => {
      if (typeof google === "undefined" || !google.maps?.places?.PlaceAutocompleteElement) {
        throw new Error("Google Maps Places library (PlaceAutocompleteElement) did not load");
      }
    });
  }
  return ready;
}
