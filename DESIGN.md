---
version: alpha
name: Lucía
description: A quiet, editorial workspace for following Clínica Arenal voice calls.
colors:
  primary: "#315c45"
  background: "#fcfcf9"
  sidebar: "#f4f3ee"
  text: "#202c27"
  success: "#337d55"
  warning: "#89601a"
  danger: "#ab4545"
typography:
  sans:
    fontFamily: "DM Sans, sans-serif"
  serif:
    fontFamily: "Instrument Serif, Georgia, serif"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, monospace"
rounded:
  DEFAULT: "8px"
  sm: "5px"
  lg: "16px"
spacing:
  section-gap: "24px"
  header: "70px"
components:
  button: {}
  call-row: {}
  transcript: {}
  tool-run: {}
  dialog: {}
---

# Lucía Design System

## Overview

### Creative North Star

Approved revised option 3: an ivory and forest-green reception desk, editorial headings,
a small sculptural voice avatar, and three quiet columns. Use option 2's explicit call
statuses: En curso, Finalizada, No atendida, with icons and semantic color. Add Error and
Interrumpida when observed state requires them.

### Product context and register

- Audience: operators of the Clínica Arenal inbound scheduling agent; see `task/overview.md`.
- Spanish UI and Europe/Madrid dates. Desktop monitoring, with a usable narrow layout.
- Product register: conversation and execution evidence lead; no marketing hero or KPI tiles.
- Reference: https://mobbin.com/screens/beb9d6b3-ec34-46d7-9332-320fcb32a338 and
  https://mobbin.com/screens/0ce2e993-4b26-4e04-bfeb-ac0a44dc226c.
- Runtime tokens in `public/styles.css` are canonical. This document records their roles.
- No existing frontend or sibling screen was present; settings reuse these tokens and controls.

## Colors

Ivory center, warm-stone history, sage tool panel; forest primary actions. Dark mode uses
charcoal-green surfaces and soft mint accents. Theme can be light, dark, or system and is
applied before first paint. Success, warning and failure always have textual labels.

## Typography

Locally served DM Sans for UI/body, Instrument Serif for wordmark and headings. Native
monospace for tool payloads. Body text 14px, quiet metadata 10–12px, main headings 30–35px.
Dates/durations use tabular numerals; transcript lines remain below 65 characters where possible.

## Layout

Desktop: 70px header, 280px history, flexible transcript, 360px tool history. Each column owns
its scroll region. The document never scrolls; settings has its own scrollable dialog body.
Below 980px, tools replace the conversation on demand. Below 660px, history, conversation,
and tools are individually navigable views. No call search or patient names in URL state;
only opaque selected call ID. Keep mobile back actions visible.

## Elevation & Depth

Flat surfaces and hairline separators. Only modal settings uses a substantial shadow and
backdrop blur. No nested card layout, floating hero, or decorative glow.

## Shapes

8px buttons/fields, 9px selected rows, 16px dialog. Circular avatars and status markers.

## Components

### Foundational visual states

Shared hover, focus-visible, selected, disabled and busy states. Loading, empty, no-results,
offline, persistence error and provider errors have distinct Spanish copy.

### Buttons and actions

Forest primary, outlined secondary, quiet tertiary, red discard. Native buttons, labelled
icon controls, visible 2px focus rings. Provider controls lock while saving/testing.

### Navigation and data display

Only call history in the left sidebar. Newest calls first, grouped by Madrid date. Tool
runs append chronologically, and input/output disclosures preserve their open state.

### Forms and overlays

Native modal dialog owns focus trapping and Escape; dirty provider changes require explicit
discard. Inline validation uses labelled fields and associated errors. Secrets start masked,
can be revealed, and are cleared when closing. No credentials in browser persistence.

### Iconography

Phosphor regular, locally served. UI icons 16–20px. The voice avatar is generated raster
art with transparency at `public/assets/lucia-orb.png`, never an approximate CSS drawing.

### Motion

180ms control feedback, 240ms incoming message/tool entrance, 220ms modal entrance.
Spinner communicates running tools; live dot uses a gentle pulse. Honor OS reduced motion
and the additional app preference. Preserve scroll when the operator is reading history.

### Content and data visualization

Plain Spanish, accurate observed statuses. Provider transcript messages appear as received,
not invented token streaming. Demo data is opt-in and visibly labelled at all times.

## Do's and Don'ts

- Do keep call history, transcript, and actual tool executions distinct.
- Do preserve the selected call and reading position as events arrive.
- Don't fabricate call outcomes, tool steps, or production traffic.
- Don't expose the local console through the public voice-call tunnel.
