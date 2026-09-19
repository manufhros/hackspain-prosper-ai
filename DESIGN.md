---
version: alpha
colors:
  primary: "#87ffaf"
  muted: "#8a8a8a"
  status: "#ffaf5f"
  onAccent: "#000000"
  kioskPaper: "#edf4f4"
  kioskSurface: "#ffffff"
  kioskInk: "#183b3d"
  kioskMuted: "#496568"
  kioskAccent: "#185c55"
  kioskMint: "#d4e9e3"
typography:
  terminal:
    fontFamily: "monospace"
  kioskDisplay:
    fontFamily: "Avenir Next, Avenir, Segoe UI, sans-serif"
  kioskBody:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
spacing:
  kioskDesktopInset: "52px"
  kioskNarrowInset: "22px"
rounded:
  kioskControl: "22px"
---

# El Turno terminal design

## Overview
A compact rehearsal console for hackathon developers. The signature is a readable call transcript with explicit speaker labels and a persistent recording control. Existing green selection and amber status cues remain; content and keyboard focus take priority over decoration.

## Colors
Runtime ownership remains in `src/terminal.ts` → `theme` → shared `render`. `primary` maps to ANSI 256 color 121 (brand and selected background), `muted` to 245, `status` to 215, and `onAccent` to black. Body colors and font are terminal-owned. NO_COLOR removes styling; markers and text retain every state.

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

## Reception kiosk scope

The terminal rules above remain terminal-specific. The browser reception variant is a quiet public-service screen for a person standing at a shared hospital touch display. Its single job is to begin a voice conversation and make microphone state unmistakable. The visual reference is physical reception wayfinding: broad readable text, one central action, generous clear space. Avoid dashboard panels, diagnostic logs, promotional copy and decorative medical imagery.

Runtime ownership: `src/edge/public/style.css` → `:root` → kiosk components. `kioskPaper`, `kioskSurface`, `kioskInk`, `kioskMuted`, `kioskAccent`, `kioskMint` map respectively to `--paper`, `--surface`, `--ink`, `--muted`, `--accent`, `--mint`. Supporting tokens live in that same runtime owner: hover `#104940`, border `#c4d5d4`, warning `#78561e` on `#f4ead4`, focus `#145fc1`, scrollbar `#708e8b` on `#e3eceb`. No exported/generated theme adapter exists.

Use local Avenir Next/Avenir with Segoe UI fallback for the restrained display heading, system sans for controls and supporting copy. Display size is 38–64px with 1.08 line height; body copy is 17–19px with 1.55 line height. No downloaded font or image is needed. The signature is a five-bar voice symbol within concentric, flat rings: motion indicates listening/speaking, not decorative activity. Respect reduced motion and forced colors.

The page owns natural document scrolling, including at narrow widths and 200% zoom. A 52px desktop inset becomes 22px on narrow screens. The central action is at least 76px tall; language/help controls are at least 48px. Rounded 22px controls and circular voice rings are a deliberate browser variant, not a change to terminal geometry. No shadows or fixed overlays. Status and action regions reserve space through asynchronous transitions. Hover, pressed, disabled and focus states are explicit. Spanish is the initial and reset language; Catalan/English use the same layout and tokens.

During an active kiosk session, the voice symbol contracts to 64px and the main area becomes a chat. Agent bubbles sit on the left in `--surface`, visitor bubbles on the right in `--mint`; both have explicit localized speaker labels. Body text stays 17–19px. The transcript has a 240–440px bounded scroll region while the surrounding page retains document scrolling. Existing scrollbar tokens apply. No entrance animation or automatic smooth scrolling is added. The welcome layout returns after the chat is cleared.
