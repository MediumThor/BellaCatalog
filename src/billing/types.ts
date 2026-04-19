import type { Timestamp } from "firebase/firestore";
import type { CompanyBillingStatus } from "../company/types";

/**
 * Stripe billing type placeholders. The real billing flow lives in backend code
 * (Cloud Functions / Cloud Run). Frontend only reads mirrored Firestore state.
 */

export interface StripeCustomerDoc {
  companyId: string;
  stripeCustomerId: string;
  stripeSubscriptionId?: string | null;
  status: CompanyBillingStatus;
  seatLimit: number;
  currentPeriodEnd?: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface BillingPlanSummary {
  planId: string;
  name: string;
  description?: string;
  pricePerSeatCents: number;
  currency: "usd" | string;
  billingPeriod: "month" | "year";
  includedSeats?: number;
}
