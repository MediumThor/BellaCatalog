import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useCompany } from "../company/useCompany";
import {
  archiveCompanyVendor,
  createCompanyVendor,
  deleteCompanyVendor,
  subscribeCompanyVendors,
  updateCompanyVendor,
} from "./vendorFirestore";
import type { CompanyVendorDoc } from "./vendorTypes";

type EditingState =
  | { kind: "idle" }
  | { kind: "new" }
  | { kind: "edit"; vendor: CompanyVendorDoc };

export function VendorsPage() {
  const { user } = useAuth();
  const { activeCompanyId, permissions } = useCompany();

  const [vendors, setVendors] = useState<CompanyVendorDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<EditingState>({ kind: "idle" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!activeCompanyId) return;
    const unsub = subscribeCompanyVendors(
      activeCompanyId,
      (rows) => {
        setVendors(rows);
        setError(null);
      },
      (e) => setError(e.message)
    );
    return unsub;
  }, [activeCompanyId]);

  const visibleVendors = useMemo(
    () => vendors.filter((v) => showArchived || !v.archived),
    [vendors, showArchived]
  );

  if (!permissions.canManageCatalog) {
    return (
      <div className="settings-page">
        <h1 className="settings-page__title">Vendors</h1>
        <p className="settings-page__lede">
          You don't have permission to manage vendors. Ask an owner, admin, or
          catalog manager for access.
        </p>
      </div>
    );
  }

  async function handleSubmit(values: VendorFormValues) {
    if (!activeCompanyId || !user) return;
    setBusy(true);
    setError(null);
    try {
      if (editing.kind === "new") {
        await createCompanyVendor(activeCompanyId, user.uid, {
          name: values.name,
          aliases: values.aliases,
          website: values.website,
          contactEmail: values.contactEmail,
          notes: values.notes,
        });
      } else if (editing.kind === "edit") {
        await updateCompanyVendor(activeCompanyId, editing.vendor.id, {
          name: values.name,
          aliases: values.aliases,
          website: values.website,
          contactEmail: values.contactEmail,
          notes: values.notes,
        });
      }
      setEditing({ kind: "idle" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save vendor.");
    } finally {
      setBusy(false);
    }
  }

  async function handleArchive(vendor: CompanyVendorDoc, archived: boolean) {
    if (!activeCompanyId) return;
    setBusy(true);
    try {
      await archiveCompanyVendor(activeCompanyId, vendor.id, archived);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update vendor.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(vendor: CompanyVendorDoc) {
    if (!activeCompanyId) return;
    const ok = window.confirm(
      `Remove "${vendor.name}" permanently? This can't be undone. Historical price lists already uploaded will keep their vendor name as a string.`
    );
    if (!ok) return;
    setBusy(true);
    try {
      await deleteCompanyVendor(activeCompanyId, vendor.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete vendor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-page">
      <header className="settings-page__head settings-page__head--row">
        <div>
          <h1 className="settings-page__title">Vendors</h1>
          <p className="settings-page__lede">
            The suppliers and distributors whose price sheets you upload. Every
            price list is tagged with a vendor so BellaCatalog can keep your
            quotes accurate when prices change.
          </p>
        </div>
        <div className="settings-page__actions">
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />{" "}
            Show archived
          </label>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setEditing({ kind: "new" })}
            disabled={busy}
          >
            Add vendor
          </button>
        </div>
      </header>

      {error ? (
        <div className="settings-inline-msg settings-inline-msg--bad" role="alert">
          {error}
        </div>
      ) : null}

      {editing.kind !== "idle" ? (
        <section className="settings-card">
          <div className="settings-card__head">
            <h2 className="settings-card__title">
              {editing.kind === "new" ? "Add a vendor" : `Edit ${editing.vendor.name}`}
            </h2>
          </div>
          <VendorForm
            initial={editing.kind === "edit" ? editing.vendor : null}
            onCancel={() => setEditing({ kind: "idle" })}
            onSubmit={handleSubmit}
            busy={busy}
          />
        </section>
      ) : null}

      <section className="settings-card settings-card--flush">
        {visibleVendors.length === 0 ? (
          <div className="settings-empty">
            <h3 className="settings-empty__title">No vendors yet</h3>
            <p className="settings-empty__body">
              Add the suppliers you buy from. You can always add more later
              while uploading a price list.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setEditing({ kind: "new" })}
            >
              Add your first vendor
            </button>
          </div>
        ) : (
          <table className="settings-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Aliases</th>
                <th>Website</th>
                <th>Contact</th>
                <th className="settings-table__end" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visibleVendors.map((v) => (
                <tr key={v.id} className={v.archived ? "settings-table__row--muted" : ""}>
                  <td>
                    <div className="settings-table__primary">
                      {v.name}
                      {v.archived ? (
                        <span className="settings-chip settings-chip--muted">Archived</span>
                      ) : null}
                    </div>
                    {v.notes ? (
                      <div className="settings-table__hint">{v.notes}</div>
                    ) : null}
                  </td>
                  <td className="settings-table__hint">
                    {(v.aliases ?? []).join(", ") || "—"}
                  </td>
                  <td>
                    {v.website ? (
                      <a href={v.website} target="_blank" rel="noreferrer">
                        {v.website.replace(/^https?:\/\//, "")}
                      </a>
                    ) : (
                      <span className="settings-table__hint">—</span>
                    )}
                  </td>
                  <td className="settings-table__hint">{v.contactEmail ?? "—"}</td>
                  <td className="settings-table__end">
                    <div className="settings-row-actions">
                      <Link
                        to={`/settings/price-lists/new?vendorId=${v.id}`}
                        className="btn btn-ghost btn-sm"
                      >
                        Upload price list
                      </Link>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setEditing({ kind: "edit", vendor: v })}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleArchive(v, !v.archived)}
                        disabled={busy}
                      >
                        {v.archived ? "Unarchive" : "Archive"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm settings-row-actions__danger"
                        onClick={() => handleDelete(v)}
                        disabled={busy}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vendor form
// ---------------------------------------------------------------------------

type VendorFormValues = {
  name: string;
  aliases: string[];
  website: string | null;
  contactEmail: string | null;
  notes: string | null;
};

function VendorForm({
  initial,
  onCancel,
  onSubmit,
  busy,
}: {
  initial: CompanyVendorDoc | null;
  onCancel: () => void;
  onSubmit: (values: VendorFormValues) => void | Promise<void>;
  busy: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [aliases, setAliases] = useState((initial?.aliases ?? []).join(", "));
  const [website, setWebsite] = useState(initial?.website ?? "");
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    void onSubmit({
      name: name.trim(),
      aliases: aliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
      website: website.trim() || null,
      contactEmail: contactEmail.trim() || null,
      notes: notes.trim() || null,
    });
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <div className="settings-form__row">
        <label className="auth-field settings-form__col">
          <span className="auth-field__label">Vendor name *</span>
          <input
            className="auth-field__input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Cambria, Hallmark, MSI, StoneX…"
            required
            autoFocus
          />
        </label>
        <label className="auth-field settings-form__col">
          <span className="auth-field__label">Website (optional)</span>
          <input
            className="auth-field__input"
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://example.com"
          />
        </label>
      </div>
      <div className="settings-form__row">
        <label className="auth-field settings-form__col">
          <span className="auth-field__label">Contact email (optional)</span>
          <input
            className="auth-field__input"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="sales@vendor.com"
          />
        </label>
        <label className="auth-field settings-form__col">
          <span className="auth-field__label">Aliases (comma separated)</span>
          <input
            className="auth-field__input"
            type="text"
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            placeholder="MSI, M.S. International"
          />
        </label>
      </div>
      <label className="auth-field">
        <span className="auth-field__label">Notes (optional)</span>
        <textarea
          className="auth-field__input"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Rep, ordering quirks, territory…"
        />
      </label>
      <div className="settings-form__actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
          {busy ? "Saving…" : initial ? "Save changes" : "Add vendor"}
        </button>
      </div>
    </form>
  );
}
