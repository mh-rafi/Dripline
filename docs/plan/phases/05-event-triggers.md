# Phase 5 — Event-based triggers

**Goal:** workflows triggered by things other than list membership.

Tasks:

- Migration: `workflow_events` (raw event log).
- Webhook ingestion endpoint + signing/auth scheme.
- In-app event triggers: campaign link clicked, tag applied.
- Condition/branch step type evaluated against subscriber attributes or event payload.

**Exit criteria:** a webhook POST enrolls a matching contact into a workflow; a condition
step correctly branches based on a subscriber attribute.

**Depends on:** Phase 4.

**Status: exists in code, never exercised end-to-end.** Webhook ingestion and
`link_clicked` triggers are implemented but not yet verified against a real webhook call or
a live click event.

---

**Superseded (2026-08-25) by [Automations v2](../automations_v2.md).** Event triggers are
now registry entries (`apps/api/src/automations/triggers.ts`) fed by one `fireEvent()`
funnel, instead of a `workflow_events` polling scan. Phase 1 of v2 ships `list_applied`,
`list_removed`, `contact_created` and `webhook_incoming` (each automation gets its own
secret webhook URL); link-clicked and campaign-activity triggers move to v2 Phase 4.
