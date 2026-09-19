# HackSpain 2026 — Prosper track

Agente de voz inbound para **Clínica Arenal**. Node.js + TypeScript.

La clínica es de solo lectura. El leaderboard mira lo que POSTeáis a `/api/v1/submit/*`. Contrato: Twilio Media Streams sobre un WebSocket (`wss://…/ws`).

## Layout

```
src/
  config.ts              # env
  platform/              # cliente tipado de la API Prosper
  scripts/               # fetch del catálogo y smoke
  agent/                 # (próximo) servidor WS por llamada
task/                    # documentación oficial del reto
data/                    # cache local (gitignored)
```

## Setup

```bash
cp .env.example .env
npm install
npm run typecheck
npm run clinic:smoke
npm run agent:configure   # una vez: tools + prompt en ElevenLabs
npm run dev               # ws://127.0.0.1:7860/ws
```

Túnel: `ngrok http --region eu 7860` y en El Turno Settings el endpoint `wss://…/ws`.

Docs del reto en [`task/README.md`](task/README.md). API: https://hackspain.getprosperapp.com/api/redoc

## Consola Lucía

La misma aplicación sirve una consola local en `http://localhost:7860` (o el `PORT`
configurado). Puede arrancar sin claves para revisar la UI:

```bash
npm install
cp .env.example .env # solo si no tienes ya .env
npm run dev
```

Si ese puerto lo usa otro checkout, establece `PORT=7861` en `.env` y abre
`http://localhost:7861`. El servidor no tiene recarga automática: reinícialo después
de cambiar código del servidor o `.env`. Los cambios de UI aparecen al recargar la página.

- Historial en orden descendente, conversación en directo y ejecuciones de herramientas.
- Estados `En curso`, `Finalizada`, `No atendida`, `Error` e `Interrumpida`.
- Temas claro, oscuro y sistema; seguimiento de mensajes y movimiento reducido.
- **Ajustes → Proveedor de voz** guarda clave e identificador de ElevenLabs en el
  Llavero de macOS. Se aplican a nuevas llamadas; una clave vacía conserva la actual.
  **Probar conexión** solo consulta el agente; no lo modifica ni hace una llamada.
- `PLATFORM_API_KEY` sigue siendo necesario en `.env` para las consultas reales a la clínica.
- La demostración es opcional, está identificada, usa datos ficticios y no contacta proveedores.
  Puedes abrirla directamente con `/?demo=1`.

La consola solo admite conexiones de loopback con Host `localhost`, `127.0.0.1` o
`[::1]`. Un túnel público puede usar `/ws` y `/health`, pero no el historial ni los ajustes.
No cambies el Host de un túnel a localhost para evitar saltarte esa separación.

El historial queda en `data/calls.json` (ignorado por Git, permisos 0600), hasta 200
llamadas y 400 mensajes/ejecuciones por llamada. No se guardan grabaciones de audio.
Los eventos del proveedor actualizan la UI al recibirse; las interrupciones corrigen
el mensaje anterior. Las llamadas que estaban activas al reiniciar se marcan interrumpidas.

### Verificación sin arrancar servicios

```bash
npm run typecheck
npm test
npm run check:ui
```

Los tests usan datos ficticios y dependencias simuladas, sin llamadas externas ni escrituras
al Llavero. La verificación visual y de llamadas reales requiere arrancar el entorno.

Referencias del proveedor: [consulta de agente](https://elevenlabs.io/docs/eleven-agents/api-reference/agents/get)
y [eventos de transcripción y corrección](https://elevenlabs.io/docs/eleven-agents/customization/events/client-events).
