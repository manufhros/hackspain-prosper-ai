# hackspain-prosper-ai

## Evaluación textual

El evaluador usa el `caller_prompt` de cada caso público para simular al
paciente, ejecuta el agente con submissions en modo dry-run y compara las
acciones con los resultados aceptados.

```bash
# Un caso de reserva simple
bun run eval:text

# Los cuatro casos públicos del problema
bun run eval:text -- --problem simple_booking --limit 4

# Un caso concreto, mostrando conversación y tools
bun run eval:text -- --case simple_booking-14a8720daa02 --verbose
```

Opciones: `--problem`, `--case`, `--limit`, `--turns`, `--caller-model` y
`--verbose`. El proceso termina con código `1` si algún caso falla.
