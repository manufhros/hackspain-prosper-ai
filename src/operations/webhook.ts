/** Only this read-only check is retried. Never retry Twilio call creation. */
export async function verifyPhoneWebhook(endpoint: string, callId: string, signal: AbortSignal) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    let xml: string;
    try {
      response = await fetch(endpoint, {
        headers: { "ngrok-skip-browser-warning": "true" },
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      });
      xml = await response.text();
    } catch {
      if (signal.aborted) throw new Error("Comprobación cancelada.");
      if (attempt === 0) continue;
      throw new Error("Ngrok no respondió a tiempo al comprobar la URL pública. No se ha solicitado ninguna llamada a Twilio.");
    }
    if (!response.ok || !xml.includes('<Say ') || response.headers.get("x-operations-call-id") !== callId) {
      throw new Error(`La URL pública no devuelve las instrucciones de esta demo (HTTP ${response.status}). Revisa ngrok y el servidor de voz.`);
    }
    return;
  }
}
