# Arenal — Prosper voice agent

POC en TypeScript para el track de Prosper. El motor de voz se puede sustituir sin cambiar las reglas de agenda, la persistencia o el protocolo de entrega.

## Arrancar sin claves

Requisitos: Node.js 22.14+ y npm. Si npm 10 falla resolviendo los peers de Vitest (`edgesOut`), usar `npx --yes npm@11.6.0 ci`.

```sh
npm ci
npm run check
npm run evaluate
npm run build
npm start
```

Abrir **http://127.0.0.1:7860**. Pulsa «Preparar reserva de ejemplo», escribe `sí` y finaliza la llamada. Verás la propuesta, los eventos y un recibo simulado. Sin `.env`, usa `text`, clínica sintética y persistencia en `.data/`.

`text` es un laboratorio de comandos, **no un chatbot ni una simulación de calidad de voz**. Las 20 llamadas del evaluador son pruebas sintéticas de aislamiento y entrega, no pruebas oficiales ni un benchmark de latencia.

Desarrollo: `npm run dev` para el servidor; `npm run dev:console` para React en el puerto 5173, con proxy al servidor. El servidor sirve la consola compilada en el puerto 7860.

## Elegir motor

Copiar `.env.example` a `.env` y completar solo las variables necesarias:

| ENGINE | Reconocimiento / conversación / síntesis | Claves |
| --- | --- | --- |
| `text` | Comandos deterministas para probar la aplicación | Ninguna |
| `livekit` | LiveKit Agents + Silero local + ElevenLabs STT/TTS + OpenAI streaming; pausa/reanudación | `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` |
| `pipeline` | ElevenLabs Scribe → OpenAI texto → ElevenLabs Text-to-dialogue | `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` |
| `realtime` | OpenAI Realtime con voz nativa y herramientas | `OPENAI_API_KEY` |

Los modelos se configuran con `OPENAI_TEXT_MODEL` y `OPENAI_REALTIME_MODEL`. Cambiar de familia puede requerir adaptar parámetros propios de su API. GPT-Live y Realtime son APIs distintas: este POC implementa **Realtime**, no GPT-Live. Para incorporar GPT-Live u otro proveedor se añade un adaptador `ConversationEngine`.

`CLINIC=fixture` conserva datos sintéticos aunque uses voz real (los proveedores de voz sí pueden generar costes). `CLINIC=prosper` conecta lecturas y entregas oficiales y exige `PLATFORM_API_KEY`, `TRANSPORT_TOKEN` y un motor de voz. La consola no permite inventar llamadas de Prosper.

Exponer `/ws?token=…` mediante un endpoint **WSS** y registrar esa URL en Prosper. La URL lleva un secreto: no registrarla en logs del proxy. No hace falta Twilio. La aplicación escucha por defecto solo en loopback; para `HOST=0.0.0.0` exige también `CONSOLE_TOKEN`. La consola usa ese token como Bearer, sin almacenarlo en disco.

## Código y decisiones

- [Arquitectura y evolución](docs/architecture.md): límites, flujo, garantías y plan de ampliación.
- [Contratos TypeScript](packages/contracts/src/index.ts): puntos de sustitución.
- [Composition root](apps/server/src/config.ts): selección de proveedores.
- [Documentación del reto archivada](task/README.md).

## Estado real del POC

Hay un recorrido local ejecutable, consola, pipeline de voz, adaptador Realtime, transporte compatible con el contrato, adaptadores Prosper y persistencia memory/file/PostgreSQL. Los tests cubren reglas, cancelaciones, cambios, resultados obsoletos, confirmación, entrega, WebSocket y eventos Realtime simulados.

**No se han realizado llamadas con credenciales reales ni validado el adaptador PostgreSQL contra una base activa.** La cobertura no equivale a superar los 18 problemas. Autorización de familiares, interpretación médica, idiomas, fechas vagas y robustez ante prompt injection todavía necesitan escenarios y endurecimiento específicos. Revisar las limitaciones en arquitectura antes de desplegar réplicas o tratar datos reales.

La consola de diagnóstico contiene transcripciones y propuestas completas. Es una herramienta de desarrollo con datos sintéticos; faltan redacción sistemática, retención, controles de acceso por usuario y cifrado operativo para datos reales.

## Probar con el micrófono del ordenador o móvil

Con `ENGINE=livekit`, `pipeline` o `realtime`, abre la consola, introduce `CONSOLE_TOKEN` y pulsa **Hablar con el agente**. Acepta el permiso del micrófono y utiliza auriculares para reducir eco. El botón **Finalizar prueba de voz** cierra la conexión y libera el micrófono. Cada sesión dura como máximo tres minutos.

Estas llamadas usan la clínica ficticia (Ana García López, DNI `12345678Z`, nacimiento `1988-03-14`, Sanitas), incluso con `CLINIC=prosper`. Las acciones se simulan localmente y nunca se envían a Prosper. Los servicios de voz y modelo sí consumen sus créditos normales.

En el ordenador funciona desde `http://127.0.0.1:7860`. En el móvil abre la URL **HTTPS** del túnel: el acceso al micrófono requiere un contexto seguro. No se necesita Twilio ni número de teléfono.

El adaptador del navegador usa Web Audio/AudioWorklet para convertir la captura a G.711 µ-law de 8 kHz, y reproduce el audio recibido con cancelación local en interrupciones. Un ticket de un solo uso, obtenido con el token de consola y válido durante 30 segundos, autentica el WebSocket `/ws/browser`. Las claves de proveedores permanecen en el servidor.

### Latencia del motor pipeline

