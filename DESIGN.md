---
name: Admisión
description: Panel hospitalario de hash — papel, sistema, un centro por cuenta
colors:
  ink: "#1c1c1a"
  paper: "#f3f2ee"
  rail: "#fafaf8"
  card: "#ffffff"
  muted: "#73726c"
  line: "#e6e4de"
  hover: "#eceae4"
  nav: "#44433e"
  accent: "#1f6f54"
  danger: "#9b2c2c"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "40px"
    fontWeight: 590
    lineHeight: 1.1
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "28px"
    fontWeight: 590
    lineHeight: 1.15
    letterSpacing: "-0.035em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "13.5px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "-0.01em"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.02em"
rounded:
  sm: "8px"
  md: "9px"
  lg: "10px"
  xl: "12px"
spacing:
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "28px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.card}"
    rounded: "{rounded.lg}"
    height: "44px"
    padding: "0 12px"
  button-primary-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.card}"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "44px"
    padding: "0 12px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "16px 18px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.nav}"
    rounded: "{rounded.sm}"
    padding: "7px 10px"
  nav-item-active:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "7px 10px"
  mark:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.card}"
    rounded: "{rounded.md}"
    size: "36px"
---

# Design System: Admisión

## Overview

**Creative North Star: "El mostrador de papel"**

Interfaz de hospital extraída del panel `desk/`: papel cálido, tipo de sistema, cifras tabulares. No hay serif de revista ni marca Prosper. El centro se identifica con un sello de iniciales de color, no con un logo de grupo.

Densidad de producto (Notion/Apple): barra 248px, contenido hasta 860px, bordes de 1px. El verde de acento es raro: punto en vivo y estados guardados.

**Key Characteristics:**
- Papel `#f3f2ee`, tinta `#1c1c1a`, línea `#e6e4de`
- SF / Segoe / Helvetica; pesos 560–650; tracking negativo en cifras
- Tarjetas blancas, radio 12px, sin sombra salvo el anillo de 1px en nav activa
- Un sello por hospital (`.mark`)

## Colors

Paleta corta: papel, tinta, un verde clínico.

### Primary
- **Tinta de admisión** (`{colors.ink}`): texto, botón Entrar, sello por defecto.

### Secondary
- **Verde de línea** (`{colors.accent}`): raro. Punto en vivo, “guardado”.

### Neutral
- **Papel** (`{colors.paper}`): fondo de página
- **Rail** (`{colors.rail}`): barra
- **Tarjeta** (`{colors.card}`): paneles y stats
- **Muda** (`{colors.muted}`): lede, h2, meta
- **Línea** (`{colors.line}`): bordes
- **Hover** (`{colors.hover}`): nav y pistas de barras

**The One Accent Rule.** El verde no pinta fondos ni titulares. Si no es un estado vivo o un guardado, no va.

## Typography

**Display Font:** sistema (-apple-system / Segoe UI / Helvetica)
**Body Font:** la misma pila
**Label/Mono Font:** tabular-nums en stats, no otra familia

**Character:** UI de producto, 14px, tracking −0.01em. Los héroes de euros son 40px / 590, no display serif.

### Hierarchy
- **Display** (590, 40px, −0.04em): cifra anual
- **Headline** (590, 28px, −0.035em): h1 de pantalla
- **Title** (600, 13.5px): nombre del centro en el rail
- **Body** (400, 14px / 1.45): lede y tablas
- **Label** (600, 12–13px, muted): h2 de sección, th

**The Same Face Rule.** No introducir una segunda familia para “dar marca”.

## Layout

Grid `248px | 1fr`. Rail 18/12 padding. Main 28/36/48. Sheet max 860px. Stats 4 columnas, gap 10px. Split 2 columnas. Login centrado, card 440px. A 820px el frame pasa a una columna; stats a 2.

**The Hospital First Rule.** El cromado nombra el centro o el grupo logueado, nunca un directorio ajeno.

## Elevation & Depth

Plano. Profundidad = borde 1px y papel vs blanco. La nav activa usa `box-shadow: 0 0 0 1px {colors.line}` sobre fondo blanco, no drop shadow.

**The Hairline Rule.** Si hace falta alzar, un anillo de 1px. Nada de sombras suaves.

## Shapes

Radios 8 / 9 / 10 / 12. Sello 9px. Botón e input 10px. Panel y stat 12px. Pistas de barras 99px (píldora).

## Components

### Buttons
- **Shape:** 10px, alto 44px
- **Primary:** tinta sobre blanco, sin borde
- **Ghost:** “Salir” en muted, sin caja

### Cards / Containers
- **Corner Style:** 12px
- **Background:** blanco
- **Border:** 1px línea
- **Internal Padding:** 16–18px

### Inputs / Fields
- **Style:** blanco, borde línea, 10px, 44px
- **Error:** texto `#9b2c2c`

### Navigation
- Items 8px radius, padding 7×10. Activo: blanco + anillo 1px + peso 560.

### Hospital mark
Sello 36px, iniciales blancas, peso 650, color por centro (no el verde de acento).

## Do's and Don'ts

### Do:
- **Do** dejar el sello del centro como identidad.
- **Do** tabular las cifras.
- **Do** español de hospital, no de pitch.

### Don't:
- **Don't** Inter, Geist, serif editorial, ni lila SaaS.
- **Don't** listar otros grupos en un login de centro.
- **Don't** pintar de verde más que estados.
