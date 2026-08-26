# Dripline — Development Plan

Companion doc: [../prd/PRD.md](../prd/PRD.md)

This plan sequences the work in [PRD.md](../prd/PRD.md) into phases, each in its own file
under [phases/](phases/). Each phase file has a goal, tasks, exit criteria, and a **Status**
section kept current with what's actually been built and verified -- not just what was
planned. Phases are built roughly in order; dependencies are noted in each file.

## Phases

| #   | Phase                                                       | Status                                                 |
| --- | ----------------------------------------------------------- | ------------------------------------------------------ |
| 0   | [Project scaffolding](phases/00-scaffolding.md)             | ✅ built & verified                                    |
| 1   | [Subscribers & lists](phases/01-subscribers-lists.md)       | Core CRUD solid; double opt-in confirm flow still open |
| 2   | [Dispatch engine](phases/02-dispatch-engine.md)             | ✅ built & verified                                    |
| 3   | [Connections](phases/03-connections.md)                     | ✅ built & verified                                    |
| 4   | [Automations (drip)](phases/04-automations.md)              | Superseded by [Automations v2](automations_v2.md)      |
| 5   | [Event-based triggers](phases/05-event-triggers.md)         | Superseded by [Automations v2](automations_v2.md)      |
| 6   | [Admin UI](phases/06-admin-ui.md)                           | Most pages browser-verified; lists still API-only      |
| 7   | [Hardening & OSS launch prep](phases/07-hardening.md)       | Partially done, see file                               |
| 8   | [Campaign body editing modes](phases/08-content-editing.md) | ✅ built & verified                                    |

## Other plans (implemented, kept for reference)

- [UI_UX_Plan.md](UI_UX_Plan.md) -- Tailwind/shadcn redesign + theming (Phase 6 addendum).
- [subscriber_bulk_actions.md](subscriber_bulk_actions.md) -- bulk actions + pagination
  (Phase 6 addendum).
- [mailbox_bounce_scanning.md](mailbox_bounce_scanning.md) -- IMAP mailbox-scan bounce
  detection, per-connection (Phase 7 addendum). Planning only, not started.
- [deployment.md](deployment.md) -- packaging and deployment: one container image, four
  supported install paths, automatic migrations (Phase 7 addendum). Built and verified.
- [automations_v2.md](automations_v2.md) -- the visual node-graph automation builder that
  replaces Phases 4 and 5 (canvas + sidebar UI, trigger/action registries, branching
  roadmap). Phase 1 of that plan is built; Phases 2-4 are not started.
- [roles_and_permissions.md](roles_and_permissions.md) -- granular per-resource roles, a
  user/API account type split, and API tokens scoped by role (Phase 1 addendum, replaces
  its original unscoped API keys). Built and verified.

## Explicitly not done

Public archive pages, load testing at scale, GrapesJS CSS inlining (uses a `<style>` block
instead, which very old Outlook versions handle poorly), and committing this repo to git.
A listmonk-to-Dripline import script existed briefly but was removed, unused and never run
against a real listmonk database. The container image
is built and verified locally but not yet published -- the GHCR release workflow first runs
on the first `v*.*.*` tag.

## Open sequencing decisions

- ~~Bounce handling was placed in Phase 7 but arguably needed earlier~~ -- resolved: built
  early (the webhook-based piece), ahead of the rest of Phase 7.
- Admin UI (Phase 6) could have been built incrementally alongside each backend phase
  instead of as one block at the end -- and in practice was: built right after Phase 5.
- Full multi-tenant workspace isolation (separate subscriber pools / RBAC per site) is not
  planned. Explicit per-campaign connection selection (Phase 3) is the intended way to keep
  multiple sites' mail correctly separated by sending domain from one Dripline install;
  revisit only if isolated dashboards or per-site permissions become an actual requirement.
