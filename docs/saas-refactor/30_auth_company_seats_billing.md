# Auth, Company Context, Seats, and Billing

## Goal

Replace user-only access with company-aware SaaS access.

A signed-in Firebase user should not automatically get app access. They must have:

1. A valid Firebase Auth session
2. An active company membership
3. An active seat or seat exemption
4. A company subscription/trial state that allows app access

## New frontend context

Create:

```txt
src/company/CompanyProvider.tsx
src/company/useCompany.ts
```

The provider should resolve:

```ts
type CompanyContextValue = {
  activeCompany: CompanyDoc | null;
  activeCompanyId: string | null;

  membership: CompanyMemberDoc | null;
  role: CompanyRole | null;

  loading: boolean;
  error: string | null;

  hasActiveSeat: boolean;
  canAccessApp: boolean;

  canManageBilling: boolean;
  canManageUsers: boolean;
  canManageCatalog: boolean;
  canPublishPriceBooks: boolean;
  canViewPrices: boolean;

  switchCompany: (companyId: string) => Promise<void>;
};
```

## AuthProvider changes

Keep `AuthProvider`, but do not overload it with company logic.

`AuthProvider` should only handle:

- Firebase user
- user profile
- sign in
- sign out

`CompanyProvider` should depend on `AuthProvider`.

Provider tree should become:

```tsx
<AuthProvider>
  <CompanyProvider>
    <BrowserRouter>
      ...
    </BrowserRouter>
  </CompanyProvider>
</AuthProvider>
```

## Route guards

Replace the simple `RequireAuth` with layered guards.

Recommended files:

```txt
src/auth/RequireAuth.tsx
src/company/RequireCompany.tsx
src/billing/RequireActiveSubscription.tsx
```

MVP can combine company + billing into one component if needed.

Protected route logic:

```txt
if auth loading -> loading
if no user -> login
if company loading -> loading
if no active company -> company onboarding / create company
if no active membership -> no access
if seat inactive -> seat required screen
if subscription inactive -> billing required screen
else -> outlet
```

## Roles

Use these roles:

```ts
type CompanyRole =
  | "owner"
  | "admin"
  | "manager"
  | "sales"
  | "viewer";
```

Recommended permissions:

| Role    |  Billing | Users | Catalog | Publish Price Books | Jobs |  View Prices |
| ------- | -------: | ----: | ------: | ------------------: | ---: | -----------: |
| owner   |      yes |   yes |     yes |                 yes |  yes |          yes |
| admin   | optional |   yes |     yes |                 yes |  yes |          yes |
| manager |       no |    no |     yes |                 yes |  yes |          yes |
| sales   |       no |    no |      no |                  no |  yes | configurable |
| viewer  |       no |    no |      no |                  no |   no | configurable |

## Seat rules

Each active company has a paid seat limit.

Company doc stores:

```ts
billing.seatLimit
billing.activeSeatCount
billing.status
```

Membership doc stores:

```ts
seatStatus: "active" | "pending" | "disabled" | "exempt";
consumesSeat: boolean;
```

A member can access the app only if:

```ts
membership.status === "active"
&& (membership.seatStatus === "active" || membership.seatStatus === "exempt")
&& company.billing.status in ["trialing", "active"]
```

Allow owner to access billing even if payment is past_due, so they can fix billing.

## Stripe billing

Use Stripe for company subscription and seat purchases.

Do not call Stripe secret APIs from frontend.

Required backend endpoints/functions:

```txt
createCheckoutSession
createBillingPortalSession
handleStripeWebhook
syncCompanyBillingFromStripe
```

Recommended Stripe model:

- One Stripe customer per company
- One subscription per company
- Quantity = seat count
- Products/prices defined in Stripe dashboard
- Subscription metadata includes `companyId`

## Firestore Stripe records

Path:

```txt
stripeCustomers/{companyId}
```

Shape:

```ts
interface StripeCustomerDoc {
  companyId: string;
  stripeCustomerId: string;
  stripeSubscriptionId?: string | null;
  status: CompanyDoc["billing"]["status"];
  seatLimit: number;
  currentPeriodEnd?: Timestamp | null;
  updatedAt: Timestamp;
}
```

The company billing object should be updated by backend webhook code only.

## Billing UI

Add routes:

```txt
/company
/company/settings
/company/billing
/company/users
/company/branding
```

Billing screen should show:

- current plan
- subscription status
- seat count
- active members
- invited members
- manage billing button
- buy/add seats button
- remove/disable seat controls

## Company onboarding

If user signs in and has no company:

Show onboarding:

1. Create company
2. Company name
3. Region/state
4. Branding optional
5. Start trial or choose plan
6. Invite users optional

MVP may create a trial company automatically after company form submit.

## Invites

User flow:

1. Owner/admin invites email.
2. Backend creates `companyInvites/{inviteId}`.
3. Email invite link is sent.
4. Invitee signs in or creates account.
5. Backend validates invite token.
6. Membership created/activated if seat available.
7. If no seat available, invite remains pending and owner is prompted to add seats.

## Important migration rule

Existing users must not be locked out after the refactor.

For existing signed-in users with no company:

- Create a personal company automatically on first login, or
- Show "Create your company" screen and migrate their user-owned records into it.

Recommended MVP:

```txt
On first post-refactor login:
- create company named from displayName/email fallback
- create owner membership
- mark trialing or internal_dev status
- set users/{uid}.defaultCompanyId
```
