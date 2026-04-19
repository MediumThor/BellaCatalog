import { type JobActiveEditor } from "../types/compareQuote";
import { type JobPresenceRow } from "../services/compareQuoteFirestore";

export interface JobCollaborationBannerProps {
  viewers: JobPresenceRow[];
  activeEditor: JobActiveEditor | null;
  lockedByOther: boolean;
  onTakeover?: () => void;
  /** When true, hide the "take over" CTA even if someone else has the lock. */
  disableTakeover?: boolean;
}

function describeViewers(rows: JobPresenceRow[]): string {
  if (rows.length === 0) return "";
  const names = Array.from(
    new Set(rows.map((row) => row.displayName?.trim() || "A teammate"))
  );
  if (names.length === 1) return `${names[0]} is also viewing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are also viewing`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} other${
    names.length - 2 === 1 ? "" : "s"
  } are also viewing`;
}

/**
 * Thin bar that sits above shared job surfaces so teammates know when they
 * are about to step on each other. Renders nothing when the job is quiet.
 */
export function JobCollaborationBanner({
  viewers,
  activeEditor,
  lockedByOther,
  onTakeover,
  disableTakeover,
}: JobCollaborationBannerProps) {
  if (!lockedByOther && viewers.length === 0) return null;

  return (
    <div
      className={
        lockedByOther
          ? "job-collab-banner job-collab-banner--locked"
          : "job-collab-banner"
      }
      role="status"
      aria-live="polite"
    >
      {lockedByOther && activeEditor ? (
        <span className="job-collab-banner__label">
          <strong>{activeEditor.displayName ?? "A teammate"}</strong> is editing
          this job.{" "}
          {disableTakeover
            ? "Your changes will be blocked until they finish."
            : "To avoid conflicts, hold off editing or take over."}
        </span>
      ) : (
        <span className="job-collab-banner__label">
          {describeViewers(viewers)}
        </span>
      )}
      {lockedByOther && !disableTakeover && onTakeover ? (
        <button
          type="button"
          className="job-collab-banner__action"
          onClick={onTakeover}
        >
          Take over
        </button>
      ) : null}
    </div>
  );
}
