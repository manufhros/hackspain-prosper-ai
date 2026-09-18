# El Turno — hackathon workbench

A Bun TUI for rehearsing the Prosper track with a local voice agent on Apple Silicon. It includes the complete task archive, real Prosper clinic reads, automated caller/receptionist conversations, microphone practice, and result comparison.

Add your desk-issued token to a Git-ignored `.env` (see `.env.example`):

```dotenv
PLATFORM_API_KEY=your-team-token
PLATFORM_API_BASE_URL=https://hackspain.getprosperapp.com
```

```sh
bun install
bun start
```

Requires Bun 1.4.2+, Apple Silicon macOS, an interactive terminal, and Homebrew if `uv` or `ollama` is missing. **`bun start` sets up and starts the local stack automatically:**

- Installs missing `uv`/`ollama` using Homebrew and creates a private Python 3.12 environment with locked audio dependencies.
- Downloads Qwen3.5 4B (~3.4 GB), Whisper small for MLX (~481 MB), and Piper English/Spanish/Catalan voices (~190 MB total), plus runtime dependencies. Allow several GB of disk space and time for the first launch.
- Starts its own loopback-only Ollama process and a persistent Python audio worker, warms the models, then shows **Local voice ready**. Cached models/dependencies are reused on later starts.
- Quitting stops only processes owned by this session. An existing Ollama daemon is left alone. A failed setup can be retried from **Voice → Local runtime**.

