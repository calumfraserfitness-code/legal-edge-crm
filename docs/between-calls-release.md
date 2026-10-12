# Between Calls implementation — 12 October 2026

The existing CRM HTML now includes a Between Calls navigation item. Its private
review queue uses the deployed `tle-between-calls` function in CRM Supabase
project `fsnzlphhasagfffxdwtq`. The new prospect page is `closer-look.html`.

## Implemented

- Paginated Fathom import using server credentials, idempotent recording IDs,
  and a scheduled 15-minute reconciliation job. Client check-ins are excluded;
  historical sales calls remain eligible even if the lead has since become a client.
- Exact email matching; name matches remain candidates for explicit owner review.
  Bigint lead IDs remain strings to avoid attaching calls to a rounded identifier.
- Conservative transcript rules extract timestamped prospect statements and suggest
  at most one optional video. Speaker attribution is required. This is a rule-based
  processor, **not an activated AI inference service** or a proven lost-sale ranking.
- Secure owner sign-in against the server team register, optional existing server
  owner credential, editable drafts, approve/reject/suppress, and review history.
  Approval never sends an email. No outbound messaging endpoint was added.
- Fathom credential connection validates the key with the provider, then stores it
  encrypted in Vault. Browser state never contains the Fathom credential.
- Live booking reads support verified second-call metadata or an already verified
  next-call time. An untyped calendar appointment is not silently counted as Call 2.
  A past calendar event does not establish attendance.
- Unique prospect denominators, defined windows, and CRM won status. Unknown
  conversions and attendance are not invented.
- Premium mobile resource with nine real website progress-photo references, client
  feedback from the current website, coaching examples and three reading sections.
  Quantitative results, client identities and durations are not inferred from photos.
  Videos are transparently unpublished. No lead form or new booking/payment funnel.
- Three recording scripts in `video-scripts.txt`.

## Private records

Two transcript-verified call reviews were saved to the existing private database.
One records a self-management preference; the other records an expressed need for
external accountability and a verified subsequent conversation. No prospect names,
recording IDs, private URLs, transcript excerpts or lead IDs are included here.
Dates supplied without exact start times remain explicitly time-unverified.

## Validation

- 16 automated domain/endpoint checks passed, including ambiguous matching, exact
  IDs, suppression, stale-edit conflicts, immutable sent records and no-send approval.
- Chromium checks passed for the phone-sized resource, section prioritisation,
  editable review saves, cancellation approval blocking, and original CRM navigation.
  Zero page JavaScript errors. The review screenshot uses clearly labelled QA data.
- Browser image fetches were blocked in this environment. Original image URLs were
  checked through the website retrieval tool; visual delivery of every remote photo
  still needs a live-site check. The resource screenshot records layout only.
- Preparation table has RLS and no anonymous table access. Credential RPCs deny
  anonymous/authenticated execution and require service-role claims.
- Live scheduler request authenticated successfully, returning a truthful 409 for
  the missing provider credential. No successful Fathom sync is claimed.
- Supabase security advisor reported one informational notice for the preparation
  table having RLS without public policies, which is intentional for server-only access.

## Remaining activation and implementation work

1. Vercel preview deployment was rejected with 403: the connected account lacks
   deployment access to team `team_LneZQUnUkNkCrMZbawJal6E9`. No CLI credential is
   available. Frontend production release is not complete.
2. Fathom is not configured in this CRM project. The connected Fathom app works for
   reading calls, but its credential is not available to a deployed scheduled worker.
   Use the new secure connection form after owner sign-in to activate persistence.
3. Verify owner email delivery and allow the deployed URL in Supabase Auth redirect
   settings. No email was sent and no new owner account was silently provisioned.
4. Booking attribution currently lacks a reliable Call 2 type. Enrich the existing
   booking sync or explicitly verify the next-call time before asserting full automatic
   booking/reschedule/cancellation tracking for all prospects.
5. Record/publish the three videos. Publish exact results/durations only after
   verification. Engagement tracking is deliberately not activated without a defined
   consent flow. Deep AI analysis and cohort-level win/loss research remain outstanding.

The release is reviewable code plus a live protected backend, not a claim that all
of issues #2, #3 and #4 are complete. Existing dialling/email workflows were not changed.
