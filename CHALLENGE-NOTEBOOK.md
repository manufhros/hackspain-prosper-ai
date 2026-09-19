# HackSpain '26 · Prosper Track — Libreta de laboratorio (equipo `hash`)

Registro vivo de qué hemos intentado, qué ha fallado y por qué, para no
tropezar dos veces. Añade entradas arriba del todo (lo más reciente primero).
Si arreglas algo aquí anotado, no borres la entrada: márcala como resuelta y
enlaza el commit.

---

## TL;DR del estado (mantener al día)

- **Puesto:** #3 (mejor Run All = 30/32 del set viejo). vortex 36 · cachopo 33.
- **El juego creció:** el set puntuable pasó de **32 a 40 puntos** (casos nuevos:
  `the_new_patient`, `when_exactly`, `the_rules`, …). Nuestro 30 es del set viejo.
- **Nunca hemos tenido un Run All limpio contra el set de 40.** Los 4 intentos
  desde que creció se quemaron contra endpoint caído o por alucinación bajo carga.
- **Dos agentes en juego:** el de Lucía (ElevenLabs, `feature/lucia-work`, el del
  30/32 probado) y el nuestro white-label sin proveedor (`white-label-voice-agent`).

---

## Reglas de oro (lo que NO hay que repetir)

1. **Nunca dispares Run All contra un endpoint sin verificar.** 4 Run All quemados
   por endpoint caído (`endpoint_unreachable`, `connection_lost`, `missing_record`).
   Antes de cada Run All: health check + un **Call manual que complete un submit**,
   no solo que salude. Cada Run All fallido cuesta ~14 min de cooldown (`private_wait`).
2. **Un solo endpoint puede estar registrado a la vez.** Registrar el tuyo apaga el
   de tu compañero. Coordínalo antes. El Run All de las 00:25 (0/20) fue esto.
3. **Prueba con Call manual (override endpoint), no con Run All.** La UI de Prosper
   tiene "Override endpoint for this call": pega tu `wss://…/ws`, pulsa Call. Es
   público, no gasta Run All, funciona aunque haya un run activo. `switchboard`
   (pesa 0) es el test de concurrencia gratis.
4. **El saludo debe salir instantáneo.** Cualquier `await` antes de hablar = silencio
   en la línea = `agent_silence`. Precalienta el TTS del saludo al arrancar y lanza
   los lookups (directorio) en paralelo, no con await.
5. **El agente no debe inventar ids.** Bajo carga, el LLM alucina ids si no recibe el
   resultado de la tool. Guard: rechazar cualquier `submit_*` con un id que no haya
   aparecido en una búsqueda de esta llamada.
6. **Solo lecturas desde la UI web.** El dashboard (`web/`) es read-only a propósito;
   nunca añadir rutas que muten estado en Prosper.

---

## Anatomía de las señales del harness (qué significan)

| Señal | Significa | Culpa |
|---|---|---|
| `agent_silence` | No habló a tiempo | Nuestra (latencia/saludo) |
| `endpoint_unreachable` | El harness no pudo conectar | Nuestra (túnel/endpoint) |
| `connection_lost` | Se cayó a mitad | Nuestra (crash/carga) |
| `missing_record` | Llamada entró, ningún `submit_*` llegó | Nuestra (turno murió) |
| `record_mismatch` | Envió campos incorrectos | Nuestra (lógica) |
| `wall_clock` | Tardó demasiado | Nuestra (latencia) |
| `harness_socket_error` | Ruido del harness | Suele ser suya (aparece en casos que pasan) |

---

## Fallos que hemos cometido (con causa raíz)

### F5 · El scorer del eval no aplanaba REGISTER — RESUELTO
`the_new_patient` daba 0/4 pero el agente registraba correctamente. El contrato
anida los campos bajo `new_patient`; el agente los manda planos (y la API los
acepta planos). El scorer comparaba sin aplanar. Fix: `flatten()` en `score.ts`.
Tras el fix: **4/4**. Lección: un fallo del eval puede disfrazar un acierto del
agente — mira los datos, no solo el veredicto.

### F4 · Alucinación de ids bajo concurrencia — MITIGADO (guard)
El mismo caso, solo, salía perfecto; en tanda concurrente el agente enviaba ids
inventados (`P1003`, `AT-ORT-GEN` en vez de `P00005`, `orthopaedic_review`).
Causa: bajo carga las tools se degradan (throttling/latencia del gateway) y el
modelo, sin resultado, inventa. **Esta es la causa raíz de que los Run All se
hundieran al crecer el set** (más casos = más concurrencia; `switchboard` = 20 a
la vez). Fix: guard anti-alucinación en `submit_*`. `simple_booking` concurrente
1/4 → 3/4. Pendiente: la latencia en sí (ver Abierto).

### F3 · Cada turno crasheaba (AI_InvalidPromptError) — RESUELTO
Esta versión del AI SDK rechaza mensajes `role:"system"` dentro de `messages`.
El prompt del sistema iba ahí, así que TODOS los turnos reales lanzaban excepción
y caían al fallback "¿me lo repite?". Con endpoint vivo eso puntúa ~0, y a mano
no se veía porque el saludo (cacheado) funcionaba. Fix: prompt por el parámetro
`system` de `generateText`. **Lo destapó el stress test, no la prueba manual.**

### F2 · Saludo con 4,4 s de retraso — RESUELTO
`lookupByPhone` (~730 ms) se esperaba con `await` antes de saludar, y el TTS en
frío tardaba ~3,7 s. Total 4.408 ms de silencio = `agent_silence`. Fix: saludar
primero, hint en paralelo, y precalentar el TTS del saludo al arrancar. → 15 ms.

