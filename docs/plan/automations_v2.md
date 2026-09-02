# Automations v2 — visual, node-based automation builder

Replaces the Phase 4/5 "workflows" feature ([phases/04-automations.md](phases/04-automations.md),
[phases/05-event-triggers.md](phases/05-event-triggers.md)) with a professional CRM-style
automation builder: a trigger + a canvas of action nodes, edited entirely through a
right-hand settings sidebar.

The old feature stays conceptually (per-contact enrollment, pg-boss delayed execution,
reuse of the connection/dispatch layer) — what changes is the data model (flat step array
→ node graph), the extensibility model (hardcoded switch → trigger/action registries), and
the UI (JSON textarea → canvas + sidebar).

## Decisions (agreed up front)

| Decision      | Choice                                                                  |
| ------------- | ----------------------------------------------------------------------- |
| Naming        | Full rename: `workflows` → `automations` in DB, API, UI routes and code |
| Old data      | Hard cutover — old `workflows*` tables are dropped, nothing is migrated |
| Canvas        | `@xyflow/react` (React Flow) with custom node + custom edge components  |
| Phase 1 scope | Foundation + core actions (see below); branching explicitly deferred    |

## Core model

### Automation

```
automations(id, uuid, name, status, trigger_type, trigger_config, graph, reentry_mode, ...)
```

- `status`: `draft` | `published` | `paused`. Only `published` automations enroll contacts.
- `trigger_type` + `trigger_config`: one trigger per automation for now. The column pair
  (rather than a node inside the graph) keeps trigger matching a cheap indexed query —
  `WHERE status='published' AND trigger_type=$1` — instead of a JSONB scan of every graph.
  Multiple triggers per automation, if ever needed, becomes a `triggers` JSONB array
  without touching the graph shape.
- `reentry_mode`: `once` (a contact can only ever run through once) | `multiple`.

### Graph

`graph` is JSONB with pointer edges, **not** an ordered array — pointers are what make the
future yes/no branching possible without a second model:

```jsonc
{
  "entry": "n_a1b2", // first node after the trigger, null when empty
  "nodes": [
    {
      "id": "n_a1b2", // client-generated, stable for the node's lifetime
      "type": "wait", // registry key
      "title": "", // optional internal note title (shown on the block)
      "note": "", // optional internal note / description
      "config": { "unit": "days", "amount": 3 },
      "next": "n_c3d4", // null = end of this path
    },
  ],
}
```

A future `condition` node carries `branches: { yes: <id|null>, no: <id|null> }` alongside
(instead of) `next`; the engine already routes through a `goto` result, so branching is a
new node type plus canvas layout — not an engine rewrite.

### Enrollment

```
automation_enrollments(id, automation_id, subscriber_id, status, current_node_id,
                       next_run_at, context, started_at, completed_at)
```

`current_node_id` is a node id (text) rather than an integer index, so editing an
automation while contacts are mid-flight doesn't silently shift everyone's position. A
contact sitting on a node the author deleted simply completes.

## Extensibility: the two registries

The whole point of the redesign. Adding a trigger or an action is **one entry on each
side**, no engine or canvas changes.

### API — `apps/api/src/automations/`

```ts
interface TriggerDef<C> {
  type: string; // registry key, stored in automations.trigger_type
  label: string;
  description: string; // help text shown in the create dialog
  configSchema: ZodType<C>;
  createDefaults?(): C; // e.g. generate a webhook key at creation time
  matches(config: C, event: AutomationEvent): boolean;
}

interface ActionDef<C> {
  type: string; // registry key, stored on the node
  label: string;
  description: string;
  group: "timing" | "contact" | "email" | "integration";
  configSchema: ZodType<C>;
  execute(ctx: ActionContext<C>): Promise<ActionResult>;
}

type ActionResult =
  | { kind: "advance"; delayUntil?: Date } // continue to node.next
  | { kind: "goto"; nodeId: string | null; delayUntil?: Date } // branching hook
  | { kind: "retry"; delayUntil?: Date } // re-run this node later
  | { kind: "stop"; status: "completed" | "cancelled" };
```

Events reach triggers through one funnel:

```ts
fireEvent(db, { type: "list_applied", subscriberId, data: { listId } });
```

which selects published automations with that `trigger_type`, parses each one's
`trigger_config` with the trigger's own schema, calls `matches()`, and enrolls.

### Web — `apps/web/src/automations/registry.tsx`

Mirror registry: `{ type, label, description, icon, group, defaultConfig, Settings }`
where `Settings` is the React component the sidebar renders for that node type. The canvas
and sidebar are generic; they never switch on a node type.

## Execution engine

Unchanged in spirit from Phase 4 (pg-boss scan → per-enrollment step job, one node per
invocation, durable across restarts). Differences:

