export default function VendorSelector({ vendors, activeVendor, onChange }) {
  return (
    <section className="panel vendor-tabs" aria-label="Vendor filters">
      {vendors.map((vendor) => (
        <button
          type="button"
          key={vendor}
          className={vendor === activeVendor ? 'active' : ''}
          onClick={() => onChange(vendor)}
        >
          {vendor}
        </button>
      ))}
    </section>
  );
}
