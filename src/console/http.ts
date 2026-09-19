import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { CallStore, CallSummary } from "./calls.ts";
import type { ProviderSettings } from "./provider.ts";
import type { MetricPeriod } from "./metrics.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const roots: Record<string, string> = {
  "/vendor/icons/": "node_modules/@phosphor-icons/web/src/regular",
  "/vendor/dm-sans/": "node_modules/@fontsource/dm-sans/files",
  "/vendor/instrument-serif/":
    "node_modules/@fontsource/instrument-serif/files",
};
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

export function isLocalConsoleRequest(
  req: Pick<IncomingMessage, "headers" | "socket">,
): boolean {
  if (
    !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      req.socket.remoteAddress ?? "",
    )
  )
    return false;
  const host = req.headers.host ?? "";
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) return false;
  if (req.headers.origin && req.headers.origin !== `http://${host}`)
    return false;
  return (
    !req.headers["sec-fetch-site"] ||
    ["same-origin", "none"].includes(String(req.headers["sec-fetch-site"]))
  );
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(value));
}

async function body(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const data = Buffer.from(chunk);
    size += data.length;
    if (size > 16_384) throw new Error("La solicitud es demasiado grande.");
    chunks.push(data);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new Error("La solicitud no es válida.");
  }
}

export function createConsoleHandler(
  calls: CallStore,
  provider: ProviderSettings,
) {
  let streams = 0;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (!isLocalConsoleRequest(req)) {
      json(res, 403, {
        error: "La consola solo está disponible desde localhost en este Mac.",
      });
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    const route = url.pathname;
    try {
      if (req.method === "GET" && route === "/api/events") {
        if (streams >= 12) {
          json(res, 429, { error: "Hay demasiadas consolas abiertas." });
          return;
        }
        streams += 1;
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        const send = (event: string, value: unknown) => {
          if (res.writableLength > 256_000) {
            res.destroy();
            return;
          }
          res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
        };
        const changed = (call: CallSummary) => send("call", call);
        calls.on("change", changed);
        send("snapshot", {
          calls: calls.list(),
          storageError: calls.storageError,
        });
        const heartbeat = setInterval(
          () => send("heartbeat", { storageError: calls.storageError }),
          15_000,
        );
        res.on("close", () => {
          streams -= 1;
          clearInterval(heartbeat);
          calls.off("change", changed);
        });
        return;
      }
      if (req.method === "GET" && route === "/api/overview") {
        const period = url.searchParams.get("period") ?? "30d";
        if (!["today", "7d", "30d", "all"].includes(period)) {
          json(res, 400, { error: "El periodo no es válido." });
          return;
        }
        if (calls.storageError) {
          json(res, 503, {
            error:
              "No se pueden mostrar métricas completas: revisa el almacenamiento local y reinicia la aplicación.",
          });
          return;
        }
        json(res, 200, calls.metrics.overview(period as MetricPeriod));
        return;
      }
      if (req.method === "GET" && route.startsWith("/api/calls/")) {
        const call = calls.get(
          decodeURIComponent(route.slice("/api/calls/".length)),
        );
        json(
          res,
          call ? 200 : 404,
          call ?? { error: "Esta llamada ya no está en el historial." },
        );
        return;
      }
      if (req.method === "GET" && route === "/api/settings") {
        json(res, 200, provider.public());
        return;
      }
      if (
        req.method === "POST" &&
        ["/api/settings", "/api/settings/test"].includes(route)
      ) {
        if (
          req.headers["x-lucia-console"] !== "1" ||
          !req.headers["content-type"]?.startsWith("application/json")
        ) {
          json(res, 403, {
            error: "La solicitud debe realizarse desde la consola.",
          });
          return;
        }
        const draft = await body(req);
        try {
          json(
            res,
            200,
            route.endsWith("/test")
              ? await provider.test(draft)
              : await provider.save(draft),
          );
        } catch (error) {
          json(res, 400, {
            error:
              error instanceof Error &&
              error.name !== "TimeoutError" &&
              error.name !== "TypeError"
                ? error.message
                : "No se pudo conectar con ElevenLabs. Vuelve a intentarlo.",
          });
        }
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        json(res, 405, { error: "Método no permitido." });
        return;
      }
      let local = route === "/" ? "/index.html" : decodeURIComponent(route);
      let directory = resolve(root, "public");
      for (const [prefix, folder] of Object.entries(roots)) {
        if (route.startsWith(prefix)) {
          directory = resolve(root, folder);
          local = decodeURIComponent(route.slice(prefix.length));
          break;
        }
      }
      const file = resolve(directory, local.replace(/^\/+/, ""));
      const type = types[extname(file)];
      if (!file.startsWith(directory + sep) || !type) {
        json(res, 404, { error: "Página no encontrada." });
        return;
      }
      const data = await readFile(file);
      res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch (error) {
      if (!res.headersSent)
        json(
          res,
          (error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 400,
          { error: "No se pudo completar la solicitud." },
        );
      else res.end();
    }
  };
}
