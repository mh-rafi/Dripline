# Phase 4 — Automations v1 (drip)

**Goal:** time-delayed sequences with per-contact state.

Tasks:

- Migrations: `workflows`, `workflow_enrollments`.
- Workflow definition: ordered step list (delay, send-email, add/remove tag/list).
- Enrollment triggers (v1 subset): manual API enrollment, "added to list."
- pg-boss delayed jobs per enrollment step (no polling loop).
- Re-entry rule enforcement (allow/deny re-enrollment).
- Reuses the Phase 2 dispatch engine for the send step -- a workflow's send-email step
  creates a `campaign_emails`-equivalent row, not a separate send path.
- The `send_email` step's connection selection is defined in Phase 3 -- this phase's step
  engine just honors whatever `connection_id` the step config carries.

**Exit criteria:** enroll a contact, verify a 3-step sequence with delays executes correct
steps at correct times across an app restart (delayed jobs survive restart via pg-boss
persistence).

**Depends on:** Phase 2 (dispatch engine reused for send steps); Phase 3 (connection
selection in `send_email`).

**Status: built and verified through completion** (multi-step delayed sequence, real
Postgres).

---

**Superseded (2026-08-25) by [Automations v2](../automations_v2.md).** The flat step array,
the `workflows*` tables and the JSON-textarea UI described above no longer exist: the
migration `1755820800014_automations.sql` drops them and creates the `automations*` tables
with a node graph, a trigger/action registry, and the canvas + sidebar builder. What
carried over unchanged is the execution model — per-contact enrollment, one node per
pg-boss job, delays as future `next_run_at`, and reuse of the connection layer for sends.