### F1 · El bug de fechas de la rama de Lucía — EVITADO en la nuestra
Su `search_availability` reseteaba `date_from` a mañana cuando no había sede ni
médico. En sus logs del Run All eso daba `422 date range cannot exceed 14 days`
y slots de fechas que nadie pedía (el modelo alucinaba días). En la nuestra,
`resolveDateRange` respeta la fecha pedida y recorta a 14 días desde ahí.

---

## Cosas que SÍ funcionan (no tocar sin querer)

- **Cerebro determinista partido en dos** (nuestro `src/` raíz): extractor de
  intención (LLM) + capa de reglas (`playbook/`). Más controlable que un LLM libre.
- **`platform/client.ts`** (de Lucía, portado verbatim): reintentos con backoff en
  429/502/503.
- **Guard anti-alucinación** + **prompt por `system`** en el white-label.
- **Eval local** (`bun run eval [problema]`): 73 casos con answer key, dry-run, sin
  harness. Concurrencia por `WL_EVAL_CONCURRENCY`.

---

## Herramientas de diagnóstico que montamos

- `web/` — dashboard read-only de Prosper (Overview, Run All, Tests, Problemas,
  Clínica, Ranking). Refresca cada 5 s si hay run activo. Desplegado en
  `prosperui.vercel.app` (protegido por login de Vercel).
- `scratchpad/stress.ts` — N sockets concurrentes, mide saludo + latencia.
- `scratchpad/stress-turn.ts` — N conversaciones COMPLETAS concurrentes (inyecta
  audio de paciente), mide si el agente responde de verdad. **Aquí se ve la
  latencia bajo carga.**
- `white-label-voice-agent/src/eval/` — eval offline contra `public-cases.json`.

---

## Limitaciones conocidas del eval (leer antes de fiarse del número)

- **El pass-rate del eval NO es un marcador.** `public-cases.json` trae la answer
  key pero NO el mundo congelado (disponibilidad/catálogo). El agente consulta la
  API en vivo → devuelve la disponibilidad de HOY, no la del `reference_time`
  2026-09-18 del caso. Así que el **slot/provider exacto casi nunca coincide, por
  diseño**, y NO se arregla inyectando el reference_time (el problema es la API en
  vivo, no solo el reloj). Corrida completa de ejemplo: 36/73 "pass" pero de los 24
  fallos, ~5 son deriva temporal pura + ~11 deriva de mundo (paciente correcto,
  otro provider) + 13 ERROR por rate-limit. El número real de bugs de lógica es un
  puñado, no 37.
- **Para qué SÍ sirve:** (1) confirmar que no alucina ids — en los fallos, todos
  los `patient_id` eran reales; (2) regresiones estructurales (acción correcta,
  paciente bien identificado); (3) detectar degradación bajo carga (los 13 ERROR
  del final = gateway con rate-limit, mismo enemigo que la latencia).
- **Para qué NO sirve:** puntuar slot/provider exactos. Eso solo lo valida un Call
  real contra Prosper (mundo real, harness real).
- El eval prueba el **cerebro**, no la voz. STT/TTS/VAD/latencia/concurrencia solo
  se ven con un Call real. Necesitas los dos.

### F7 · Tope de presupuesto del AI Gateway ($5) mata el agente — ABIERTO
`Team budget exceeded. Current spend: $5.13, limit: $5.00`. Con el tope agotado,
TODA llamada al gateway (chat/STT/TTS) falla (520/525/561/429). El agente
white-label queda muerto: un switchboard o Run All contra él sacaría 0, no por
concurrencia sino porque no responde. Lo agotamos con el eval de 73 casos + los
stress tests de 20 + generar audio por TTS. Fix: subir/resetear el budget en el
dashboard de Vercel (Team → AI Gateway → Budget). **Vigilar el gasto**: cada
corrida completa del eval cuesta lo suyo. El agente de Lucía usa ElevenLabs, no
el gateway, así que este tope no le afecta — punto a favor de que el Run All
puntuable lo tire su agente mientras esto se arregla.

### F6 · Correr 73 casos concurrentes agota el gateway (rate-limit) — ABIERTO
Los últimos ~13 casos de una corrida de 73 con `WL_EVAL_CONCURRENCY=4` salen como
ERROR. Es el mismo cuello que la latencia: bajo carga sostenida el gateway limita.
Relevante porque un Run All del set de 40 es exactamente carga sostenida.

---

## Abierto / siguiente

- [ ] **Latencia bajo carga** (la palanca que queda para el #1): ~24 s/respuesta con
  20 llamadas a la vez. STT streaming (Deepgram, Lucía ya tiene key) en vez de
  whisper batch; cachear system prompt; reintentar tools bajo throttling.
- [ ] Score limpio del eval: inyectar `reference_time` por caso.
- [ ] Decidir agente para el Run All puntuable (Lucía probado vs nuestro).
- [ ] Rescatar el trabajo sin commitear de `guille-ui` (`src/` del agente
  determinista: reglas + fixtures problems-04-18). Riesgo de perderlo.

---

## Secuencia recomendada para un Run All que puntúe

1. Elegir agente y hacerlo estable + concurrente.
2. `switchboard` por Call manual → confirma que aguanta 20 a la vez sin `connection_lost`.
3. Casos públicos de los problemas nuevos por Call manual hasta que pasen.
4. Health check del endpoint registrado **justo antes**.
5. **Un** Run All limpio.
