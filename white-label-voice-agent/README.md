# White-label voice agent

El agente de Clínica Arenal **sin ElevenLabs**: mismo comportamiento que la rama
`feature/lucia-work`, pero el cerebro y la voz corren por el **Vercel AI Gateway**
en vez de por un proveedor de conversational AI.

La lógica de negocio es la de Lucía, que es la que tiene track record probado
(15/20, 16/20 y 15/20 en los Run All puntuables). Lo que cambia es el cableado.

## Qué sustituye a qué

La rama de Lucía delega en ElevenLabs todo lo que va dentro de la caja gris:

```
Twilio  ──►  session.ts  ──►  ┌─────────────────────────────────┐
(mu-law                       │ ElevenLabs Conversational AI    │
 8 kHz)                       │  VAD · STT · LLM · tools · TTS  │
                              └─────────────────────────────────┘
                                            │ client_tool_call
                                            ▼
                                   runClinicTool → Prosper API
```

Aquí esa caja se abre y cada pieza es nuestra:

```
Twilio  ──►  telephony/twilio-session.ts
(mu-law           │
 8 kHz)           ├─ telephony/vad.ts .......... VAD por energía + barge-in
                  ├─ voice/stt.ts .............. AI Gateway  (transcribe)
                  ├─ voice/conversation.ts ..... AI Gateway  (generateText + tools)
                  ├─ voice/tts.ts .............. AI Gateway  (generateSpeech)
                  └─ telephony/audio.ts ........ mu-law ⇄ PCM, resample, wav
                                   │
                                   ▼
                        clinic/tools.ts → platform/client.ts → Prosper API
```

Ningún proveedor de voz propietario: solo el gateway, y los modelos se cambian
por env sin tocar código.

## Qué viene de dónde

| Ruta | Origen |
|---|---|
| `src/platform/*` | Portado **verbatim** de `feature/lucia-work` (cliente Prosper con reintentos 429/502/503) |
| `src/clinic/normalize.ts` | Portado de su `agent/tools.ts` (alias de sede/especialidad, `clinicTodayYmd`, `rankAvailability`) — **con una corrección, ver abajo** |
| `src/clinic/tools.ts` | Sus 9 tools, con las mismas descripciones, convertidas de esquemas de ElevenLabs a tools del AI SDK con Zod |
| `src/voice/prompt.ts` | Su prompt de `scripts/configure-agent.ts`, interpolado local en vez de subido a ElevenLabs |
| `src/telephony/audio.ts` | Del pipeline propio del repo raíz (`src/audio.ts`) |
| `src/telephony/vad.ts`, `src/voice/*`, `src/server.ts` | Nuevo: es justo lo que hacía ElevenLabs |

## La corrección respecto a la rama de Lucía

Una sola, y está marcada en el código (`clinic/normalize.ts` → `resolveDateRange`).

Su `search_availability` reseteaba la fecha pedida cuando no había sede ni médico:

```ts
if (!location_id && !provider_id && dateFrom > firstBookable) dateFrom = firstBookable;
```

En sus propios logs del Run All eso provocó dos cosas: peticiones de
`date_from=2026-10-05` salían como `2026-09-19` y reventaban con
`422 date range cannot exceed 14 days`, y cuando no reventaban devolvían slots
de fechas que nadie había pedido, con el modelo inventando días a partir de ahí.

Aquí se respeta lo que pide el modelo: solo se sube al primer día reservable
(nunca mismo día) y el rango se recorta a 14 días **desde `date_from`**.

También se endureció el prompt en tres puntos que vimos fallar:
`insurer_referral_required` ≠ `referral_required`, médico inexistente →
`provider_not_found`, y no mandar `NO_ACTION` antes de que el paciente rechace
(un `NO_ACTION` seguido de `BOOK` graba dos acciones y tumba el caso).

## Arrancar

```bash
cp .env.example .env    # PLATFORM_API_KEY + AI_GATEWAY_API_KEY
bun install
bun run dev             # ws://localhost:7861/ws
```

Para exponerlo al harness: `ngrok http --region eu 7861` y registrar
`wss://…/ws` como endpoint del equipo en Prosper.

> Solo un endpoint puede estar registrado a la vez. Antes de apuntar este,
> coordínalo con quien tenga el suyo activo: un Run All contra un endpoint
> caído puntúa 0 y quema la espera (pasó a las 00:25, 0/20).

## Pendiente

- **STT en streaming.** `whisper-1` transcribe por lotes: se espera al silencio
  para empezar. Es la mayor fuente de latencia y el sospechoso de los
  `agent_silence`. Deepgram en streaming sería el siguiente paso.
- **Sin tests.** La lógica portada tiene tests en la rama de Lucía y en el
  `src/` del repo raíz; aquí todavía no se han traído.
- **Guard de doble acción.** Hoy `ctx.submitted` solo se registra y se avisa al
  cerrar; no bloquea un segundo submit, porque `REGISTER` + `BOOK` sí es
  legítimo en algunos casos.
