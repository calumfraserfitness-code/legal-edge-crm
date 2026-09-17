# Legal Edge CRM — Phase 2

Phase 2 converts the current single-user browser CRM into a secure, scalable operating system for an owner, coach, closer and dialler.

## Immediate safety changes

- Remove embedded lead and message datasets from the application bundle.
- Treat Supabase as the source of truth on every successful pull.
- Make full sync non-destructive: it may upsert records but never delete whole tables.
- Keep production unchanged until the Phase 2 branch is reviewed and tested.

## Target workspaces

1. **Today** — replies, booked calls, overdue follow-ups, call preparation and automation exceptions.
2. **Sales** — leads, unified activity timeline, offers, objections, pipeline value and conversion reporting.
3. **Dialler** — assigned call queue, outcomes, callbacks and performance.
4. **Closer** — qualified opportunities, first/second calls, proposals, outcomes and revenue.
5. **Coaching** — active/onboarding/paused/past clients, assigned coach, programme and renewals.
6. **Operations** — team access, assignments, connector health, automation log and review queue.

## Data model already available in Supabase

- `tle_leads` — legacy-compatible lead source.
- `tle_activities` — unified calls and message events.
- `tle_opportunities` — structured offers and sales outcomes.
- `tle_clients` — clients/athletes, coaching assignment and renewals.
- `tle_team_members` — owner/admin/coach/closer/dialler roles.
- `tle_automation_log` and `tle_automation_review` — autopilot audit and exceptions.

## Required before team rollout

- Replace the public anonymous database model with Supabase Auth.
- Create role-scoped RLS policies using authenticated user ownership/assignment.
- Move provider credentials into encrypted server-side secrets and rotate exposed credentials.
- Make the GitHub repository private and remove sensitive data from repository history.
- Link the Phase 2 branch to a Vercel preview before production promotion.
