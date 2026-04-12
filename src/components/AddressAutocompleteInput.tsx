import { useEffect, useRef } from "react";
import {
  hasGoogleMapsApiKey,
  loadGoogleMaps,
  WISCONSIN_LOCATION_BIAS,
} from "../utils/loadGoogleMaps";

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  required?: boolean;
  autoComplete?: string;
};

/**
 * US street address autocomplete via **PlaceAutocompleteElement** (Places API — new).
 * Enable **Places API (New)** + **Maps JavaScript API** on the key.
 */
export function AddressAutocompleteInput({
  id,
  value,
  onChange,
  className,
  required,
  autoComplete = "street-address",
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const mapsEnabled = hasGoogleMapsApiKey();

  useEffect(() => {
    if (!mapsEnabled || !wrapRef.current) return;

    let cancelled = false;
    let dispose: (() => void) | undefined;

    loadGoogleMaps()
      .then(() => {
        if (cancelled || !wrapRef.current) return;
        const container = wrapRef.current;
        const { PlaceAutocompleteElement } = google.maps.places;
        const el = new PlaceAutocompleteElement({
          componentRestrictions: { country: "us" },
          locationBias: WISCONSIN_LOCATION_BIAS,
        });
        el.id = id;
        el.setAttribute("placeholder", "Start typing a US street address…");
        if (required) el.setAttribute("required", "");

        const onSelect = async (ev: Event) => {
          let place: google.maps.places.Place | undefined;
          const withPlace = ev as google.maps.places.PlaceAutocompletePlaceSelectEvent;
          if (withPlace.place) {
            place = withPlace.place;
          } else {
            const detail = (
              ev as CustomEvent<{ placePrediction?: { toPlace: () => google.maps.places.Place } }>
            ).detail;
            if (detail?.placePrediction) {
              place = detail.placePrediction.toPlace();
            }
          }
          if (!place) return;
          await place.fetchFields({ fields: ["formattedAddress"] });
          const addr = place.formattedAddress?.trim();
          if (addr) onChangeRef.current(addr);
        };

        /** Typed text lives only on the web component until we mirror it into React state. */
        const onInput = () => {
          const v =
            (el as google.maps.places.PlaceAutocompleteElement & { value?: string }).value?.trim() ??
            "";
          onChangeRef.current(v);
        };

        el.addEventListener("input", onInput);
        el.addEventListener("gmp-select", onSelect);
        container.appendChild(el);

        dispose = () => {
          el.removeEventListener("input", onInput);
          el.removeEventListener("gmp-select", onSelect);
          el.remove();
        };
      })
      .catch((err: unknown) => {
        console.warn(
          "[AddressAutocomplete] Google Maps Places did not load. Enable Places API (New), Maps JavaScript API, billing, and HTTP referrer restrictions.",
          err
        );
      });

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [mapsEnabled, id, required]);

  const hintId = `${id}-address-hint`;

  if (!mapsEnabled) {
    return (
      <>
        <input
          id={id}
          className={className}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          autoComplete={autoComplete}
          placeholder="Street, city, state, ZIP"
          aria-describedby={hintId}
        />
        <p className="address-autocomplete-hint" id={hintId}>
          Add <code className="address-autocomplete-code">VITE_GOOGLE_MAPS_API_KEY</code> to{" "}
          <code className="address-autocomplete-code">.env</code> (enable <strong>Places API (New)</strong> +{" "}
          <strong>Maps JavaScript API</strong> on the key) to turn on address autocomplete.
        </p>
      </>
    );
  }

  return (
    <>
      <div
        ref={wrapRef}
        className={`address-autocomplete-wrap form-input-like${className ? ` ${className}` : ""}`}
        aria-describedby={hintId}
      />
      {/* Keeps address in the React form state for validation; widget fills it on selection. */}
      <span className="sr-only" id={hintId}>
        Select a United States address from the suggestions list.
      </span>
    </>
  );
}
