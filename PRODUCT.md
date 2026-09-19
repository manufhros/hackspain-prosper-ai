# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Tres cuentas, sin contraseña (cookie de demo). El rol decide qué secciones de `/panel` se abren.

- **Clínica Arenal · admisión:** `admision@clinicaarenal.es` → Resumen y Llamadas.
- **Operador hash:** `admin@hash.app` → Resumen, Llamadas, Configuración del agente y Pruebas de voz.
- **Pruebas de voz:** `voz@hash.app` → Pruebas de voz y Llamadas.

## Product Purpose

Un agente de voz atiende llamadas de cita como una recepcionista: identifica al llamante, consulta la clínica de verdad, busca huecos reales y reserva, mueve o anula. Reconocer cuándo no debe haber cita es parte del trabajo.

El panel **Admisión** enseña a cada centro qué ha capturado esa línea (agenda, altas, escalados, privacidad) para que gerencia vea valor y admisión opere el día.

Éxito: la llamada queda bien resuelta en el registro de la clínica, y el hospital entiende el efecto en euros y en personal sin ver datos de otro centro.

## Positioning

No es un chatbot genérico ni un listado de clínicas. El agente trabaja contra ficha, disponibilidad y normas reales. El panel aísla por hospital y vende el efecto (agenda llena, llamadas que no se pierden, FTE no abiertos). El modelo de voz no es el producto; es una pieza. Lo que diferencia es el sistema alrededor: consultas reales, estado de la llamada, y visibilidad de por qué se dijo lo que se dijo — visible a hash, no a un hospital ajeno.

## Operating Context

- Llamada inbound (telefonía) → agente → herramientas de clínica → POST al registro.
- Panel web (`desk/`): login por correo → `/panel`, una sola app con navegación filtrada por rol.
- Los datos del panel salen de las llamadas reales de Clínica Arenal (export de logs en local, D1 en Cloudflare). No hay cuentas de demostración.
- El hospital no recorre un directorio de centros dados de alta.

## Capabilities and Constraints

- Agente: búsqueda de paciente, disponibilidad, reserva / alta / no-acción / escalado; no colgar como cierre de cortesía.
- Panel: resumen (KPIs, resultados, consultas, actividad por centro, valor de la agenda), llamadas con trazabilidad, configuración del agente y simulador de voz.
- La clínica no ve la configuración del agente; hash sí.
- El modelo de voz no se expone a roles de hospital; hash lo trata como configuración restringida.
- No inventar pacientes, DNI ni citas. La transcripción de cada llamada se conserva en D1 para su vista de detalle, incluidos los turnos del simulador. La opción de privacidad redacta la auditoría y omite la transcripción en transferencias; no elimina la transcripción del registro de llamadas. Este cambio de retención fue solicitado explícitamente para el detalle de llamadas.
- Abierto: permisos más finos (quién ve nómina vs citas) si hace falta más que el local del correo.

## Brand Commitments

- Marca: **hash**. No Prosper en producto.
- Nombre del panel: **Admisión**.
- Idioma de interfaz: español.
- El hospital se identifica por su centro (nombre, ciudad), no por un grupo genérico en el cromado.

## Evidence on Hand

- Logs de llamadas de Clínica Arenal (`logs/`, extraídos a `desk/lib/from-logs.json`): transcripciones, tools, citas, sedes Centro/Norte/Sur.
- Cuentas Quirónsalud y Sanitas: demostración explícita, no evidencia comercial.
- No hay testimonios, prensa ni precios de cliente reales; no fabricarlos.
- El agente de voz vive en `src/agent/`; el panel en `desk/`. No tratar el leaderboard del hackathon como prueba de cliente.

## Product Principles

1. Un centro, una cuenta: nada de ver el vecino.
2. La línea hace el trabajo clínico de verdad; el panel explica el valor en cifras de agenda y personal.
3. Quien no debe tocar el modelo, no lo ve.
4. Español, tono de hospital, no de pitch de startup.
5. Distinguir siempre dato de llamada de hipótesis comercial (ticket, jornadas, % de pérdida).
