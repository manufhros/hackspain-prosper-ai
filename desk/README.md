# hash · desk

Panel web de **hash** para Clínica Arenal (Next.js 16, App Router).

## Cuentas

Sin contraseña: la cookie de sesión guarda el correo y el rol decide qué se ve en `/panel`.

| Correo | Rol | Secciones |
| --- | --- | --- |
| `admision@clinicaarenal.es` | Clínica | Resumen, Llamadas |
| `admin@hash.app` | Operador hash | Resumen, Llamadas, Configuración del agente, Pruebas de voz |
| `voz@hash.app` | Pruebas de voz | Pruebas de voz, Llamadas |

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:3100
npm run extract    # regenera lib/from-logs.json desde ../logs
```

Variables útiles: `VOICE_AGENT_WS_URL` (WebSocket del agente para el simulador), `VOICE_AGENT_HEALTH_URL`,
`VOICE_TEST_PHONE` (móvil al que Twilio llama en el caso «Transferencia»), `DESK_STORAGE=d1` en Cloudflare.

## Estructura

- `app/panel/*` — la app: `layout.tsx` (shell), `page.tsx` (resumen), `llamadas`, `agente`, `pruebas`.
- `components/ui/` — tokens y primitivas (AppShell, PageHeader, StatCard, Card, Badge, DataTable…).
- `components/views/Overview.tsx`, `components/CallMonitor.tsx`, `components/VoiceSimulator.tsx`, `components/AgentControl.tsx`.
- `lib/auth.ts` (cuentas y permisos), `lib/clinic.ts` (sedes), `lib/call-data.ts` (llamadas), `lib/agent-config.ts`.
- `design/hash-desk.pen` — maquetas en Pencil.

## Transcripciones de llamadas

Cada turno del llamante y del agente se guarda en `voice_transcript_entries`,
separado de la auditoría redactada, con fecha, emisor y orden de conversación.
También se conservan los mensajes del simulador. La opción interna `zeroRetention`
continúa redactando la auditoría y omitiendo el texto de las transferencias; no
desactiva esta transcripción del registro de llamadas. No se almacena audio aquí.
El detalle aplica los mismos permisos y el mismo centro que la lista de llamadas.
El acceso del panel sigue siendo de demostración, por cookie sin contraseña.

Antes de desplegar el agente o el panel con esta función, aplicar la migración
`0004_call_transcripts.sql` mediante `npm run db:migrate:remote` desde `desk/`.
Después desplegar el agente y el panel con sus respectivos comandos `cf:deploy`.
Los textos de llamadas anteriores que ya fueron redactados no se pueden recuperar.
El modo local basado en `from-logs.json` muestra el detalle disponible, pero no
inventa transcripciones que no existen en ese archivo.