- Step resolution is `graph.nodes.find(n => n.id === current_node_id)` instead of an index.
- The action's `execute()` result decides the transition; the engine only persists it.
- `wait` is an ordinary action that returns `{ kind: "advance", delayUntil }` — it moves
  the contact onto the next node but holds `next_run_at` in the future.
- Blocklisted contacts cancel their enrollment on the next tick, as before.

## Phases

Each phase is independently usable.

### Phase 1 — foundation + core actions — **built & verified**

- Migration: drop `workflows`, `workflow_enrollments`, `workflow_events`; create
  `automations`, `automation_enrollments`, `automation_events`.
- Trigger registry + triggers: **list applied**, **list removed**, **contact created**,
  **incoming webhook** (each automation gets its own secret webhook URL).
- Action registry + actions: **wait** (minutes/hours/days), **send custom email**,
  **apply list**, **remove list**.
- Event funnel wired into the existing mutation paths: `addToList`, `addToListForImport`,
  `removeFromList`, bulk list add/remove, subscriber create (single, import, webhook).
- API: full CRUD, publish/pause, manual enrollment, enrollment listing, webhook ingress.
- UI: `/automations` list page; create dialog (name + selectable trigger cards with help
  text + Continue); `/automations/:id` canvas (React Flow, trigger block, action blocks,
  `+` buttons on edges); right sidebar as the single editing surface for triggers,
  action picking, and action settings.

Verified against real Postgres (21 checks, driven through the HTTP surface plus the engine
directly): create/save/publish, structural graph validation (dangling edge rejected),
publish refused while a node is unconfigured or the graph is empty, `list_applied` enrolling
a contact, each node type executing and advancing, the wait node scheduling ~24h out on the
_next_ node, `reentry_mode: once` blocking a second run, the unauthenticated webhook
endpoint creating and enrolling a contact (and an unknown key enrolling nobody),
`contact_created` firing exactly once per genuinely new contact, and bulk list changes
enrolling only when `trigger_automations` is set.

Decisions made while building it:

- **Bulk list changes are opt-in.** `bulkLists()` previously fired no triggers at all, on
  purpose. Now it can, but only when the caller passes `trigger_automations: true` (the
  bulk dialog has a checkbox, off by default) -- one admin action must not silently enrol
  thousands of contacts.
- **Automation email unsubscribes.** An automation isn't list-scoped like a campaign, so
  its one-click List-Unsubscribe target is a new endpoint
  (`/api/v1/unsubscribe/automation/:automationUuid/:subscriberUuid`) that leaves every list.
  The visible link still points at the existing per-list preference page, which only needs
  a valid signature.
- **Publish-time config validation.** Structure is validated on every save; per-node config
  only when publishing. Otherwise a step could never be saved half-finished, which is what
  the sidebar does constantly.
- **Required fields are flagged on the block, not just at publish.** Each web
  registry entry carries a `validate(config)` mirroring its API zod schema; the
  canvas renders a yellow warning on any block that isn't ready, with a tooltip
  naming what's missing. The API stays the enforcement point (publish is
  refused); this only means nobody has to hit publish to discover it.
- **List triggers require at least one list.** Empty `list_ids` briefly meant
  "any list"; that made the warning icon a lie and, worse, an unconfigured
  trigger would mail everyone who joined anything. An empty selection now fails
  to parse, so it neither publishes nor matches.
- **`send_custom_email` requires an explicit connection** (and a non-empty
  body). It was optional, which let an automation be published that could never
  send -- the chain resolved empty and every email was dropped at send time.
- **`send_custom_email`'s template is optional and defaults to none.** It wraps
  the body in the chosen template's `{{ Body }}` slot exactly as campaigns do
  (wrap first, render merge fields second, so the template body can use them
  too), and is skipped for `content_type: "plain"` -- a template body is HTML.
  Defaulting to no template rather than to the default template is deliberate:
  the field can be added to an existing install without changing a single byte
  of what an already-published automation puts on the wire. A `template_id`
  pointing at a since-deleted template falls back to the bare body rather than
  failing the send and stranding the contact on the node.
- **A published automation can still be edited into an incomplete state** --
  graph saves aren't re-validated, deliberately, or you couldn't add a block to
  a live automation and configure it afterwards. The warning icon is what
  surfaces this; the engine logs and skips a node whose config no longer parses.
- **Test sends go through the action's own renderer, not the campaign one.**
  `POST /automations/:id/test` exists because `POST /campaigns/:id/test` can't
  be reused: it loads a campaign row, resolves _that campaign's_ connection
  chain, and renders a `Campaign.*` merge context with campaign-scoped
  unsubscribe links. An email step has an explicit chain of its own and an
  `Automation.*` context. So the render half of `send_custom_email` was pulled
  out into `automations/email.ts` (`renderAutomationEmail`, plus the config
  schema both the action and the route validate against) -- the action and the
  test endpoint call the same function, which is what makes a test faithful to
  what the live automation sends. `POST /automations/:id/preview` rides the same
  renderer. The web side genuinely is reused: `EmailHistoryInput`,
  `useEmailHistory` and `PreviewModal` are all shared with the campaign page, so
  the two features draw on one address history and one preview pane.
