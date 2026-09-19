# Lucía interaction contract

## Business sources

| Concern           | Source                                     | UI consequence                                                                                        |
| ----------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Call contract     | `task/contract.md`, `src/agent/session.ts` | Observe per-call transcript and tool events without changing scheduling behavior.                     |
| Scheduling        | `task/clinic-api.md`, `src/agent/tools.ts` | Display actual tool results; never synthesize booked outcomes.                                        |
| Console access    | `src/console/http.ts`                      | Loopback socket and localhost Host only; no tunnel/LAN access. Same-origin JSON mutations.            |
| Credentials       | `src/console/provider.ts`                  | Keychain persists provider key and agent ID; environment fallback; no secrets returned.               |
| History lifecycle | `src/console/calls.ts`                     | Up to 200 calls, 400 transcript/tool entries per call. Private local JSON; interrupted after restart. |
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
- Backlog after reconnect comes from a fresh server snapshot. Offline means stale, never live.
- Native details owns tool disclosure behavior; each run has a distinct ID, including repeats.
- Native dialog owns modal semantics; Escape/close asks to discard dirty provider edits. Focus returns to Ajustes.
- Preferences apply immediately in this browser; credentials save only on explicit submit.
- Provider test uses draft credentials for a read-only agent lookup. It neither saves nor updates ElevenLabs.
- Save writes credentials to macOS Keychain and applies to new calls only. An empty key preserves the current one.
- Demo is opt-in, client-only, labelled, and cannot save/test provider settings. Returning to live clears demo state.
- There is no select/listbox, date picker, CRUD table, toast queue, or destructive server action in this UI.
