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

## Cloudflare Workers

El desk y el agente de voz se despliegan como Workers separados con Wrangler, compartiendo D1 para configuración, llamadas y auditoría. Instrucciones de preparación, secretos, migraciones y despliegue en [CLOUDFLARE.md](CLOUDFLARE.md).
