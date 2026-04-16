import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { AddressAutocompleteInput } from "./AddressAutocompleteInput";
import {
  addCatalogItemsToJobBatch,
  createCustomer,
  createJob,
  getJob,
  subscribeCustomers,
  subscribeJobsForCustomer,
} from "../services/compareQuoteFirestore";
import type { CatalogItem } from "../types/catalog";
import {
  CUSTOMER_TYPE_OPTIONS,
  buildJobAreas,
  customerContactSummary,
  customerDisplayName,
  type CustomerRecord,
  type JobRecord,
} from "../types/compareQuote";
import { AREA_TYPE_PRESETS } from "../types/compareQuote";
import {
  emptyCustomerFormValues,
  type CustomerFormValues,
} from "../compare/CreateCustomerModal";
import { emptyJobFormValues, type JobFormValues } from "../compare/CreateJobModal";
import { formatPhoneInput } from "../utils/phone";

type FlowMode = "existing" | "new";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Resolved catalog rows for the current bag (same order as selection). */
  selectedItems: CatalogItem[];
  onClearSelection: () => void;
};

function filterCustomers(customers: CustomerRecord[], q: string): CustomerRecord[] {
  const s = q.trim().toLowerCase();
  if (!s) return customers;
  return customers.filter((c) => {
    const blob = `${c.businessName ?? ""} ${c.firstName} ${c.lastName} ${c.phone} ${c.email} ${c.address}`.toLowerCase();
    return blob.includes(s);
  });
}

