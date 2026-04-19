import { memo, useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  src: string;
  /** Used for the expand button’s accessible name */
  label: string;
  /** Extra classes for the thumbnail button (e.g. grid sizing). */
  className?: string;
};

function SlabThumbnailLightboxInner({ src, label, className }: Props) {
  const [open, setOpen] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [thumbLoaded, setThumbLoaded] = useState(false);
  const [modalFailed, setModalFailed] = useState(false);
  const [modalLoaded, setModalLoaded] = useState(false);

  useEffect(() => {
    setThumbFailed(false);
    setThumbLoaded(false);
    setModalFailed(false);
    setModalLoaded(false);
  }, [src]);

  useEffect(() => {
    if (!open) setModalLoaded(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const modal = open
    ? createPortal(
        <div
          className="slab-lightbox-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={modalFailed ? `Image unavailable: ${label}` : `Slab image: ${label}`}
          onClick={() => setOpen(false)}
        >
          <div
            className="slab-lightbox-frame"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="slab-lightbox-close"
              onClick={() => setOpen(false)}
              aria-label="Close image"
            >
              ×
            </button>
            {modalFailed ? (
              <div className="slab-lightbox-fallback" role="alert">
                <p className="slab-lightbox-fallback__title">Image unavailable</p>
                <p className="slab-lightbox-fallback__hint">The link may be broken or blocked.</p>
              </div>
            ) : (
              <>
                {!modalLoaded ? (
                  <div
                    className="slab-lightbox__skeleton"
                    aria-hidden="true"
                  />
                ) : null}
                <img
                  className="slab-lightbox__img"
                  src={src}
                  alt=""
                  data-loaded={modalLoaded || undefined}
                  onLoad={() => setModalLoaded(true)}
                  onError={() => setModalFailed(true)}
                />
              </>
            )}
          </div>
        </div>,
        document.body
      )
    : null;

  if (thumbFailed) {
    return (
      <div
        className={["product-thumb-wrap", "product-thumb-fallback", className].filter(Boolean).join(" ")}
        role="img"
        aria-label={`Image unavailable: ${label}`}
      >
        <span className="product-thumb-fallback-label">Unavailable</span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className={["product-thumb-wrap", "product-thumb-trigger", className].filter(Boolean).join(" ")}
        onClick={() => setOpen(true)}
        aria-label={`Expand slab image: ${label}`}
        data-loading={!thumbLoaded || undefined}
      >
        {!thumbLoaded ? (
          <span className="product-thumb-skeleton" aria-hidden="true" />
        ) : null}
        <img
          className="product-thumb"
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          data-loaded={thumbLoaded || undefined}
          onLoad={() => setThumbLoaded(true)}
          onError={() => setThumbFailed(true)}
        />
      </button>
      {modal}
    </>
  );
}

export const SlabThumbnailLightbox = memo(SlabThumbnailLightboxInner);
