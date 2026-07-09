# Hybrid Offer Pivot Validation

This document crosschecks the hybrid offer implementation against the staged pivot guidance. The generic SaaS, AI, IT-spend, and enterprise examples in the source analysis are not directly relevant to TheFlowerist. The useful takeaway is the operating model: validate demand in stages, keep scope narrow, measure product-market fit, and avoid scaling before the pilot proves retention and willingness to pay.

## Current Strategic Choice

TheFlowerist should treat the hybrid offer as a staged pivot, not a full company-wide pivot.

- Keep the current private-pilot architecture: server-rendered Node, JSON or Supabase storage, pilot users, manual concierge operations.
- Use the new one-time order, Free Datekeeper, annual plans, and Signature-only Surprise & Delight flows to test demand.
- Do not add public self-serve growth loops, Shopify automation, live Stripe keys, weekly flowers, n8n installation, MCP automation, or a rewritten stack before pilot evidence supports it.

## Product Scope Crosscheck

Implemented and aligned:

- One-time concierge orders let customers pay per delivery without forcing a membership.
- Free Datekeeper keeps the low-friction retention layer and caps free protected dates.
- Annual plans monetize memory and concierge reliability, not unlimited flowers.
- Surprise & Delight Monthly is Signature-only and generates scheduled orders without charging immediately.
- Stripe remains test-mode only and annual plans use one-time Checkout payments, not subscriptions.
- Internal generation and charge endpoints remain protected by `INTERNAL_API_SECRET`.

Out of scope for this stage:

- Public guest checkout.
- Subscription billing.
- Weekly flowers.
- Shopify automation.
- Marketplace florist automation.
- Referral loops, QR recipient loops, or public viral mechanics.
- Investor-facing TAM claims without primary research.

## Customer Segments To Validate

Start with narrow customer personas rather than a broad flower market claim.

- Busy partner: wants to remember birthdays, anniversaries, apologies, and quiet emotional moments.
- Adult child: wants to remember parents and family occasions without browsing catalogs.
- High-trust concierge customer: values done-for-you coordination and is willing to pay annual concierge fees.
- Operations admin: needs clear order source, charge timing, florist assignment, and issue visibility.

Pilot interviews should answer:

- What date types matter enough to save?
- Is "membership buys memory, flowers are charged per delivery" clear?
- Does a 7-day self-serve cutoff feel acceptable?
- Does Signature-only monthly surprise feel valuable or too ambiguous?
- What budget tiers feel trustworthy in CAD?

## PMF Signals

Track these manually during the private pilot before adding analytics infrastructure.

- Activation: percent of invited users who add at least one recipient and one protected date.
- One-time order conversion: percent of invited users who create a one-time order.
- Datekeeper retention: percent of users who add a second or third protected date.
- Plan interest: percent of users who click or ask about Thoughtful or Signature.
- Paid validation: number of paid annual plan Checkout completions in test-mode rehearsal, then live only after legal/payment review.
- Surprise interest: percent of Signature users who configure monthly settings.
- Trust friction: users who abandon at payment consent, address entry, or charge reminder.
- Support load: admin minutes per order and manual issue frequency.

Suggested stage gate:

- Continue if invited pilot users understand the model, create repeat protected dates, and ask for reminders or concierge help without heavy prompting.
- Pause or simplify if users confuse annual membership with unlimited flowers, resist payment consent, or do not create more than one meaningful date.

## Unit Economics To Model

Do not rely on broad TAM claims yet. Build a bottom-up model from pilot behavior.

- Per-delivery gross margin by tier after florist cost, delivery fee, Stripe fee, refunds, and support time.
- Annual plan contribution margin after support time and card-message help.
- Monthly Surprise & Delight margin by tier and skipped-month rate.
- CAC by source once acquisition starts: founder referrals, local partnerships, paid social, corporate gifting, or SEO.
- LTV by customer type: one-time-only, Datekeeper-only, annual plan, Signature plus monthly.
- Payback period for any paid acquisition channel.

Healthy early signs:

- Concierge support time drops after the first order for a customer.
- Annual plan customers schedule multiple dates.
- Customers accept reminder-before-charge language without confusion.
- Manual fulfillment can stay profitable at pilot order volume.

## Competitive Positioning

TheFlowerist should not position as a normal florist catalog or a weekly subscription.

Direct alternatives:

- Local florist websites.
- Online flower marketplaces.
- Gift reminder apps.
- Subscription flower services.

Differentiation to preserve:

- Milestone memory first.
- Designer's-choice flowers, not catalog browsing.
- Reminder before charge.
- Local florist coordination.
- Concierge trust and controlled pilot coverage.

## Legal And Trust Checks Before Live Charging

Before switching to live Stripe keys:

- Review payment consent, reminder, cancellation, refund, and delivery-window copy.
- Confirm privacy policy and terms cover recipient addresses, phone numbers, reminders, and payment consent metadata.
- Confirm marketing consent handling for email and SMS.
- Confirm holiday pricing and limited-slot disclaimers.
- Decide the refund and substitution policy for florist non-fulfillment.

## Current Implementation Gaps

These are deliberate gaps, not blockers for localhost testing:

- No live Supabase RLS test against real Supabase Auth sessions.
- No webhook reconciliation for annual plan Checkout.
- No automated scheduler for reminders, charges, or Surprise & Delight generation.
- No built-in analytics dashboard for PMF metrics.
- No legal-reviewed payment/refund policy.
- No acquisition-channel tracking.

## Next Stage

The next stage should be validation, not more automation.

1. Run the private pilot locally or in a controlled Supabase test environment.
2. Interview users after recipient entry, protected-date creation, one-time order creation, and payment consent.
3. Record the PMF and unit-economics signals above in a simple spreadsheet.
4. Only after positive signals, decide whether to add analytics, webhook reconciliation, live payments, or broader acquisition features.
