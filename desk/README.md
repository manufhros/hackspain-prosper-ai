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
