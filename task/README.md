# Prosper Track — documentación del reto

Copia consultada el 2026-09-18T18:38:14+00:00.

## Alcance y fidelidad

Las nueve páginas de documentación se han extraído del Markdown original incluido en la aplicación pública. Se conservan literalmente, sin traducción, resumen, correcciones ni cabeceras añadidas. Las URL de origen se registran aquí para no modificar los originales. Se incluye la página de normalización, aunque está oculta en el menú.

Los casos públicos y el esquema OpenAPI se conservan como JSON original y también dentro de archivos Markdown. Swagger UI y ReDoc son dos vistas del mismo esquema: su contenido se encuentra en `openapi.md` y en la versión navegable `api-reference.md`. No se han consultado datos privados ni endpoints que requieran una clave.

## Páginas originales

| Archivo | Página | Fuente |
|---|---|---|
| [overview.md](overview.md) | The short version | [Original](https://hackspain.getprosperapp.com/leaderboard/docs/overview) |
| [challenge.md](challenge.md) | What Is the Challenge? | [Original](https://hackspain.getprosperapp.com/leaderboard/docs/challenge) |
| [quickstart.md](quickstart.md) | Get on the phone | [Original](https://hackspain.getprosperapp.com/leaderboard/docs/quickstart) |
| [contract.md](contract.md) | The call contract | [Original](https://hackspain.getprosperapp.com/leaderboard/docs/contract) |
| [clinic-api.md](clinic-api.md) | The clinic | [Original](https://hackspain.getprosperapp.com/leaderboard/docs/clinic-api) |
| [rules.md](rules.md) | Scoring | [Original](https://hackspain.getprosperapp.com/leaderboard/docs/rules) |
| [problems.md](problems.md) | The 18 problems | [Original](https://hackspain.getprosperapp.com/leaderboard/docs/problems) |
| [api.md](api.md) | API Documentation | [Original](https://hackspain.getprosperapp.com/leaderboard/docs/api) |
| [scoring.md](scoring.md) | Normalization table | [Original](https://hackspain.getprosperapp.com/leaderboard/docs/scoring) |

## Recursos vinculados

- [Referencia completa de la API](api-reference.md).
- [Esquema OpenAPI en Markdown](openapi.md) y [JSON original](openapi.json).
- [Casos públicos en Markdown](public-cases.md) y [JSON original](public-cases.json).
- [Swagger UI](https://hackspain.getprosperapp.com/api/docs) y [ReDoc](https://hackspain.getprosperapp.com/api/redoc): interfaces interactivas del esquema archivado.

## Referencias externas

Las páginas del reto enlazan también a proveedores externos. Estos enlaces se conservan en los originales; no se ha copiado recursivamente la documentación de terceros.

- [Pipecat](https://www.pipecat.ai/).
- [Twilio Media Streams — WebSocket messages](https://www.twilio.com/docs/voice/media-streams/websocket-messages).

## Notas sobre navegación

Los enlaces entre los nueve documentos funcionan localmente. `public-cases.json` también está disponible localmente. Los enlaces absolutos `/api/docs` y `/api/redoc` del documento original `api.md` requieren el dominio de origen; arriba están sus URL completas. Los ejemplos con claves ficticias son parte de la documentación original.

## Procedencia y comprobación

Markdown distribuido en: https://hackspain.getprosperapp.com/leaderboard/assets/index-CvsSzRXq.js

| Archivo original | SHA-256 |
|---|---|
| `overview.md` | `021f201e0b536567f29c0511c1df2a6c7deb2f5bba63a3bcc61444725d0d2c2b` |
| `challenge.md` | `9fd2dd48d3146e924fb586f18829f3ea803f2ba56a947651b48abb0728e2716b` |
| `quickstart.md` | `a669b3026344bea42aa4d5f0da365586566fe9d1c126221e607ba8dcdaa60232` |
| `contract.md` | `e8c2a5245be4843f73d4b0738924c0fbf1982823960766e6ffdf1a99ffa35367` |
| `clinic-api.md` | `9cce4118bbed4ac0afbc2c69cf871c96e5cb8b416805cf09d8c7eac641848e6b` |
| `rules.md` | `7bc166f7d6877b5fe597a23033e080526032339fe277c6fe8861b911d7442485` |
| `problems.md` | `b2b3c80aa3e3ab43bf2b7102b5ae7626b559940a54046e7f7bc26b8f73d96ba6` |
| `api.md` | `1ab3a6fc6dc011192ce4764b5a9791de37fc98e883f1871dc29a52a7106dc1a5` |
| `scoring.md` | `d295627ae06f3d29aed17238ad211e32cedd0200e4aabfb30db99a8a84f93974` |
| `public-cases.json` | `2bff77d90a883a0d9162d7f6a8a81c6b86c238b625993642a0cadde492282179` |
| `openapi.json` | `24684a3f9f2aba3b6af3d15bec6b87a19f6ecde5a79d9c5810f9c335a8980bc3` |

## Discrepancias de la fuente que se han conservado

- `overview.md` menciona un starter kit; `quickstart.md`, sección 2, dice explícitamente que no existe. No se ha corregido ninguno de los originales.
- `rules.md` dice en un párrafo que los fallos atribuibles al harness se excluyen; su tabla detallada indica que los fallos `harness_issue` o `mixed` anulan la ejecución completa. Conviene confirmar la interpretación operativa con la organización.
- `public-cases.json` corresponde al ancla del viernes; `problems.md` explica que las respuestas de disponibilidad mostradas en la plataforma se recalculan cada día.
