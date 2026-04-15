type Props = {
  /** Customer name · job name (same as main Layout Studio header). */
  kicker: string;
  onChooseUpload: () => void;
  onChooseBlank: () => void;
  uploading: boolean;
};

export function StudioEntryHub({ kicker, onChooseUpload, onChooseBlank, uploading }: Props) {
  return (
    <div className="ls-entry-hub">
      <div className="ls-entry-hero glass-panel">
        <p className="ls-kicker">{kicker}</p>
        <h2 className="ls-entry-title">How would you like to start?</h2>
        <p className="ls-entry-lead">
          Trace a plan for full-site jobs, or sketch pieces directly for quick quotes — same tools, same
          slab placement.
        </p>
      </div>
      <div className="ls-entry-cards">
        <button
          type="button"
          className="ls-entry-card glass-panel"
          onClick={onChooseUpload}
          disabled={uploading}
        >
          <span className="ls-entry-card-kicker">Source-backed</span>
          <span className="ls-entry-card-title">Upload a plan</span>
          <span className="ls-entry-card-body">
            PDF or image — calibrate scale, trace shapes, then place on slabs.
          </span>
          <span className="ls-entry-card-cta">Choose file</span>
        </button>
        <button type="button" className="ls-entry-card glass-panel ls-entry-card--accent" onClick={onChooseBlank}>
          <span className="ls-entry-card-kicker">Quick quote</span>
          <span className="ls-entry-card-title">Start from a blank layout</span>
          <span className="ls-entry-card-body">
            Draw rectangles, L-shapes, or polygons in inches — ideal for islands, vanities, and walk-ins.
          </span>
          <span className="ls-entry-card-cta">Begin blank layout</span>
        </button>
      </div>
    </div>
  );
}