- **Preview validates a looser schema than a send.** The config schema is split
  into `SendCustomEmailContent` (what the email says) and the delivery fields
  layered on top, because you preview a step that has no connection picked yet
  and often no subject typed yet -- `SendCustomEmailPreview` defaults both to
  empty rather than refusing to render. Only the send paths require the full
  `SendCustomEmailConfig`.
- **Open/click tracking is per node, and the node is interned.** Attribution had
  to be per step -- "clicks on this automation" across a five-email drip is not
  a number anyone can act on. The existing tables couldn't carry it
  (`campaign_views.campaign_id` is `NOT NULL REFERENCES campaigns(id)`, and
  `link_clicks` is decoded from a campaign-encoded URL), so
  `automation_views` / `automation_link_clicks` are their own rows. Both point
  at `automation_email_nodes`, which interns an (automation, node) pair the way
  `links` interns a URL: node ids are arbitrary strings, and putting one in the
  path would blow the ~120-character budget from
  [deliverability.md](deliverability.md). The URL carries one base62 id
  instead, so `/al/` and `/ao/` are the same length as `/l/` and `/o/`. Their
  signature prefixes differ (`al`/`ao` vs `l`/`o`) so a campaign URL cannot be
  replayed against an automation endpoint with the same ids. The shared `links`
  table is reused as-is -- URL interning was never campaign-scoped.
- **`automation_email_sends` exists to be a denominator.** Without it an open
  count is a number with nothing to be a rate of; enrollments can't stand in,
  since `reentry_mode: "multiple"` sends the same node to the same contact more
  than once and each pass is a real email. Logged even when both toggles are
  off, so switching tracking on later still has a "sent" figure beside it.
- **`track_opens`/`track_clicks` default to false in the schema, true in the
  builder.** Defaulting the schema to true would start rewriting links and
  adding a pixel to what already-published automations put on the wire; the
  builder's `defaultConfig` turns both on for _new_ nodes, so the expected
  default applies only where it is safe. Same shape as the `template_id`
  decision above.
- **Previews and test sends are never tracked.** `renderAutomationEmail` only
  emits a pixel or rewrites links when the caller passes `tracking`, and only
  the live action does. Otherwise an author previewing their own draft would
  register as an open against the node, and every test send would inflate its
  stats. (Campaign test sends do not make this distinction -- they render with
  the campaign's real tracking flags. Left alone here as out of scope, but it
  is the same bug.)
- **The visual (GrapesJS) editing mode is left out of automation emails** -- it needs far
  more room than a 520px sidebar. `ContentTypeEditor` grew an `allowedTypes` prop for this.

### Phase 2 — the rest of the action set + observability

- Actions: **update contact property**, **outgoing webhook**, **send email from an
  existing campaign**.
- Per-node run logging (`automation_node_runs`) → the Stats toggle on the canvas showing
  per-block counts, plus a per-enrollment activity trail.
- ~~Open/click tracking for automation emails~~ -- **done**, per node. See the decision
  below; what remains here is the general `automation_node_runs` log for every node type,
  which the canvas Stats overlay needs.

### Phase 3 — conditional branching

- `condition` node type with `branches.yes` / `branches.no`, rendered as two lanes on the
  canvas with its own layout pass.
- Condition registry (same shape as the action registry): contact field match, email,
  name, attribute match, list membership, tag.
- Engine support is already there (`goto`); the work is the condition registry, the
  branch-aware canvas layout, and the sidebar condition builder.

### Phase 4 — advanced conditions, more triggers, reporting

- Activity conditions: opened / clicked / was sent a campaign before, after, or within N
  days.
- More triggers: link clicked, email opened, campaign sent, tag applied/removed, date or
  anniversary reached.
- Goals and exit conditions (leave the automation early when a goal is met).
- Reports view (`View Reports` in the reference UI): funnel completion, per-node
  conversion, email performance.

## Notes / deliberate limits

- Trigger matching is intentionally a plain equality query on `trigger_type` plus an
  in-process `matches()` call. A published automation count in the thousands would justify
  indexing `trigger_config`, not before.
- The bulk list endpoints fire per-affected-contact events, so a bulk add of 50k contacts
  to a list enrolls 50k contacts. That is the correct behaviour, but it is a large burst;
  pacing/throttling of enrollment bursts is a Phase 4 concern.
- `send custom email` requires an explicit connection (like the old `send_email` step) —
  no implicit "first enabled connection" fallback, for the cross-domain reason documented
  in `services/connections.ts`.
