# Operaciones

Integración sobre `feature/lucia-work` (base `d282f1f`). Entrada: **Panel → Operaciones**,
`/panel/operaciones`. El panel original de llamadas y las pruebas de micrófono se conservan.

## Modos

- **Demo mock**: tres conversaciones locales; reproducir, pausar, avanzar y reiniciar.
  Sin llamadas a proveedores. Saludo inicial en español; idioma tras la primera respuesta.
- **Ensayar sin teléfono**: tres pacientes de prueba verificados en Prosper. Vercel AI Gateway
  (`SIMULATOR_MODEL`, por defecto `openai/gpt-4.1-mini`) responde como paciente; ElevenLabs
  ejecuta el mismo `handleCall`, herramientas y configuración de la rama.
  Estas tres conversaciones son de texto, no sintetizan audio.
- **Start demo**: lo anterior + una llamada a **TWILIO_HUMAN_NUMBER**. El móvil inicia una
  cuarta sesión como **paciente**, no se incorpora como empleado a otra conversación.
- **Micrófono**: acceso al simulador de voz existente de Lucía. Ese simulador conserva
  sus propias reglas de herramientas y transferencia; no es el ensayo aislado de Operaciones.

El monitor muestra mensajes, idioma detectado, herramientas y resultados. Una solicitud
fallida no cuenta como reserva. Las acciones de Operaciones están marcadas como simuladas:
no se escriben citas, altas, cancelaciones ni escalados en Prosper. Tampoco se llaman
los webhooks pre/post de la clínica. El escalado de un paciente LLM no genera otra llamada.

## Local

Requisitos: Node 24 (los tests existentes usan `node:module.registerHooks`), dependencias
de raíz y desk instaladas con `npm ci` y `npm --prefix desk ci`.

Con las credenciales en el `.env` de esta copia:

```sh
npm run agent:configure
npm run operations:dev
```

Se abren el servidor de voz existente (7860) y Next.js (3100); el comando genera un
secreto efímero compartido entre ambos sin guardarlo ni mostrarlo. Para cambiar puertos:
`PORT=7862 DESK_PORT=3102 npm run operations:dev`.

Se puede entrar con la cuenta demo `admin@turno.app` o `voz@turno.app`.
La autenticación por cookie/cuentas fijas es la de la rama: **no es autenticación de producción**.

Variables:

- `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `PLATFORM_API_KEY`, `AI_GATEWAY_API_KEY`.
- Opcional: `PLATFORM_API_BASE_URL`, `SIMULATOR_MODEL` (formato `proveedor/modelo`).
- Para teléfono: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (o API key SID/secret),
  `TWILIO_PHONE_NUMBER`, `VOICE_AGENT_PUBLIC_URL=https://tu-dominio`.
  La URL debe llegar al servidor de voz; se verifica antes de originar la llamada.
- Si ejecutas los procesos por separado: mismo `OPERATIONS_SECRET` aleatorio de al menos
  32 caracteres en ambos; `OPERATIONS_API_URL` en desk apunta al servidor de voz.

`agent:configure` conserva el prompt y herramientas de Lucía, añade el evento de
inicio y habilita los overrides usados por el motor actualizado: prompt, saludo, idioma,
voz y `conversation.text_only`. Operaciones usa `conversationConfigOverride(runtime)`
con la voz, metaprompt e instrucciones persistidas de la clínica. El saludo de la demo
siempre empieza en español. Se verifica la configuración remota antes de iniciar; no se
cambia automáticamente el agente remoto. El simulador usa Responses API de Vercel AI Gateway con `store:false`.

## Cloudflare

No hay un segundo backend ni se necesitan los antiguos procesos de `platform/`.
Se amplía el Worker de voz con el Durable Object `OperationsDemo`. Se utiliza la
configuración por clínica y el almacenamiento de auditoría/transcripciones D1 existentes.
Los ensayos no se insertan en `voice_calls`, para no contaminar las métricas clínicas.

Antes de desplegar:

1. Configurar `OPERATIONS_SECRET` (mismo valor en voice y desk), `AI_GATEWAY_API_KEY` en voice,
   y las credenciales de agentes/Prosper/Twilio existentes. No usar variables NEXT_PUBLIC.
2. Configurar `VOICE_AGENT_PUBLIC_URL` en voice con el dominio público de desk o voice.
3. Ejecutar las migraciones D1 existentes (incluida `0004_call_transcripts.sql`).
4. Desplegar primero voice y después desk. La nueva migración Durable Object
   `operations-v1` se añade después de `v1`; no reemplaza VoiceCall.

El proxy Next.js controla el rol y el origen de los POST. El control entre servicios
requiere el secreto. Los callbacks telefónicos utilizan rutas firmadas con caducidad,
limitadas a la ejecución activa; nunca incluyen credenciales del proveedor.

## Límites y recuperación

- Máximo una ejecución por instalación, tres pacientes y una llamada telefónica.
- Máximo cinco minutos y 18 turnos por paciente LLM.
- Detener cancela simuladores y termina el Call SID de Twilio, incluso si se recibe tarde.
- Si Twilio no confirma la creación/cierre, no se reintenta automáticamente.
  Revisar Calls y usar **He comprobado el cierre en Twilio** únicamente cuando esté cerrado.
- Un reinicio del Durable Object recupera la ejecución como incierta y bloquea otro arranque.
  El servidor y la alarma del Worker limitan la demo a cinco minutos. No se envían
  TimeLimit ni Timeout al crear llamadas, para usar los mismos parámetros que Lucía.
  Si el servidor local se cae, comprobar y cerrar manualmente la llamada en Twilio.
- El teléfono reutiliza exactamente `liveStreamTwiml` del commit de Guille: dos
  frases fijas de paciente, voz Polly.Sergio-Neural y las mismas pausas.
  No abre un stream REST ni mantiene una conversación con ElevenLabs. El panel
  lo identifica como reproducción de prueba; las tres sesiones LLM sí usan el agente.
  El destinatario es TWILIO_HUMAN_NUMBER. La comprobación HTTPS no reproduce audio.

## Verificación

```sh
npm run typecheck
npm run test:operations
node --import tsx --test src/agent/*.test.ts src/worker/*.test.mjs
npm run cf:typecheck
npm run cf:check
npm --prefix desk run build
```

Los tests de integración usan transportes y proveedores falsos. No prueban una llamada
telefónica real ni despliegan código. El despliegue y la prueba de audio completa son pasos
independientes, y requieren la configuración indicada.
