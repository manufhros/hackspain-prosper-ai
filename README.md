# HackSpain 2026 — Prosper track

Agente de voz inbound para **Clínica Arenal**. Esta rama añade la **v1 Python** (FastAPI + Pipecat/Flows), conservando el agente TypeScript de `feature/lucia-work` para comparación.

## V1 Python

La lógica, herramientas, estado y turnos viven en nuestro servidor. ElevenLabs es solo un proveedor intercambiable de síntesis de voz; no se utiliza su Agent Platform. **Sin supresión de ruido.** Panel privado en `/console` con llamadas activas, transcripciones, herramientas, peticiones a Prosper y errores.

```bash
uv sync --python 3.11 --frozen
# Configura las variables de .env.example en tu .env existente; no lo sobrescribas.
uv run uvicorn clinic_voice.app:app --host 0.0.0.0 --port 7860 --workers 1
```

Abre `http://localhost:7860/console` e introduce `CONSOLE_TOKEN`. El evaluador conecta a `wss://<tu-tunel>/ws` y, si configuras `TRANSPORT_TOKEN`, debe enviar `Authorization: Bearer <token>`.

```bash
uv run pytest -q
uv run ruff check src/clinic_voice tests
```

Arquitectura, configuración, límites y diagnóstico: [docs/python-voice-v1.md](docs/python-voice-v1.md).
Las pruebas locales **no certifican** que esta versión pase el evaluator: hay que comparar las llamadas reales con el baseline de Lucía antes de sustituirlo.

La clínica es de solo lectura. El leaderboard mira lo que POSTeáis a `/api/v1/submit/*`. Contrato: Twilio Media Streams sobre un WebSocket (`wss://…/ws`).

## Layout del baseline TypeScript

```
src/
  config.ts              # env
  platform/              # cliente tipado de la API Prosper
  scripts/               # fetch del catálogo y smoke
  agent/                 # (próximo) servidor WS por llamada
task/                    # documentación oficial del reto
data/                    # cache local (gitignored)
```

## Setup del baseline TypeScript

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
