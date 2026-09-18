---
version: alpha
colors:
  accent: "#87ffaf"
  muted: "#8a8a8a"
  status: "#ffaf5f"
  onAccent: "#000000"
typography:
  terminal:
    fontFamily: "monospace"
omitted:
  - section: spacing
    reason: "Layout uses terminal cells, not CSS lengths."
  - section: rounded
    reason: "Terminal panes have no rounded geometry."
---

# El Turno terminal design

## Overview
A compact rehearsal console for hackathon developers. The signature is a readable call transcript with explicit speaker labels and a persistent recording control. Existing green selection and amber status cues remain; content and keyboard focus take priority over decoration.

## Colors
Runtime ownership remains in `src/terminal.ts` → `theme` → shared `render`. `accent` maps to ANSI 256 color 121 (brand and selected background), `muted` to 245, `status` to 215, and `onAccent` to black. Body colors and font are terminal-owned. NO_COLOR removes styling; markers and text retain every state.

## Typography
Use the user's terminal font. Bold labels and underlined pane headings distinguish hierarchy. Wrap prose at words and preserve grapheme clusters in truncation/editing. English controls accompany English, Spanish, and Catalan conversation content.

## Layout
Minimum 40×12 cells. At 90 columns, list and detail share a frame; smaller terminals show the focused pane. Calls and forms use the full detail width. Header, pane heading, status, two action rows, and navigation remain fixed. Detail line ranges reveal scroll position. No animation beyond a recording timer.

## Elevation & Depth
One flat frame, with the active prompt replacing the bottom rows. No stacked overlays.

## Shapes
Cell-aligned panes separated by a single vertical rule. Text markers identify focus without color.

## Components
Shared renderer and input methods in `src/terminal.ts` own all sections. `Workbench` owns focus and session state. Inputs show their title separately from editable text, with a real cursor; secrets stay masked. Help contains the complete shortcut map when space limits the footer.

## Do's and Don'ts
Preserve section position and filters. Keep conversation turns readable and let users pause live following. Do not replace the screen with a scrolling stream of diagnostic messages or depend on color alone. Do not clear the screen between full-frame redraws.
