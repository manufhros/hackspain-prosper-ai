# HackSpain 2026 — Prosper track

Agente de voz inbound para **Clínica Arenal**, implementado en **Python** con FastAPI + Pipecat/Flows. Esta rama contiene únicamente el nuevo sistema; la implementación anterior permanece en `feature/lucia-work` y en el historial de Git.

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

## Estructura

```
src/clinic_voice/        # backend Python: voz, conversación, dominio e integraciones
  console/              # panel HTML/CSS/JavaScript servido por FastAPI, sin Node ni build
tests/                  # pruebas Python
task/                   # documentación y casos oficiales del reto
docs/                   # arquitectura y guía de operación
data/voice/             # eventos y logs locales (gitignored)
pyproject.toml          # dependencias y herramientas Python
uv.lock                 # versiones fijadas
Dockerfile.voice        # despliegue del servidor Python
```

Túnel: `ngrok http 7860` y en El Turno Settings el endpoint `wss://…/ws`. Si arrancas Uvicorn en otro puerto (por ejemplo, `7861`), dirige ngrok a ese mismo puerto.

Docs del reto en [`task/README.md`](task/README.md). API: https://hackspain.getprosperapp.com/api/redoc
