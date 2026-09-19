# Kiosk verification — 2026-09-19

The backend was not started, restarted or reconfigured for this change.

- `bun run check`: typecheck and all finite tests passed on the combined working tree (including concurrent backend work).
- Browser entrypoint and capture worklet compile for the browser, without frontend dependencies.
- `designmd lint DESIGN.md`: zero errors/warnings.
- Premium strict static audit: zero findings (`.workbench/edge-premium-audit.json`).
- Chromium inspection: 1440×1000 desktop and 390×844 narrow screen; screenshots in `output/playwright/edge-desktop.png` and `edge-mobile.png`. Natural vertical scrolling, no horizontal overflow. 720×500 reflow also checked.
- 21 browser assertions passed: permission-denied recovery, cancellation during a pending permission request, disposal of late-granted tracks, real AudioWorklet processing of a synthetic stream, 160-byte frames, mute/resume, thinking state, speaker-time mark acknowledgement, completion cleanup, disconnect cleanup, staff directions, restored focus, locale switching, narrow/reflow layouts, reduced motion, keyboard start, offline cleanup, hidden-page cleanup, and timed reset to Spanish welcome.

Browser assertions used intercepted static assets/health, a fake WebSocket and synthetic media tracks; they did not call the live backend. The AudioWorklet ran the bundled capture code via an in-memory module because page request interception did not cover its module request. Backend asset serving and access gates were tested separately through the real exported handlers without opening a port. Thus this is browser interaction and audio-lifecycle evidence, not live transport, physical microphone, speaker intelligibility, acoustic echo cancellation, or hospital deployment proof.

The kiosk remains visibly practice-only. A real hospital action adapter and device-level voice validation remain outside this frontend change. To check live voice, the operator starts `bun run serve --edge` and opens its printed local URL.

Design reconciliation: the original terminal palette, renderer and cell geometry remain unchanged. The new public kiosk intentionally adds a light palette, large rounded touch controls, document scrolling and session reset. DESIGN.md documents the scoped runtime tokens and UX-CONTRACT.md records the separate kiosk owners.
