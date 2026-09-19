# Clinic OS

Front desk for a clinic that speaks the EHR contract in
[`task/clinic-api.md`](task/clinic-api.md). Any clinic connects with a base URL
and API key. The same tools (directory, availability, appointments, submit) are
what an agent will orchestrate later.

## Screens

- `/` Mostrador — search a patient, chart, book / move / cancel, register
- `/tests` — 73 public cases as fixtures; load one into the desk
- `/settings` — probe a clinic API

The conversation pane uses shadcn `MessageScroller`, `Message`, `Bubble` and
`Marker`. Loading a public case shows the agent greeting, the caller script,
and the expected submit actions.

Without `CLINIC_API_KEY` the desk uses a fixture built from public cases.
Writes apply in memory. Against Prosper, reads are live; submits need a
`call_id` from an open call.

```bash
cp .env.example .env
bun install
bun dev
bun run cases:run
```
