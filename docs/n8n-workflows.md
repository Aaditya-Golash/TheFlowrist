# Future n8n workflows

## 1. Daily 6 AM upcoming order scan
- Trigger: schedule
- Internal endpoint: GET /internal/orders/upcoming
- Expected payload: list of scheduled and pending-charge orders for the day
- Manual approval step: concierge reviews the queue before handoff
- Failure fallback: email the admin inbox and log the skipped run

## 2. Pre-charge reminder alert
- Trigger: schedule or webhook
- Internal endpoint: GET /internal/orders/needing-reminder
- Expected payload: orders due for reminder outreach
- Manual approval step: human confirms the reminder before sending
- Failure fallback: record the reminder request and retry later

## 3. Florist assignment needed alert
- Trigger: schedule or webhook
- Internal endpoint: GET /internal/orders/needing-florist
- Expected payload: orders without a florist partner assigned
- Manual approval step: admin selects the florist manually
- Failure fallback: keep the order in the review queue and alert staff

## 4. Florist acceptance follow-up
- Trigger: webhook from florist update or manual review
- Internal endpoint: POST /internal/orders/:id/event
- Expected payload: order id and status note
- Manual approval step: human confirms acceptance before moving the order
- Failure fallback: keep the order in a pending state and notify the admin team

## 5. Delivery confirmation follow-up
- Trigger: scheduled follow-up
- Internal endpoint: POST /internal/orders/:id/status
- Expected payload: order id and delivered status
- Manual approval step: admin verifies proof of delivery
- Failure fallback: leave the order in issue review and escalate

## 6. Post-delivery feedback request
- Trigger: schedule after delivery date
- Internal endpoint: POST /internal/orders/:id/event
- Expected payload: order id and feedback request note
- Manual approval step: concierge decides if outreach is appropriate
- Failure fallback: queue the request for later review

## 7. Issue/refund escalation
- Trigger: issue or refund state
- Internal endpoint: GET /internal/orders/issues
- Expected payload: issue and refund orders for manual review
- Manual approval step: human approves the escalation path
- Failure fallback: create a support task and keep the order visible in admin operations

## 8. Charge execution
- Trigger: schedule, once an order's `plannedChargeDate` has arrived
- Internal endpoint: POST /internal/orders/:id/charge
- Expected payload: `{ ok, orderId, charged, reason? }`; idempotent. Already-charged orders and orders whose protected date was paused/cancelled are safely no-ops.
- Manual approval step: none by design. Charging on the planned date is the automated step this whole system exists to support; disputes/refunds are handled manually afterward.
- Failure fallback: a declined card or missing payment method transitions the order to `issue_reported` rather than silently failing or retrying indefinitely

## 9. Surprise & Delight monthly generation
- Trigger: monthly schedule
- Internal endpoint: POST /internal/surprise/generate
- Optional query: `?month=YYYY-MM` for an explicit generation month
- Expected payload: `{ ok, month, createdCount, orders }`; idempotent for each setting/month pair
- Eligibility: active Signature Concierge membership, active monthly setting, not skipped for the target month
- Manual approval step: concierge reviews generated orders before charge and fulfillment
- Failure fallback: no charge is created by this endpoint. Missing data simply skips that setting until corrected.
