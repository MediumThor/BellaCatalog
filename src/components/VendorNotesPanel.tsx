import { memo } from "react";

type Props = {
  notes: string;
  freightInfo: string;
  compact?: boolean;
};

function VendorNotesPanelInner({ notes, freightInfo, compact }: Props) {
  if (!notes.trim() && !freightInfo.trim()) return null;
  return (
    <div className="vendor-notes">
      {notes.trim() ? (
        <div>
          {compact ? null : <strong>Notes: </strong>}
          <span>{notes}</span>
        </div>
      ) : null}
      {freightInfo.trim() ? (
        <div>
          {compact ? null : <strong>Freight: </strong>}
          <span>{freightInfo}</span>
        </div>
      ) : null}
    </div>
  );
}

export const VendorNotesPanel = memo(VendorNotesPanelInner);