El modelo de texto por defecto es `gpt-4.1-mini`; ElevenLabs sigue proporcionando STT y TTS. `OPENAI_TEXT_MODEL` permite cambiarlo. El adaptador omite `reasoning_effort` para GPT-4.1 y envía `none` para GPT-5. Los eventos `latency.model` miden cada ronda del modelo; `latency.first_audio` mide desde la transcripción final hasta el primer fragmento de audio listo para el transporte, separando también la síntesis. No incluye el tiempo previo de detección de fin de turno ni la latencia de reproducción del cliente. `assistant.text` se registra tras entregar todo el audio para preservar la confirmación de propuestas.

### Motor LiveKit e interrupciones

`ENGINE=livekit` usa LiveKit Agents Node 1.9.0 con entradas/salidas propias de audio. Conserva el micrófono web y el WebSocket de Prosper; no requiere sala LiveKit, Twilio ni credenciales nuevas para el modo local. El dominio y el gateway de herramientas siguen siendo los mismos. Silero se carga una vez, pero cada llamada tiene su sesión y estado de detección independientes.

- Silero detecta voz; ElevenLabs Scribe entrega texto parcial/final e idioma. Solo la detección final cambia el idioma del prompt.
- LiveKit controla inicio/fin de turno, interrupciones y cancelación. La generación especulativa se desactiva para evitar ejecutar herramientas antes de confirmar un turno.
- La salida conserva audio durante una pausa y lo reanuda cuando LiveKit identifica una falsa interrupción. Una interrupción confirmada descarta el audio pendiente y permite el siguiente turno.
- La salida entrega paquetes de 20 ms al transporte existente. El progreso representa audio entregado al transporte, no una confirmación de reproducción del altavoz. El pequeño búfer del navegador puede seguir sonando brevemente al pausar.
- La generación de GPT se transmite por streaming. El adaptador TTS conserva ElevenLabs v3 Conversational y sintetiza por frases; no cambia a un modelo con menos idiomas.
- Una respuesta interrumpida se registra como `assistant.interrupted`; nunca marca una propuesta como presentada por completo. La transcripción del fragmento interrumpido puede ser aproximada porque este adaptador TTS no tiene alineación palabra/audio.
- Los eventos `stt.transcript`, `user.state`, `agent.state`, `audio.paused`, `audio.resumed`, `interruption.false` y `latency.first_audio` permiten reconstruir los cortes.

Parámetros iniciales: voz sostenida 350 ms y al menos una palabra para interrumpir; recuperación tras 1500 ms de falsa interrupción; silencio STT 700 ms. Se mantiene una palabra para permitir “no” o “para”. El modo local todavía puede reaccionar a asentimientos y eco: no incluye el clasificador semántico/acústico adaptativo de LiveKit Cloud. El calentamiento AEC del SDK (3 s sin interrupciones) se desactiva; el navegador ya solicita cancelación de eco. Usar auriculares sigue siendo útil al comparar resultados.

`npm test` incluye pruebas del transporte, cancelación, siguiente turno, recuperación automática con VAD simulado y gateway con la sesión real de LiveKit. `npm run test:voice:livekit` ejecuta una prueba con audio sintético, proveedores reales y datos de clínica locales: interrumpe una respuesta, espera la siguiente y comprueba un tercer turno. Consume API, pero no envía resultados a Prosper. Esta prueba no sustituye los 18 escenarios oficiales ni la prueba con micrófono humano.

Referencias: [LiveKit turn handling](https://docs.livekit.io/agents/logic/turns/), [interrupción adaptativa y requisitos de Cloud](https://docs.livekit.io/agents/logic/turns/adaptive-interruption-handling/).

### Laminar: trazas de llamadas

Ejecuta `npx lmnr-cli setup` desde la raíz para autenticarte y añadir
`LMNR_PROJECT_API_KEY` a `.env`. Es opcional: sin clave el servidor funciona sin
exportar trazas. Reinicia el servidor después de cambiarla.

Cada llamada produce una raíz `clinic.call`, identificada por `session_id`
(el ID de llamada) y etiquetas `voice` y el motor. Con LiveKit se añaden sus spans
nativos de generación, voz y turnos, incluidos modelo, tokens y tiempos; las
operaciones de clínica aparecen como `clinic.<herramienta>` con su resultado
booleano. Los demás motores reciben la raíz y las herramientas, pero no los spans
internos de LiveKit. La duración de la raíz corresponde a toda la llamada, no a
la latencia de una respuesta. Exportamos por lotes y vaciamos la cola al apagar.

La integración excluye mensajes, argumentos/resultados clínicos y detalles de
excepciones; no envía grabaciones. Por ello el panel sirve para investigar tiempos,
operaciones y errores, pero no reproduce una transcripción completa. El contexto
de trazado se conserva por llamada para admitir llamadas concurrentes.

Verifica que llegan datos con:

```sh
npx lmnr-cli sql query "SELECT * FROM traces ORDER BY start_time DESC LIMIT 1" --json
```

Abre el proyecto enlazado en Laminar → Traces. `npm test` comprueba el aislamiento
de llamadas y la omisión de datos sensibles en los spans de herramientas.

### Regresiones de las runs de Prosper

`npx tsx scripts/evaluate-run-regressions.ts` reproduce cinco conversaciones
concurrentes inspiradas en los logs, con el modelo real y una clínica/audio
sintéticos; consume API del modelo y **no envía reservas a Prosper**.
Ver `docs/run-audit-2026-09-19.md` para enviado frente a esperado, correcciones,
resultados y bloqueos externos. Para solicitudes de “lo antes posible”, el agente
usa `search_earliest`: las fechas y la lectura de la confirmación se controlan en
la aplicación. Los fallos repetidos de disponibilidad se limitan a dos intentos.
