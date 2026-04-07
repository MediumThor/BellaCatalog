export default function VendorNotesPanel({ notes, freightInfo }) {
  if (!notes && !freightInfo) return null;
  return (
    <div className="vendor-notes">
      {notes && <p><strong>Notes:</strong> {notes}</p>}
      {freightInfo && <p><strong>Freight:</strong> {freightInfo}</p>}
    </div>
  );
}
