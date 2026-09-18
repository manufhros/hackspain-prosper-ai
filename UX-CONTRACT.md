# Terminal interaction contract

Sources: README.md (workbench workflows), task/contract.md (platform boundary), src/api.ts (explicit submission preview). Visual intent: DESIGN.md. This is a Bun terminal application, with no browser widgets or web routes.

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
Both free chat and case microphone mode use `voice/microphone.ts`. Space starts a take and Space again stops/sends it; Enter is an alias. Esc during capture discards, then returns to caller controls; Esc there ends the call. t opens editable text input. A visible timer and worker-side bound limit each take to 30 seconds. The microphone closes before transcription. Silence retries locally. Cancellation always attempts device cleanup and temporary audio removal. Speaker-labelled transcript turns stay separate from stage diagnostics, follow live updates until the user scrolls back, and resume following with End. Completion keeps a readable transcript and links to the full saved report.

## Verification
Run `bun run check` for finite type and interaction checks and `python3 tests/recording_test.py` for mocked device lifecycle checks. Renderer coverage includes 40×12, 80×24, 90×24, and 120×36 plus empty, long-content, plain-color, and Unicode states. Cases and Docs use the same list/detail controls. Native microphone and interactive terminal QA require the user to start the app; mocked checks do not establish hardware or live UI quality.
