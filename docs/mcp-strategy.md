# MCP strategy

- Playwright MCP is not enabled yet.
- It may only be used later for supervised florist checkout experiments.
- It must stop before payment.
- It must never handle customer card details.
- Postgres MCP should be read-only first.
- MCP tools must not mutate customer or order data without explicit human approval.
