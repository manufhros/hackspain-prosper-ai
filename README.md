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

Requiere Node.js 22.13 o posterior (SQLite integrado).

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

### Resumen y métricas duraderas

Abre **Resumen** en la cabecera o `/?view=overview`. Incluye llamadas recibidas,
atendidas, derivadas, reservas, cancelaciones, cambios de cita, altas de paciente,
estados, duración media y errores de herramientas. Los periodos Hoy / 7 días /
30 días / Todo usan Europe/Madrid y la fecha de inicio de cada llamada. El gráfico
de Todo muestra los últimos 30 días; sus totales incluyen todo el histórico.

`data/metrics.sqlite` conserva las métricas entre reinicios, independientemente del
límite de 200 llamadas del historial. Se crea al iniciar el servidor; no requiere
un servicio de base de datos adicional. El historial disponible en `data/calls.json`
se incorpora automáticamente sin duplicados. No puede reconstruir llamadas que
ya se eliminaron de ese historial antes de añadir SQLite.

- Una llamada se cuenta una vez por identificador. Derivadas cuenta llamadas con
  una acción `ESCALATE` registrada; no confirma una transferencia telefónica.
- Las gestiones cuentan acciones únicas recibidas con éxito en `record.actions`.
  Respuestas acumulativas y reintentos idénticos no duplican el resultado. Una reserva
  cancelada sigue contando como reserva y suma una cancelación independiente.
- Las herramientas fallidas o sin respuesta no generan gestiones confirmadas.
  La duración media solo usa llamadas conectadas que ya terminaron.
- La base conserva identificadores, estados, tiempos y huellas de acciones; no
  copia nombres, teléfonos, transcripciones ni payloads de pacientes. SQLite y sus
  archivos WAL están ignorados por Git; la base se crea con permisos 0600.
- La demostración nunca escribe métricas. Un fallo de almacenamiento se muestra
  explícitamente en vez de presentar totales incompletos como válidos.

API local: `GET /api/overview?period=today|7d|30d|all`. El resumen se actualiza al
recibir eventos y permite actualización manual. Para copiar la base mientras el
servidor está activo, usa una copia de seguridad SQLite que incluya el WAL, no una
copia aislada del archivo principal ([documentación SQLite](https://www.sqlite.org/wal.html)).

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
