import type { CSSProperties } from "react";

type Props = {
  progress: number | null;
  compact?: boolean;
  stage?: "uploading" | "processing";
  tone?: "default" | "success";
  label?: string;
};

export function UploadProgressRing({
  progress,
  compact = false,
  stage = "uploading",
  tone = "default",
  label,
}: Props) {
  const clamped = Math.max(0, Math.min(100, progress ?? 0));
  const showPercent = progress != null && (stage !== "processing" || clamped < 100);
  const valueText = showPercent ? `${Math.round(clamped)}%` : label ?? (stage === "processing" ? "..." : "0%");
  const style = {
    "--ls-upload-progress": `${clamped}%`,
  } as CSSProperties;

  return (
    <div
      className={`ls-upload-ring${compact ? " ls-upload-ring--compact" : ""}${
        stage === "processing" ? " is-processing" : ""
      }${tone === "success" ? " ls-upload-ring--success" : ""}${
        !showPercent && label ? " ls-upload-ring--label" : ""
      }`}
      style={style}
      aria-hidden
    >
      <div className="ls-upload-ring__inner">
        <span className="ls-upload-ring__value">{valueText}</span>
      </div>
    </div>
  );
}
