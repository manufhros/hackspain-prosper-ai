# Lucía interaction contract

## Business sources

| Concern           | Source                                     | UI consequence                                                                                        |
| ----------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Call contract     | `task/contract.md`, `src/agent/session.ts` | Observe per-call transcript and tool events without changing scheduling behavior.                     |
| Scheduling        | `task/clinic-api.md`, `src/agent/tools.ts` | Display actual tool results; never synthesize booked outcomes.                                        |
| Console access    | `src/console/http.ts`                      | Loopback socket and localhost Host only; no tunnel/LAN access. Same-origin JSON mutations.            |
| Credentials       | `src/console/provider.ts`                  | Keychain persists provider key and agent ID; environment fallback; no secrets returned.               |
| History lifecycle | `src/console/calls.ts`                     | Up to 200 calls, 400 transcript/tool entries per call. Private local JSON; interrupted after restart. |
| Durable metrics | `src/console/metrics.ts` | Private SQLite metrics survive history pruning. Count distinct calls and confirmed actions; never infer a booking from a request. |
| Billing/deletion  | No console actions                         | No outbound calls, provider creation, billing controls or deletion flows.                             |

## Canonical UI Map

| Capability | Canonical owner                                                      | Source of truth      | Allowed variants                          | Verification                                                                    |
| ---------- | -------------------------------------------------------------------- | -------------------- | ----------------------------------------- | ------------------------------------------------------------------------------- |
| Form       | `public/index.html` provider form and `public/app.js` submitProvider | This contract        | Provider configuration                    | Provider failure and atomic-save unit tests; browser check pending user startup |
| Scrollbar  | `public/styles.css` global baseline                                  | DESIGN.md            | Column/dialog geometry only               | Static audit; browser check pending user startup                                |
| Date       | `public/model.js`                                                    | Europe/Madrid, es-ES | Date groups and timestamps; no date input | Model tests                                                                     |

## Behavior

- Call history is newest first; tools are oldest first. Status is text plus icon, never color alone.
- Selected opaque call ID is restorable in the URL. Search stays in memory because it can contain patient information.
- A call update refreshes its summary and selected detail; other calls never take selection away.
- Transcript follows only when follow is enabled and the operator is already at the bottom.
- Patient bubbles align left and agent bubbles right in both themes. Speaker labels, chronological DOM order, correction markers and scroll-follow behavior remain available on narrow screens.
- Backlog after reconnect comes from a fresh server snapshot. Offline means stale, never live.
- Native details owns tool disclosure behavior; each run has a distinct ID, including repeats.
- `public/tool-presentation.js` owns readable output for all nine tools. Results reflect the returned payload, never the requested outcome. Names resolve only from earlier successful results in the same call; unresolved IDs stay visible. Technical payloads remain available in a nested disclosure, whose open/focus state survives updates.
- Empty, failed, interrupted and pending tool results have distinct Spanish messages. Unknown payloads use labelled fields; malformed text remains readable. All untrusted content is escaped.
- Native dialog owns modal semantics; Escape/close asks to discard dirty provider edits. Focus returns to Ajustes.
- Preferences apply immediately in this browser; credentials save only on explicit submit.
- Provider test uses draft credentials for a read-only agent lookup. It neither saves nor updates ElevenLabs.
- Save writes credentials to macOS Keychain and applies to new calls only. An empty key preserves the current one.
- Demo is opt-in, client-only, labelled, and cannot save/test provider settings. Returning to live clears demo state.
- There is no select/listbox, date picker, CRUD table, toast queue, or destructive server action in this UI.

## Overview

- Header navigation switches between Resumen and Llamadas; the history sidebar remains calls only. URL `view=overview` restores the dashboard, with `period=today|7d|30d|all` for its period. Browser back/forward restores the view.
- All-time totals include every recorded call. The all-time chart shows only the latest 30 days and says so explicitly. Other filters and daily cohorts use the call start date in Europe/Madrid.
- A forwarded call means at least one successful recorded ESCALATE action, not proof of a physical transfer. Action fingerprints deduplicate repeated cumulative receipts within each call. Failed/pending tool requests do not count as actions. Cancellations do not subtract historical bookings.
- The overview owns its scroll region. Its exact-value table is a native disclosure; theme, focus rings, typography, empty and error treatments use the existing console styles. No extra chart library or remotely loaded assets.
- Overview requests cancel on navigation/filter changes. Stale responses cannot replace the current period. Failed refreshes keep prior data with an explicit stale warning; storage errors never return partial totals as valid data. Disclosure focus/open state survives refreshes.
- Simulated calls never enter SQLite. In demo mode the overview explains this and directs the operator to Volver al directo.
