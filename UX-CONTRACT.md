# Terminal interaction contract

Sources: README.md (workbench workflows), task/contract.md (platform boundary), src/api.ts (explicit submission preview). Visual intent: DESIGN.md. The workbench is a Bun terminal application. The opt-in `/edge/` reception kiosk is a separate patient-facing variant served by the same backend.

## Canonical UI map

| Capability | Owner | Variants | Verification |
| --- | --- | --- | --- |
| Navigation and selection | Workbench.handleKey, terminal.render | list/detail; narrow/split | tests/interaction.test.ts, tests/labs-terminal.test.ts |
| Form | Terminal.ask, Workbench.fields | text, masked secret | tests/terminal-input.test.ts |
| Feedback and scrolling | terminal.render, Workbench.show | result, error, busy, live | tests/labs-terminal.test.ts |
| Direct shortcuts | Terminal.choose | caller input, recording | tests/terminal-input.test.ts |

## Navigation and state
Tab / Shift-Tab or 1–7 switch sections and preserve selection, committed search, and scroll. Left/Right focus list/details. Up/Down and j/k act on the focused pane. Enter opens case details; e explicitly composes an outcome. Home/End jump to the beginning/end. PgUp/PgDn always scroll details, including during pending work. Esc closes details before clearing search. ? toggles help. No-match views offer search and clear actions.

## Input, actions, and recovery
Prompts own keystrokes; application shortcuts do not run while typing. Arrow keys, Home/End, Delete/Backspace, and Ctrl-U edit. Enter accepts; Esc cancels. Secrets remain masked and Keychain-only. Pending tasks prevent duplicate actions. Errors appear in the detail pane; no automatic mutation retries. API writes retain their explicit request preview and typed submit confirmation. Voice actions remain local.

## Conversation and microphone
Both free chat and case microphone mode use `voice/microphone.ts`. Space starts a take and Space again stops/sends it; Enter is an alias. Esc during capture discards, then returns to caller controls; Esc there ends the call. t opens editable text input. A visible timer and worker-side bound limit each take to 30 seconds. The microphone closes before transcription. Silence retries locally. Cancellation always attempts device cleanup and temporary audio removal. Speaker-labelled transcript turns stay separate from stage diagnostics, follow live updates until the user scrolls back, and resume following with End. Completion is terminal after a validated local resolution: play the localized closing statement without another model turn, show the exact track record before the transcript, and retain a never-sent submission preview with an explicit call ID placeholder. Three invalid completion attempts end with an error. The full report remains saved.

## Verification
Run `bun run check` for finite type and interaction checks and `python3 tests/recording_test.py` for mocked device lifecycle checks. Renderer coverage includes 40×12, 80×24, 90×24, and 120×36 plus empty, long-content, plain-color, and Unicode states. Cases and Docs use the same list/detail controls. Native microphone and interactive terminal QA require the user to start the app; mocked checks do not establish hardware or live UI quality.

## Reception kiosk variant

Source: current edge-screen brief, `src/edge/README.md`, `src/telephony/server.ts`, `src/telephony/call.ts`, and `src/protocol.ts`. The existing backend owns all scheduling/identity/consent logic. The browser sends microphone audio only. Practice mode is always visible; the UI cannot claim a real appointment was registered. No new legal, retention or medical-policy copy is introduced.

| Capability | Canonical owner | Source of truth | Variant | Verification |
| --- | --- | --- | --- | --- |
| Voice controls / feedback | `src/edge/public/app.js` | protocol and backend call states | public kiosk; touch and keyboard | `tests/edge-server.test.ts`, browser QA |
| Locale | `src/edge/public/locale.js` | supported backend languages | Spanish default, Catalan, English | `tests/edge-audio.test.js` |
| Scrollbar / tokens | `src/edge/public/style.css` | DESIGN.md kiosk scope | document owns scrolling | browser QA |
| Audio capture / playback | `src/edge/public/audio.js`, `capture.js` | `src/protocol.ts` | browser device rather than terminal | `tests/edge-audio.test.js` |

Native buttons own all actions. Controls stay disabled until their listeners are installed. The patient chooses a language before starting; controls are locked during a session. A start gesture requests browser microphone permission and unlocks audio. Loading, listening, thinking, speaking, paused, completion, error and in-person-help states occupy the same central region, with polite status announcements. Active sessions show a live, speaker-labelled chat of recognized visitor utterances and agent replies when their audio begins; interrupted audio is labelled. Tool/reasoning traces are excluded. Messages are plain text, never rendered as HTML. The chat owns its bounded vertical scroll region; scrolling up suspends following, and a latest-messages button restores it. Failure never silently reconnects or repeats actions. Human-help directions never pretend to dispatch a staff member.

Ending, leaving or hiding the page closes capture and playback and aborts the session. Late microphone permission is discarded if its session is no longer current. End/error/help states reset after 30 seconds. The chat DOM clears immediately on completion, ending, error, help or hiding the page. Browser storage is unused and the kiosk adapter suppresses its call reports and console transcript; provider behavior remains governed by backend configuration. Only same-device, same-origin WebSocket sessions may enter this credential-free transport. Platform Bearer authentication remains separate and unchanged.

The terminal retains its established visual/interaction contract; kiosk controls intentionally use larger touch targets, a light palette and automatic reset for shared-screen use. Browser and physical-device evidence are reported separately from finite automated tests.
