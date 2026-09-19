# Reception kiosk

Start the existing backend with the kiosk enabled, then open the URL **on the same device**:

```sh
bun run serve --edge
# http://127.0.0.1:7860/edge/
```

`bun run serve` remains headless. `--edge` composes with `--dry-run` and `--port` (for example, `bun run serve --edge --dry-run --port 7861`). Starting either mode warms the existing voice stack; it does not open a browser. No separate frontend process, package install, asset build, CDN, or cloud voice SDK is required. Static assets are imported into the Bun server with its text loader.

## Current backend boundary

This repository implements Prosper **test-call** outcomes, not a hospital scheduling connector. Kiosk conversations always use practice mode, even if `/ws` is live. The visible practice notice and closing screen explain that appointments are not recorded. They share the existing receptionist, clinic reads, ASR, TTS, VAD and inference capacity, but never POST synthetic outcomes to Prosper. A production hospital action adapter is a separate backend requirement; do not hide the practice notice until that contract exists.

The frontend has no access to API/provider tokens, tool responses, caller transcripts or patient records. Kiosk call reports/transcripts are not written to disk or printed by this transport. Inference still follows the server's configured local/hosted providers; this is not a claim about provider retention or completely offline operation. See the root README for backend configuration and clinic access.

## Deployment and transport

The browser is intended to run full-screen on the edge computer connected to its microphone and speaker. Use `http://127.0.0.1:<port>/edge/` or `http://localhost:<port>/edge/`; browsers allow microphone access on loopback secure contexts. Grant microphone permission through the browser's normal UI.

All `/edge/` assets require both a loopback peer and a loopback URL hostname. The WebSocket additionally requires the exact same Origin. Forwarded headers are ignored. Thus the kiosk stays inaccessible through the existing Prosper tunnel; `/ws` retains its Bearer-token behavior and no credential is embedded in the screen. Remote browser/LAN kiosk access is deliberately not supported by this local deployment mode.

`/edge/ws?language=es|ca|en` adapts the existing Twilio-shaped protocol. Capture uses an AudioWorklet, weighted downsampling and G.711 mu-law frames (mono, 8 kHz, 160 bytes / 20 ms). Playback schedules real audio and acknowledges marks after playback time. `clear` discards queued sound. Outbound `edge_state` messages carry only `listening`/`thinking`; `edge_end` carries the backend end reason. The screen derives speaking state from received audio. No Web Speech API is used.

Visitors tap to start, select language before a session, pause/resume the microphone, end, or view directions to the staffed reception desk. The help button does not notify staff. Capture never starts automatically. Cancellation, lost connections, hidden pages, microphone loss and a three-minute client deadline release tracks, audio nodes and sockets. A dismissed kiosk session aborts its own pending backend work. Completion/error/help screens return to Spanish welcome after 30 seconds. Nothing is saved in browser storage; there is no displayed transcript for the next visitor.

## Verification

`bun run check` is finite and starts no services. `tests/edge-server.test.ts` covers flag gating, asset headers, local/same-origin admission, unchanged platform auth, capacity release, dry-run completion, cancellation and suppression of reports/traces. `tests/edge-audio.test.js` covers codec reference samples, fractional framing, interleaved wire sequence numbers, discarded playback acknowledgements and locale completeness.

Real speaker/microphone quality, echo cancellation, live inference and physical hospital deployment require a user-started backend and device testing. Mocked browser tests cannot establish those properties.