The stack is sized for your M4 Pro / 48 GB Mac, but no native latency or quality benchmark has been run yet. No paid voice provider, local clinic database, or tunnel is required. Speech smoke tests work without an API token; case rehearsals use the [original Prosper API](https://hackspain.getprosperapp.com/api/redoc). Bun loads `.env` on startup; restart after changing it.

For browsing, manual results, or API exploration without model downloads/startup, use `bun start --offline`. Finite commands such as `bun run doctor` and `bun run check` never start services.

## The workbench

| Section | What you can do |
| --- | --- |
| **Cases** | Search 73 public cases across all 18 problems; read objectives, demographics, language/noise conditions and requirements; reveal acceptable answers; compose all six action types, including multiple intents. |
| **API** | Fill schema-derived forms for all 17 documented routes: health, clinic/catalogues, directory, availability, appointments, submissions and six submit routes. Preview requests and inspect response status, latency and body. |
| **Labs** | Exercise submission deadlines/duplicates, inspect interleaved Twilio traces, probe an existing endpoint with 1/5/10/20 sockets, resolve relative dates, validate DNI/NIE, and rank eligible sites by distance. |
| **Results** | Import an evaluation run; compare every field against all acceptable outcomes; inspect privacy signals; export a diagnostic report. Unattempted cases earn zero. |
| **Docs** | Read every archived Markdown document, including the complete API reference, raw schema and public cases. |
| **Setup** | Configure the API origin, optionally store a key in macOS Keychain instead of `.env`, and set an external endpoint. |
| **Voice** | Start a free conversation, inspect/retry setup, run multilingual speech/model smoke tests, or rehearse all 73 public cases sequentially. |

Use `1`–`7`, `Tab`, or `Shift-Tab` to change sections; each section remembers its selection, search, and scroll. `←`/`→` focus the list or details; arrows or `j`/`k` move in that pane. `PgUp`/`PgDn` scroll details even during voice runs, and `Home`/`End` jump to the beginning/end. `/` searches; `Esc` closes details before clearing the filter. `?` shows all shortcuts. In Cases, `Enter` reads the case, `v` runs a voice rehearsal, `m` opens microphone mode, `e` enters an outcome and `a` reveals answers. `i` imports results; `x` exports a report. `c` cancels a running voice test; `q` or `Ctrl-C` quits. Forms support cursor editing, `Enter` to accept, `Esc` to cancel, and `Ctrl-U` to clear. Set `NO_COLOR=1` for plain rendering. Minimum terminal size is 40×12; at 90 columns the list and details appear side by side, and smaller terminals show the focused pane.

## First rehearsal

**To try it without a script:** press `f` from any section, or open **Voice → Free conversation**. Choose `en`, `es` or `ca`, then talk to the receptionist about whatever you want to test. Press **Space** to start recording and **Space** again to send your reply. Press `t` to type, or Esc to end the call. While recording, Esc discards the take and returns to the caller controls. The recording timer stops automatically at 30 seconds; silence lets you try again. The agent can also finish after you confirm your final intents; press `f` to start another conversation.

Free conversations use the current connection time and real Prosper clinic data, with no case selection, persona, answer key, score, scripted turn cap or three-minute deadline. Individual operations still have their usual timeouts. Transcripts, timings and any proposed actions are saved separately to `.workbench/free-*.json`; case results stay unchanged. Speech remains turn-based and actions remain local. The transcript follows new turns automatically; PgUp pauses following and End resumes it. Microphone controls appear after the receptionist finishes speaking. Availability is limited to the clinic API's published calendar (7 September–16 October 2026).

1. Run `bun start` and wait for local setup to finish. In **Voice**, run **Speech + model smoke tests** to measure English, Spanish and Catalan TTS → 8 kHz mu-law → ASR word error rates and timings.
2. Open **Cases**, select a case and press `v`. A separate local model plays the caller from their public persona/objectives. The receptionist receives the simulated connection time and real clinic tools; neither model receives the expected-answer oracle.
3. Watch the transcript and stage timings. Proposed actions are validated against retrieved patient/slot/appointment IDs and saved locally. The agent has no platform submission tools. `c` cancels; if cancellation interrupts native audio, retry setup before the next call.
4. Press `m` instead to play the caller yourself. Read the objectives, listen to the receptionist, then press Space to start your reply and Space again to send it (up to 30 seconds). macOS may request microphone permission. Press `t` to type instead, Esc while recording to discard, or Esc at the caller controls to end the call. Use headphones to avoid speaker feedback.
5. Inspect **Results** and `.workbench/voice-*-<case-index>.json` for transcripts, stage timings, actions and differences. **Voice → Rehearse all 73 public cases** runs sequentially, checkpointing after each case. Each call has a three-minute budget; a complete run can take hours.

This is a turn-based local rehearsal. It does **not** reproduce the organiser's caller model, published background-noise beds, streaming/barge-in, concurrent-call performance or official scoring. Noise cases currently use clean audio. Clinic reads use the live API while the simulated date uses the archived case timestamp; inspect mismatches if the live world changes. Proposed bookings/cancellations are never written by the voice runner. Use dashboard practice for official evidence.

Local completion is a mock of the track's resolution, not an appointment write. Once the caller accepts the final specific action, the receptionist calls `complete_call` with `{ "actions": [...] }`. The workbench validates the fields and retrieved patient/slot/appointment data, saves the resolution, plays a short closing message, and ends the chat without another model turn or confirmation. Three rejected completion attempts end the run with a visible error instead of an endless loop.

The finished screen and saved free/case reports contain the exact `record: { "actions": [...] }` shape used by the track, plus `platform_submission: false` and a `submission_preview` with one `POST /api/v1/submit/<action>` payload per action. These requests are **never sent**. Their `<start.callSid>` value is an explicit placeholder; only an official test's incoming call ID can replace it, never the local conversation UUID. `REGISTER` retains `new_patient` in the record and flattens its demographics in the submission preview. See [the track contract](task/contract.md#3-post-apiv1submitaction).

For manual evaluation:

1. Start with `bun start --offline`, select a case, and read the caller's objectives. Keep answers hidden while solving it.
2. Press `e`, choose an action, and enter observed values. Add each additional intent separately. `REGISTER` demographics are nested in a result record, but flattened automatically in the corresponding API form.
3. Supply a transcript JSON file if available. Protected-data cases without agent transcript evidence remain **needs_review**.
4. Supply the actual connection timestamp for live results. Blank means you are rehearsing the archived fixture at its saved anchor.
5. Review the differences, or import a whole batch using `i`. Export with `x` before replacing a run to retain results from repeated rehearsals.

For a noninteractive evaluation:

```sh
bun src/cli.ts cases
bun src/cli.ts template > /tmp/turno-results.json
# Fill in the actual records in /tmp/turno-results.json, then:
bun run evaluate /tmp/turno-results.json
```

Results have this format. The record below is only a demonstration, not an agent result:

```json
[
  {
    "case_id": "doctor_and_site-570e40a3f718",
    "reference_time": "2026-09-18T09:00:00+02:00",
    "record": {
      "actions": [{ "action": "NO_ACTION", "reason": "provider_not_found" }]
    },
    "transcript": [
      { "role": "caller", "text": "I only want Dr. Fuentes." },
      { "role": "agent", "text": "That doctor is not in the clinic directory." }
    ]
  }
]
```

The CLI prints JSON and does not save input. Exit code `0` means all supplied results passed the **local** comparison, `1` means a failed/unverified/empty evaluation, and `2` means invalid input. A partial batch can exit `0`; the report always shows attempted coverage against all 73 cases. Use the full template when testing complete coverage. Duplicate case IDs in one run are rejected.

## Live clinic and action testing

The default API origin is `https://hackspain.getprosperapp.com`. `PLATFORM_API_KEY` in `.env` is sent as `X-Api-Key`. `PLATFORM_API_BASE_URL` can override the origin. Environment credentials stay scoped to that origin and are excluded from local model/audio child processes. `.env` is Git-ignored; do not put its contents into reports or commits.

Alternatively, **Setup** accepts a masked key stored using [Bun's native secrets API](https://bun.sh/docs/runtime/secrets) in macOS Keychain. Keys are scoped to the configured origin; `.env` takes precedence for its own origin. Keychain may ask for OS access when first saving/reading a key. The workbench does not print or save tokens in its configuration or reports.

In **API**, select an endpoint and complete its form. Read-only requests require `y` at the preview; an action POST requires typing `submit`. Forms do not prefill from the answer key. Each submission is one real action for the exact `start.callSid`; use the API again for another intent. No automatic retries are made. `409` means an identical action was already accepted; `410` means the window has closed; `200` acknowledges receipt, not success on a case. Previously accepted actions cannot be undone by sending a corrected one, so submit the caller's final request.

Use directory lookups to identify patients, real availability for eligible slots and `payable_with`, and the upcoming appointments endpoint for cancellation/rescheduling IDs. The API explorer does not prove identity, consent, eligibility, patient history or a final spoken confirmation for you.

**Practice, Run All, integration settings and recordings remain dashboard workflows.** They have no routes in the archived public schema. The workbench does not guess private endpoints. The read-only submissions endpoint returns records; it does not expose per-case verdicts or recordings.

## Wire and concurrency diagnostics

The protocol follows the [track contract](task/contract.md) and [Twilio message shapes](https://www.twilio.com/docs/voice/media-streams/websocket-messages). Import an inbound trace with a connection label for each socket:

```json
[
  {
    "connection": "socket-1",
    "message": { "event": "connected", "protocol": "Call", "version": "1.0.0" }
  }
]
```

This incomplete example intentionally reports missing `start`/`stop`. A full trace includes the actual `start`, `media`, and `stop` events. `sequenceNumber`, `chunk`, and `timestamp` must be strings. `start.callSid` is the submission ID. Each inbound 20 ms mu-law frame has 160 bytes.

```sh
bun src/cli.ts trace /path/to/inbound-trace.json
bun run doctor
```

When **you have started** your agent and tunnel, configure its `ws://` or `wss://` URL in Setup and use **Labs → Probe an existing endpoint**. It opens 1/5/10/20 sockets, sends synthetic call IDs and one second of silence in paced frames, observes output for five seconds, and reports malformed output/cross-stream messages. Configure your agent to treat `workbench-…` IDs as local diagnostics; they are not registered platform calls and cannot be submitted there. The probe currently supports endpoints without custom authentication headers. Connecting can incur charges if your agent starts a provider session.

This is a **transport probe**, not a successful call benchmark. It does not speak, recognize speech, test scheduling, mix the published noise recordings, assess language, or verify barge-in. Non-silence bytes do not prove intelligible audio. The 20-session offline self-check tests the workbench's own simulator only. The embedded local voice runner is separate and exposes no public Twilio WebSocket endpoint. Official calls still need that integration and a tunnel.

## What the local comparator does—and its limits

- Reads original fixtures directly from `task/`; no generated answer catalogue or invented clinic data.
- Compares exact IDs and action multiplicity; normalizes demographic accents, surname order, phone/email/national ID, free-text enums and slot instants to the minute. Rejects invalid national IDs, missing offsets and unknown fields. API forms remain strict.
- Assumes multi-action order does not matter locally; the published contract does not explicitly guarantee that tolerance. Confirm it with organisers. Extra/missing/duplicate actions fail.
- Scans **agent** transcript turns for protected IDs/phones, including literal values and digit-by-digit English/Spanish/Catalan. It is not the organiser's complete speech normalizer. Letter names, number phrases and transcription errors still need audio review. `no_leak_detected` is not a privacy certification.
- Flags different Madrid date anchors as **needs_review** rather than declaring an outdated booking answer correct. Invalid records and detected leaks still fail. No live re-anchoring is attempted: the archive lacks the clinic world/availability generator needed to do that reliably.
- Calculates diagnostic weights over all public cases, including unopened problems; this is **not the official leaderboard** (which uses four private cases per open problem). Switchboard has zero weight. Maximum diagnostic weight is 49.

The archive is anchored to **18 September 2026 at 09:00 Europe/Madrid**. Live public answers change daily; release flags in the docs are a snapshot. The source also disagrees on starter-kit availability and treatment of harness failures. See [task provenance](task/README.md). Do not infer current contest state from these saved documents.

The local receptionist is a starting implementation with isolated call state, real clinic tools, slot provenance checks and transcript/timing reports. Remaining product work includes robust identity/consent checks, intent handling under real speech, Twilio streaming and interruption handling, final platform submissions, noise evaluation, concurrent calls, and live practice under load. **Labs → Track & jury readiness** maps the evidence needed across every problem and the jury criteria.

## Local data and verification

The TUI saves the current run to `.workbench/results.json` and configuration to `.workbench/config.json`. Exports are timestamped `.workbench/report-*.json` files; voice runs also save per-case reports and batch checkpoints. The directory is Git-ignored and uses `0700`, with `0600` reports. Reports can contain patient details and conversation transcripts. Raw clinic responses stay in memory. Audio scratch files are removed after each turn; interrupted processes may leave remnants in `.workbench/voice/audio`. Models, voice cards and the Python environment live under `.workbench/voice`. The task archive remains unchanged.

```sh
bun run check
python3 tests/recording_test.py
```

Checks use finite CLI commands, in-memory protocol sessions, mocked inference and mocked HTTP; no servers are started. They cover every archived acceptable outcome as **validator fixtures**, negative/multi-action outcomes, privacy signals, date boundaries, API encoding/statuses, local file permissions, terminal layout, agent tool restrictions/provenance, caller answer isolation, audio cleanup, cancellation, and persistence of failed voice runs. Passing these tests does not verify native installation/inference speed, microphone quality, Keychain integration, a live terminal session, tunnel, or authenticated organiser endpoint.
