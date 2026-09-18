# El Turno — hackathon workbench

A provider-neutral Bun TUI for rehearsing the Prosper track. Browse the complete task archive, enter or import your agent's records, inspect mismatches, explore the clinic API, and test the call contract before choosing a voice provider.

```sh
bun install
bun start
```

Requires Bun 1.4.2 or newer and an interactive terminal. No runtime packages, backend, database, voice provider, or API key are needed for offline use. The tool does not start an environment, agent, server, or tunnel.

## The workbench

| Section | What you can do |
| --- | --- |
| **Cases** | Search 73 public cases across all 18 problems; read objectives, demographics, language/noise conditions and requirements; reveal acceptable answers; compose all six action types, including multiple intents. |
| **API** | Fill schema-derived forms for all 17 documented routes: health, clinic/catalogues, directory, availability, appointments, submissions and six submit routes. Preview requests and inspect response status, latency and body. |
| **Labs** | Exercise submission deadlines/duplicates, inspect interleaved Twilio traces, probe an existing endpoint with 1/5/10/20 sockets, resolve relative dates, validate DNI/NIE, and rank eligible sites by distance. |
| **Results** | Import an evaluation run; compare every field against all acceptable outcomes; inspect privacy signals; export a diagnostic report. Unattempted cases earn zero. |
| **Docs** | Read every archived Markdown document, including the complete API reference, raw schema and public cases. |
| **Setup** | Configure the API origin, store the team key in macOS Keychain, set an existing endpoint, and read the track/jury readiness checklist. |

Use `1`–`6` or `Tab` to change sections, arrows or `j`/`k` to select, `PgUp`/`PgDn` to scroll details, `/` to search, `Enter` to open/run, and `Esc` to clear the current view/filter. In Cases, `e` enters an outcome and `a` reveals answers. `i` imports results; `x` exports a report. `q` or `Ctrl-C` quits. Forms use `Enter` to accept, `Esc` to cancel, and `Ctrl-U` to clear. Set `NO_COLOR=1` for plain rendering. Minimum terminal size is 40×12; 100×30 or larger gives a side-by-side view.

## First rehearsal

1. Start offline, select a case, and read the caller's objectives. Keep answers hidden while solving it.
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

In **Setup**, enter the exact API origin supplied by the desk, then store your team key with masked input. Keys are scoped to that origin and stored using [Bun's native secrets API](https://bun.sh/docs/runtime/secrets), which uses macOS Keychain. No secrets go into config files, `.env`, reports or logs. Keychain may ask for OS access when the user first saves/reads a key.

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

This is a **transport probe**, not a successful call benchmark. It does not speak, recognize speech, test scheduling, mix the published noise recordings, assess language, or verify barge-in. Non-silence bytes do not prove intelligible audio. The 20-session offline self-check tests the workbench's own simulator only. Rehearse real conversations via the dashboard after building the voice pipeline.

## What the local comparator does—and its limits

- Reads original fixtures directly from `task/`; no generated answer catalogue or invented clinic data.
- Compares exact IDs and action multiplicity; normalizes demographic accents, surname order, phone/email/national ID, free-text enums and slot instants to the minute. Rejects invalid national IDs, missing offsets and unknown fields. API forms remain strict.
- Assumes multi-action order does not matter locally; the published contract does not explicitly guarantee that tolerance. Confirm it with organisers. Extra/missing/duplicate actions fail.
- Scans **agent** transcript turns for protected IDs/phones, including literal values and digit-by-digit English/Spanish/Catalan. It is not the organiser's complete speech normalizer. Letter names, number phrases and transcription errors still need audio review. `no_leak_detected` is not a privacy certification.
- Flags different Madrid date anchors as **needs_review** rather than declaring an outdated booking answer correct. Invalid records and detected leaks still fail. No live re-anchoring is attempted: the archive lacks the clinic world/availability generator needed to do that reliably.
- Calculates diagnostic weights over all public cases, including unopened problems; this is **not the official leaderboard** (which uses four private cases per open problem). Switchboard has zero weight. Maximum diagnostic weight is 49.

The archive is anchored to **18 September 2026 at 09:00 Europe/Madrid**. Live public answers change daily; release flags in the docs are a snapshot. The source also disagrees on starter-kit availability and treatment of harness failures. See [task provenance](task/README.md). Do not infer current contest state from these saved documents.

The remaining product work is the actual voice agent: provider selection; isolated per-call reasoning and audio pipelines; identity and caller/patient separation; real clinic tools; policy checks; correction/intent state; timely final submissions; multilingual speech and interruption handling; observability; and live practice under load. **Labs → Track & jury readiness** maps these to every problem and the jury criteria.

## Local data and verification

The TUI saves the current run to `.workbench/results.json` and configuration to `.workbench/config.json`. Exports are timestamped `.workbench/report-*.json` files. The directory is Git-ignored and uses `0700`, with `0600` files. Reports may contain patient details from the imported records. API responses stay in memory unless you independently capture them. The task archive remains unchanged.

```sh
bun run check
```

Checks use finite CLI commands, in-memory protocol sessions and mocked HTTP; no servers are started. They cover every archived acceptable outcome as **validator fixtures**, negative/multi-action outcomes, privacy signals, date boundaries, API encoding/statuses, local file permissions, and terminal layout at multiple sizes. Passing these tests does not verify a live provider, Keychain integration, terminal session, tunnel, or organiser endpoint.
