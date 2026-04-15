import { PenSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import {
  createJob,
  deleteCustomer,
  deleteJob,
  fetchOptionsForJob,
  subscribeCustomer,
  subscribeJobsForCustomer,
  updateCustomer,
} from "../services/compareQuoteFirestore";
import {
  DEFAULT_CUSTOMER_TYPE,
  buildJobAreas,
  customerDisplayName,
  type CustomerRecord,
  type JobComparisonOptionRecord,
  type JobRecord,
} from "../types/compareQuote";
import { CreateCustomerModal, type CustomerFormValues } from "./CreateCustomerModal";
import { CreateJobModal, type JobFormValues } from "./CreateJobModal";

const JOB_THUMB_LIMIT = 4;

function thumbnailUrlsForOptions(options: JobComparisonOptionRecord[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of options) {
    const u = o.layoutPreviewImageUrl || o.imageUrl;
    if (u && !seen.has(u)) {
      seen.add(u);
      out.push(u);
      if (out.length >= JOB_THUMB_LIMIT) break;
    }
  }
  return out;
}

function formatJobStatus(status: string): string {
  if (!status) return status;
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function customerToFormValues(c: {
  customerType?: CustomerRecord["customerType"];
  businessName?: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}): CustomerFormValues {
  return {
    customerType: c.customerType ?? DEFAULT_CUSTOMER_TYPE,
    businessName: c.businessName ?? "",
    firstName: c.firstName,
    lastName: c.lastName,
    phone: c.phone,
    email: c.email,
    address: c.address,
    notes: c.notes,
  };
}

function CustomerJobRow({
  job,
  ownerUserId,
  deleting,
  onDelete,
}: {
  job: JobRecord;
  ownerUserId: string;
  deleting: boolean;
  onDelete: (job: JobRecord) => void;
}) {
  const [thumbs, setThumbs] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const opts = await fetchOptionsForJob(job.id, ownerUserId);
        if (cancelled) return;
        setThumbs(thumbnailUrlsForOptions(opts));
      } catch {
        if (!cancelled) setThumbs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [job.id, ownerUserId]);

  return (
    <li className={`compare-job-list__item${deleting ? " compare-job-list__item--busy" : ""}`}>
      <Link
        to={`/compare/jobs/${job.id}`}
        className="compare-job-row"
        tabIndex={deleting ? -1 : undefined}
        aria-busy={deleting}
        onClick={(e) => {
          if (deleting) e.preventDefault();
        }}
      >
        <div className="compare-job-row__title-line">
          <span className="compare-job-row__titles">
            <span className="compare-job-row__name">{job.name}</span>
            <span className="compare-job-row__dot" aria-hidden="true">
              ·
            </span>
            <span className="compare-job-row__area">{job.areaType || "No areas yet"}</span>
          </span>
          <div
            className="compare-job-row__thumbs"
            aria-hidden={thumbs === null || thumbs.length === 0}
          >
            {thumbs === null ? (
              <span className="compare-job-thumb compare-job-thumb--skeleton" />
            ) : thumbs.length === 0 ? (
              <span className="compare-job-thumb compare-job-thumb--empty" title="No slabs yet" />
            ) : (
              thumbs.map((url) => (
                <span key={url} className="compare-job-thumb">
                  <img src={url} alt="" loading="lazy" decoding="async" />
                </span>
              ))
            )}
          </div>
          <span
            className={`compare-job-status compare-job-status--${job.status}`}
            title="Status"
          >
            {formatJobStatus(job.status)}
          </span>
        </div>
      </Link>
      <div className="compare-job-list__actions">
        <button
          type="button"
          className="btn btn-ghost compare-job-delete-btn"
          disabled={deleting}
          aria-label={`Delete job ${job.name}`}
          onClick={() => onDelete(job)}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

export function CustomerDetailPage() {
  const { customerId } = useParams<{ customerId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<CustomerRecord | null | undefined>(undefined);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [jobOpen, setJobOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setCustomer(undefined);
  }, [customerId]);

  useEffect(() => {
    if (!customerId || !user?.uid) return;
    return subscribeCustomer(customerId, user.uid, setCustomer, (e) => setErr(e.message));
  }, [customerId, user?.uid]);

  useEffect(() => {
    if (!customerId || !user?.uid) return;
    return subscribeJobsForCustomer(customerId, user.uid, setJobs, (e) => setErr(e.message));
  }, [customerId, user?.uid]);

  if (!customerId) {
    return <p className="compare-warning">Missing customer.</p>;
  }

  if (!user?.uid) {
    return <p className="compare-warning">Sign in to view this customer.</p>;
  }

  if (customer === undefined) {
    return <p className="product-sub">Loading customer…</p>;
  }

  if (customer === null) {
    return <p className="compare-warning">Customer not found or you do not have access.</p>;
  }

  if (customer.ownerUserId !== user.uid) {
    return <p className="compare-warning">You do not have access to this customer.</p>;
  }

  return (
    <div className="compare-page">
      <nav className="compare-breadcrumb">
        <Link to="/compare">Compare tool</Link>
        <span aria-hidden="true"> / </span>
        <span>
          {customerDisplayName(customer)}
        </span>
      </nav>

      {err ? (
        <div className="import-warnings" role="alert">
          {err}
        </div>
      ) : null}

      <header className="compare-customer-hero">
        <div className="compare-customer-hero__head">
          <h1 className="compare-title compare-customer-hero__title">
            {customerDisplayName(customer)}
          </h1>
          <div className="compare-customer-hero__actions">
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              aria-label={`Edit customer ${customerDisplayName(customer)}`}
              title="Edit customer"
              onClick={() => setEditOpen(true)}
            >
              <PenSquare aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn compare-btn-create-job"
              onClick={() => setJobOpen(true)}
            >
              Create job
            </button>
            <Link className="btn btn-ghost" to="/compare">
              All customers
            </Link>
          </div>
        </div>

        <div className="compare-customer-contact">
          {customer.phone.trim() ? (
            <a className="compare-customer-contact__item" href={`tel:${customer.phone}`}>
              <span className="compare-customer-contact__label">Phone</span>
              <span className="compare-customer-contact__value">{customer.phone}</span>
            </a>
          ) : null}
          {customer.email.trim() ? (
            <a className="compare-customer-contact__item" href={`mailto:${customer.email}`}>
              <span className="compare-customer-contact__label">Email</span>
              <span className="compare-customer-contact__value">{customer.email}</span>
            </a>
          ) : null}
          <div className="compare-customer-contact__item compare-customer-contact__item--block">
            <span className="compare-customer-contact__label">Address</span>
            <span className="compare-customer-contact__value">{customer.address}</span>
          </div>
          {customer.notes?.trim() ? (
            <div className="compare-customer-contact__item compare-customer-contact__item--block compare-customer-contact__notes">
              <span className="compare-customer-contact__label">Notes</span>
              <span className="compare-customer-contact__value compare-customer-contact__value--multiline">
                {customer.notes}
              </span>
            </div>
          ) : null}
        </div>
      </header>

      <section className="compare-section compare-section--jobs">
        <h2 className="compare-section-title">Jobs</h2>
        {jobs.length === 0 ? (
          <p className="product-sub">No jobs yet for this customer.</p>
        ) : (
          <ul className="compare-job-list">
            {jobs.map((j) => (
              <CustomerJobRow
                key={j.id}
                job={j}
                ownerUserId={user.uid}
                deleting={deletingJobId === j.id}
                onDelete={async (job) => {
                  if (
                    !window.confirm(
                      `Delete job “${job.name}”? Slabs and options for this job will be removed. This cannot be undone.`
                    )
                  ) {
                    return;
                  }
                  setDeletingJobId(job.id);
                  setErr(null);
                  try {
                    await deleteJob(job.id, user.uid);
                  } catch (e) {
                    setErr(e instanceof Error ? e.message : "Could not delete job.");
                  } finally {
                    setDeletingJobId(null);
                  }
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <CreateCustomerModal
        open={editOpen}
        initialValues={customerToFormValues(customer)}
        onClose={() => setEditOpen(false)}
        onDelete={async () => {
          await deleteCustomer(customer.id, user.uid);
          navigate("/compare");
        }}
        onSubmit={async (values: CustomerFormValues) => {
          await updateCustomer(customer.id, {
            customerType: values.customerType,
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

      <CreateJobModal
        open={jobOpen}
        onClose={() => setJobOpen(false)}
        onSubmit={async (values: JobFormValues) => {
          const initialAreaName = values.name.trim();
          await createJob(user.uid, {
            customerId,
            name: initialAreaName,
            contactName: values.contactName.trim(),
            contactPhone: values.contactPhone.trim(),
            siteAddress: values.siteAddress.trim(),
            areaType: initialAreaName,
            areas: buildJobAreas(initialAreaName),
            squareFootage: 0,
            notes: values.notes.trim(),
            assumptions: values.assumptions.trim(),
            status: "draft",
            dxfAttachmentUrl: null,
            drawingAttachmentUrl: null,
          });
        }}
      />
    </div>
  );
}
