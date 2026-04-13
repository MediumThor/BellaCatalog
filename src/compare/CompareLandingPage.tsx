import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { createCustomer, subscribeCustomers } from "../services/compareQuoteFirestore";
import { customerContactSummary, customerDisplayName, type CustomerRecord } from "../types/compareQuote";
import { CreateCustomerModal, type CustomerFormValues } from "./CreateCustomerModal";

export function CompareLandingPage() {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [custOpen, setCustOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [fireErr, setFireErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid) return;
    const u = user.uid;
    return subscribeCustomers(u, setCustomers, (e) => setFireErr(e.message));
  }, [user?.uid]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  return (
    <div className="compare-page compare-landing">
      <header className="compare-landing-header compare-landing-header--toolbar-only">
        <div className="compare-landing-header__top">
          <button
            type="button"
            className="btn btn-ghost compare-landing-customers-btn"
            aria-expanded={drawerOpen}
            aria-controls="compare-customers-drawer"
            onClick={() => setDrawerOpen(true)}
          >
            Customers
          </button>
          <button type="button" className="btn btn-primary compare-landing-create-btn" onClick={() => setCustOpen(true)}>
            Create customer
          </button>
        </div>
      </header>

      {fireErr ? (
        <div className="import-warnings" role="alert">
          <strong>Firestore:</strong> {fireErr}. Check rules and that the user is signed in.
        </div>
      ) : null}

      <div
        className={`compare-drawer-backdrop${drawerOpen ? " compare-drawer-backdrop--open" : ""}`}
        role="presentation"
        aria-hidden={!drawerOpen}
        onClick={() => setDrawerOpen(false)}
      />
      <aside
        id="compare-customers-drawer"
        className={`compare-drawer${drawerOpen ? " compare-drawer--open" : ""}`}
        role="dialog"
        aria-modal={drawerOpen}
        aria-hidden={!drawerOpen}
        aria-labelledby="compare-drawer-title"
        inert={!drawerOpen}
      >
        <div className="compare-drawer__header">
          <h2 id="compare-drawer-title" className="compare-drawer__title">
            Your customers
          </h2>
          <button
            type="button"
            className="btn btn-ghost compare-drawer__close"
            aria-label="Close customers list"
            onClick={() => setDrawerOpen(false)}
          >
            ×
          </button>
        </div>
        <div className="compare-drawer__body">
          {customers.length === 0 ? (
            <p className="product-sub compare-drawer__empty">No customers yet. Use Create customer to add one.</p>
          ) : (
            <ul className="compare-drawer__list">
              {customers.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/compare/customers/${c.id}`}
                    className="compare-drawer__link"
                    onClick={() => setDrawerOpen(false)}
                  >
                    <span className="compare-drawer__name">
                      {customerDisplayName(c)}
                    </span>
                    <span className="compare-drawer__meta">{customerContactSummary(c, "No contact info")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <CreateCustomerModal
        open={custOpen}
        onClose={() => setCustOpen(false)}
        onSubmit={async (values: CustomerFormValues) => {
          if (!user?.uid) throw new Error("Not signed in");
          await createCustomer(user.uid, {
            businessName: values.businessName.trim(),
            firstName: values.firstName.trim(),
            lastName: values.lastName.trim(),
            phone: values.phone.trim(),
            email: values.email.trim(),
            address: values.address.trim(),
            notes: values.notes.trim(),
          });
        }}
      />
    </div>
  );
}
