# Clinic OS

Agnostic clinic data platform. Next.js + shadcn. The voice stack is out of this
layer on purpose: any clinic that speaks the EHR contract in
[`task/clinic-api.md`](task/clinic-api.md) can connect here.

Official challenge docs live in [`task/`](task/) (copy of
[overview](https://hackspain.getprosperapp.com/leaderboard/docs/overview)).

## What this is

```
Clinic ERP / Prosper API
        │  GET /api/v1/{clinic,directory,availability,patients/:id/appointments}
        │  POST /api/v1/submit/*
        ▼
lib/clinic          ← ClinicSource (HTTP or fixture)
        │
        ├─ app UI   catalogue, connector, public-case runner
        └─ scripts/run-cases.ts
```

`HttpClinicSource` is a client for **that contract**, not for a vendor. Clínica
Arenal is one implementation. Another clinic maps its ERP onto the same routes
and this app does not change.

Without `CLINIC_API_KEY` the app uses a **fixture** built from the 73 public
cases so the runner works offline.

## Setup

```bash
cp .env.example .env
bun install
bun dev          # http://localhost:3000
bun run cases:run
```

Put the clinic base URL and key in `.env` to switch from the fixture to live data.

## Public cases

[`task/public-cases.json`](task/public-cases.json) is the published practice
roster. **Run all** (UI or CLI) does not dial anyone. For each case it:

1. Looks the persona up in `directory`
2. Checks `availability` when the answer is a booking
3. Checks `appointments` when the answer is cancel/reschedule
4. Treats `REGISTER` as “must not already be on file”

Scoring of a submitted record against `expected.acceptable` lives in
`lib/cases/score.ts` (normalization table from `task/scoring.md`). Wire a voice
agent later; this layer already knows pass/fail.

## Layout

```
app/                 Next.js App Router
components/ui/       shadcn
lib/clinic/          ClinicSource + HTTP adapter + fixture
lib/cases/           public cases, scorer, replay runner
task/                official challenge documentation
scripts/run-cases.ts CLI Run All
```
