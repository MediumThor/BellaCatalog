export default function Footer({ total, filtered }) {
  return (
    <footer className="footer">
      <span>Total catalog rows: {total}</span>
      <span>Visible rows: {filtered}</span>
      <span>Built for Bella Stone wholesale operations</span>
    </footer>
  );
}
