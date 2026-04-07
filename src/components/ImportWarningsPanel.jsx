export default function ImportWarningsPanel({ warnings }) {
  if (!warnings?.length) return null;
  return (
    <section className="panel import-warnings" aria-live="polite">
      <h2>Import Warnings</h2>
      <ul>
        {warnings.map((warning, index) => (
          <li key={`${warning.sourceFile}-${index}`}>
            <strong>{warning.sourceFile}:</strong> {warning.message}
          </li>
        ))}
      </ul>
    </section>
  );
}