export function CompareCatalogOnboardingModal({
  open,
  onClose,
  selectedItems,
  onClearSelection,
}: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<FlowMode>("existing");
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [fireErr, setFireErr] = useState<string | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [newCustomer, setNewCustomer] = useState<CustomerFormValues>(emptyCustomerFormValues);
  const [newJob, setNewJob] = useState<JobFormValues>(emptyJobFormValues());
  const [inlineJob, setInlineJob] = useState<JobFormValues>(emptyJobFormValues());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    jobId: string;
    added: number;
    failures: { catalogItemId: string; message: string }[];
  } | null>(null);

  useEffect(() => {
    if (!open || !user?.uid) return;
    return subscribeCustomers(user.uid, setCustomers, (e) => setFireErr(e.message));
  }, [open, user?.uid]);

  useEffect(() => {
    if (!open || !selectedCustomerId || !user?.uid) {
      setJobs([]);
      return;
    }
    return subscribeJobsForCustomer(selectedCustomerId, user.uid, setJobs, (e) =>
      setFireErr(e.message)
    );
  }, [open, selectedCustomerId, user?.uid]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setResult(null);
    setCustomerSearch("");
    setSelectedCustomerId(null);
    setSelectedJobId(null);
    setNewCustomer(emptyCustomerFormValues);
    setNewJob(emptyJobFormValues());
    setInlineJob(emptyJobFormValues());
    setMode("existing");
  }, [open]);

  const filteredCustomers = useMemo(
    () => filterCustomers(customers, customerSearch),
    [customers, customerSearch]
  );

  const count = selectedItems.length;
  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId]
  );

  const closeAndReset = () => {
    setResult(null);
    setError(null);
    onClose();
  };

  const runBatchForJob = async (job: JobRecord) => {
    if (!user?.uid) throw new Error("Sign in to add slabs to a job.");
    const { added, failures } = await addCatalogItemsToJobBatch(user.uid, job, selectedItems);
    if (added > 0) {
      onClearSelection();
    }
    if (added > 0 && failures.length === 0) {
      navigate(`/layout/jobs/${job.id}`);
      onClose();
      return;
    }
    if (added > 0 && failures.length > 0) {
      setResult({ jobId: job.id, added, failures });
      return;
    }
    setResult({ jobId: job.id, added, failures });
  };

  const handleAddToExistingJob = async () => {
    setError(null);
    setResult(null);
    if (!selectedJobId) {
      setError("Select a job.");
      return;
    }
    setSaving(true);
    try {
      const job = await getJob(selectedJobId);
      if (!job || job.ownerUserId !== user?.uid) {
        setError("Could not load that job.");
        return;
      }
      await runBatchForJob(job);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateJobThenAdd = async () => {
    setError(null);
    setResult(null);
    if (!selectedCustomerId || !user?.uid) return;
    if (!inlineJob.name.trim()) {
      setError("Job name is required.");
      return;
    }
    setSaving(true);
    try {
      const jobId = await createJob(user.uid, {
        customerId: selectedCustomerId,
        name: inlineJob.name.trim(),
        contactName: inlineJob.contactName.trim(),
        contactPhone: inlineJob.contactPhone.trim(),
        siteAddress: inlineJob.siteAddress.trim(),
        areaType: inlineJob.areaType.trim() || "Other",
        areas: buildJobAreas(inlineJob.areaType.trim() || "Other"),
        squareFootage: 0,
        notes: inlineJob.notes.trim(),
        assumptions: inlineJob.assumptions.trim(),
        status: "draft",
        dxfAttachmentUrl: null,
        drawingAttachmentUrl: null,
      });
      const job = await getJob(jobId);
      if (!job) {
        setError("Job was created but could not be loaded.");
        return;
      }
      await runBatchForJob(job);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create job.");
    } finally {
      setSaving(false);
    }
  };

  const handleNewCustomerJob = async () => {
    setError(null);
    setResult(null);
    if (!user?.uid) {
      setError("Sign in to continue.");
      return;
    }
    const hasBusiness = Boolean(newCustomer.businessName.trim());
    const hasPersonName = Boolean(newCustomer.firstName.trim() && newCustomer.lastName.trim());
    if (!hasBusiness && !hasPersonName) {
      setError("Enter a business name, or both first and last name.");
      return;
    }
    if (!newJob.name.trim()) {
      setError("Job name is required.");
      return;
    }
    setSaving(true);
    try {
      const customerId = await createCustomer(user.uid, {
        customerType: newCustomer.customerType,
        businessName: newCustomer.businessName.trim(),
        firstName: newCustomer.firstName.trim(),
        lastName: newCustomer.lastName.trim(),
        phone: newCustomer.phone.trim(),
        email: newCustomer.email.trim(),
        address: newCustomer.address.trim(),
        notes: newCustomer.notes.trim(),
      });
      const jobId = await createJob(user.uid, {
        customerId,
        name: newJob.name.trim(),
        contactName: newJob.contactName.trim(),
        contactPhone: newJob.contactPhone.trim(),
        siteAddress: newJob.siteAddress.trim(),
        areaType: newJob.areaType.trim() || "Other",
        areas: buildJobAreas(newJob.areaType.trim() || "Other"),
        squareFootage: 0,
        notes: newJob.notes.trim(),
        assumptions: newJob.assumptions.trim(),
        status: "draft",
        dxfAttachmentUrl: null,
        drawingAttachmentUrl: null,
      });
      const job = await getJob(jobId);
      if (!job) {
        setError("Job was created but could not be loaded.");
        return;
      }
      await runBatchForJob(job);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const showPartialSuccess = result && result.added > 0 && result.failures.length > 0;

  return (
    <div className="modal-backdrop compare-onboard-backdrop" role="presentation" onClick={closeAndReset}>
      <div
        className="modal-panel modal-panel--wide compare-onboard-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-onboard-title"
        onClick={(e) => e.stopPropagation()}
      >
        {showPartialSuccess ? (
          <>
            <h2 id="compare-onboard-title" className="modal-title">
              Partially added
            </h2>
            <div className="compare-onboard-success bella-metric-card">
              <p className="compare-onboard-success__lead">
                {result.added} option{result.added === 1 ? "" : "s"} saved. Some rows could not be added:
              </p>
              {result.failures.length ? (
                <ul className="compare-onboard-failures">
                  {result.failures.map((f) => (
                    <li key={f.catalogItemId} className="warning-item warning-item--error">
                      <strong>{f.catalogItemId}</strong>: {f.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={closeAndReset}>
                Close
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  navigate(`/layout/jobs/${result.jobId}`);
                  closeAndReset();
                }}
              >
                Open job
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="compare-onboard-title" className="modal-title">
              Add slabs to a compare job
            </h2>
            <p className="compare-onboard-sub">
              {count === 0 ? (
                <>
                  No slabs in your cart — close and select products with the cart icon, then try again.
                </>
              ) : (
                <>
                  {count} slab{count === 1 ? "" : "s"} selected — default pricing lines apply when
                  available; rows without prices are still saved for review in the compare tool.
                </>
              )}
            </p>

            {fireErr ? (
              <p className="compare-warning" role="alert">
                {fireErr}
              </p>
            ) : null}
            {error ? (
              <p className="compare-warning" role="alert">
                {error}
              </p>
            ) : null}
            {result && result.added === 0 && result.failures.length ? (
              <p className="compare-warning" role="alert">
                Nothing was added. {result.failures[0]?.message ?? "Check your connection and try again."}
              </p>
            ) : null}

            <div className="compare-onboard-seg" role="tablist" aria-label="Choose flow">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "existing"}
                className={`compare-onboard-seg__btn${mode === "existing" ? " compare-onboard-seg__btn--active" : ""}`}
                onClick={() => setMode("existing")}
              >
                Existing customer
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "new"}
                className={`compare-onboard-seg__btn${mode === "new" ? " compare-onboard-seg__btn--active" : ""}`}
                onClick={() => setMode("new")}
              >
                New customer &amp; job
              </button>
            </div>

            {mode === "existing" ? (
              <div className="compare-onboard-body">
                <label className="form-label compare-onboard-search-label">
                  Find customer
                  <input
                    className="form-input"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    placeholder="Name, phone, email…"
                    autoComplete="off"
                  />
                </label>

                {filteredCustomers.length === 0 ? (
                  <div className="bella-empty-state compare-onboard-empty">
                    {customers.length === 0
                      ? "No customers yet. Switch to “New customer & job” or create a customer from the Compare tool."
                      : "No customers match that search."}
                  </div>
                ) : (
                  <ul className="compare-onboard-cust-list" role="listbox" aria-label="Customers">
                    {filteredCustomers.map((c) => {
                      const active = c.id === selectedCustomerId;
                      return (
                        <li key={c.id} role="none">
                          <button
                            type="button"
                            role="option"
                            aria-selected={active}
                            className={`compare-onboard-cust${active ? " compare-onboard-cust--active" : ""}`}
                            onClick={() => {
                              setSelectedCustomerId(c.id);
                              setSelectedJobId(null);
                            }}
                          >
                            <span className="compare-onboard-cust__name">
                              {customerDisplayName(c)}
                            </span>
                            <span className="compare-onboard-cust__meta">
                              {customerContactSummary(c, "No contact info")}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {selectedCustomerId && selectedCustomer ? (
                  <section className="compare-onboard-jobs" aria-labelledby="compare-onboard-jobs-title">
                    <h3 id="compare-onboard-jobs-title" className="compare-onboard-section-title">
                      Jobs for {customerDisplayName(selectedCustomer)}
                    </h3>
                    {jobs.length === 0 ? (
                      <div className="compare-onboard-inline-job">
                        <p className="product-sub">
                          No jobs yet for this customer. Create the first job, then slabs are added
                          automatically.
                        </p>
                        <div className="compare-form-grid">
                          <label className="form-label compare-form-span-2">
                            Job name *
                            <input
                              className="form-input"
                              value={inlineJob.name}
                              onChange={(e) => setInlineJob((j) => ({ ...j, name: e.target.value }))}
                              placeholder="e.g. Main kitchen"
                            />
                          </label>
                          <label className="form-label compare-form-span-2">
                            Area type
                            <input
                              className="form-input"
                              list="compare-onboard-area-presets"
                              value={inlineJob.areaType}
                              onChange={(e) => setInlineJob((j) => ({ ...j, areaType: e.target.value }))}
                            />
                            <datalist id="compare-onboard-area-presets">
                              {AREA_TYPE_PRESETS.map((p) => (
                                <option key={p} value={p} />
                              ))}
                            </datalist>
                          </label>
                          <label className="form-label compare-form-span-2">
                            Notes
                            <textarea
                              className="form-input form-textarea"
                              rows={2}
                              value={inlineJob.notes}
                              onChange={(e) => setInlineJob((j) => ({ ...j, notes: e.target.value }))}
                            />
                          </label>
                          <label className="form-label compare-form-span-2">
                            Assumptions
                            <textarea
                              className="form-input form-textarea"
                              rows={2}
                              value={inlineJob.assumptions}
                              onChange={(e) =>
                                setInlineJob((j) => ({ ...j, assumptions: e.target.value }))
                              }
                            />
                          </label>
                        </div>
                        <button
                          type="button"
                          className="btn btn-primary compare-onboard-primary"
                          disabled={saving || count < 1}
                          onClick={() => void handleCreateJobThenAdd()}
                        >
                          {saving ? "Saving…" : `Create job & add ${count} slab${count === 1 ? "" : "s"}`}
                        </button>
                      </div>
                    ) : (
                      <>
                        <ul className="compare-onboard-job-list" role="radiogroup" aria-label="Jobs">
                          {jobs.map((j) => {
                            const active = j.id === selectedJobId;
                            return (
                              <li key={j.id}>
                                <button
                                  type="button"
                                  role="radio"
                                  aria-checked={active}
                                  className={`compare-onboard-job${active ? " compare-onboard-job--active" : ""}`}
                                  onClick={() => setSelectedJobId(j.id)}
                                >
                                  <span className="compare-onboard-job__name">{j.name}</span>
                                  <span className="compare-onboard-job__meta">
                                    {j.areaType || "No areas yet"} · {j.status}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                        <button
                          type="button"
                          className="btn btn-primary compare-onboard-primary"
                          disabled={saving || count < 1 || !selectedJobId}
                          onClick={() => void handleAddToExistingJob()}
                        >
                          {saving ? "Adding…" : `Add ${count} slab${count === 1 ? "" : "s"} to job`}
                        </button>
                      </>
                    )}
                  </section>
                ) : null}
              </div>
            ) : (
              <div className="compare-onboard-body compare-onboard-body--new">
                <h3 className="compare-onboard-section-title">Customer</h3>
                <div className="compare-form-grid">
                  <div className="form-label compare-form-span-2">
                    Customer type
                    <div className="view-toggle form-view-toggle" role="group" aria-label="New customer type">
                      {CUSTOMER_TYPE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className="btn view-toggle__btn"
                          data-active={newCustomer.customerType === option.value}
                          aria-pressed={newCustomer.customerType === option.value}
                          onClick={() => setNewCustomer((v) => ({ ...v, customerType: option.value }))}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="form-label compare-form-span-2">
                    Business name
                    <input
                      className="form-input"
                      value={newCustomer.businessName}
                      onChange={(e) => setNewCustomer((v) => ({ ...v, businessName: e.target.value }))}
                      autoComplete="organization"
                      placeholder="Optional business or company name"
                    />
                  </label>
                  <label className="form-label">
                    First name
                    <input
                      className="form-input"
                      value={newCustomer.firstName}
                      onChange={(e) => setNewCustomer((v) => ({ ...v, firstName: e.target.value }))}
                      autoComplete="given-name"
                    />
                  </label>
                  <label className="form-label">
                    Last name
                    <input
                      className="form-input"
                      value={newCustomer.lastName}
                      onChange={(e) => setNewCustomer((v) => ({ ...v, lastName: e.target.value }))}
                      autoComplete="family-name"
                    />
                  </label>
                  <label className="form-label">
                    Phone
                    <input
                      className="form-input"
                      value={newCustomer.phone}
                      onChange={(e) =>
                        setNewCustomer((v) => ({ ...v, phone: formatPhoneInput(e.target.value) }))
                      }
                      autoComplete="tel"
                    />
                  </label>
                  <label className="form-label">
                    Email
                    <input
                      className="form-input"
                      type="email"
                      value={newCustomer.email}
                      onChange={(e) => setNewCustomer((v) => ({ ...v, email: e.target.value }))}
                      autoComplete="email"
                    />
                  </label>
                  <label className="form-label compare-form-span-2">
                    Address
                    <AddressAutocompleteInput
                      id="compare-onboard-new-address"
                      className="form-input"
                      value={newCustomer.address}
                      onChange={(address) => setNewCustomer((v) => ({ ...v, address }))}
                    />
                  </label>
                  <label className="form-label compare-form-span-2">
                    Notes
                    <textarea
                      className="form-input form-textarea"
                      rows={2}
                      value={newCustomer.notes}
                      onChange={(e) => setNewCustomer((v) => ({ ...v, notes: e.target.value }))}
                    />
                  </label>
                </div>

                <h3 className="compare-onboard-section-title">Job</h3>
                <div className="compare-form-grid">
                  <label className="form-label compare-form-span-2">
                    Job name *
                    <input
                      className="form-input"
                      value={newJob.name}
                      onChange={(e) => setNewJob((j) => ({ ...j, name: e.target.value }))}
                      placeholder="e.g. Main kitchen"
                    />
                  </label>
                  <label className="form-label compare-form-span-2">
                    Area type
                    <input
                      className="form-input"
                      list="compare-onboard-new-area"
                      value={newJob.areaType}
                      onChange={(e) => setNewJob((j) => ({ ...j, areaType: e.target.value }))}
                    />
                    <datalist id="compare-onboard-new-area">
                      {AREA_TYPE_PRESETS.map((p) => (
                        <option key={p} value={p} />
                      ))}
                    </datalist>
                  </label>
                  <label className="form-label compare-form-span-2">
                    Notes
                    <textarea
                      className="form-input form-textarea"
                      rows={2}
                      value={newJob.notes}
                      onChange={(e) => setNewJob((j) => ({ ...j, notes: e.target.value }))}
                    />
                  </label>
                  <label className="form-label compare-form-span-2">
                    Assumptions
                    <textarea
                      className="form-input form-textarea"
                      rows={2}
                      value={newJob.assumptions}
                      onChange={(e) => setNewJob((j) => ({ ...j, assumptions: e.target.value }))}
                    />
                  </label>
                </div>

                <button
                  type="button"
                  className="btn btn-primary compare-onboard-primary"
                  disabled={saving || count < 1}
                  onClick={() => void handleNewCustomerJob()}
                >
                  {saving ? "Saving…" : `Create & add ${count} slab${count === 1 ? "" : "s"}`}
                </button>
              </div>
            )}

            {!showPartialSuccess ? (
              <div className="modal-actions compare-onboard-footer">
                <button type="button" className="btn btn-ghost" onClick={closeAndReset} disabled={saving}>
                  Cancel
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
