import type { Action } from "../data";
import { fold } from "../validation";

const clean = (text: string) => fold(text).replace(/(\d{1,2})\.(\d{2})\b/g, "$1:$2")
  .replace(/[.!¡,;]+/g, " ").replace(/\s+/g, " ").trim();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const prefix = (pattern: string) => new RegExp(`^(?:${pattern})(?:\\s+|$)`);

/** Consume the ENTIRE reply as affirmations/courtesy plus exact offer details.
 * Unknown words are not discarded: changes, conditions and extra intents fail
 * closed. This handles composed confirmations without guessing from a leading yes.
 */
export function acceptsRestatedOffer(text: string, actions: Action[], provider?: string, location?: string): boolean {
  if (actions.length !== 1 || !["BOOK", "RESCHEDULE"].includes(actions[0]!.action)) return false;
  const action = actions[0]!;
  if (typeof action.slot !== "string" || !Number.isFinite(Date.parse(action.slot))) return false;
  let rest = clean(text), affirmative = false;
  if (!rest || /[?¿]/.test(rest)) return false;
  const date = new Date(action.slot);
  const clock = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "numeric", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(date).map(p => [p.type, p.value]));
  const hour = `0?${Number(clock.hour)}`, minute = clock.minute!;
  const time = minute === "00" ? `${hour}(?::00)?` : `${hour}:${minute}`;
  const dateForms: string[] = [];
  for (const locale of ["es", "en-GB", "ca"]) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat(locale, { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long", year: "numeric" })
      .formatToParts(date).map(p => [p.type, p.value]));
    const day = Number(parts.day), month = clean(parts.month!).replace(/^(?:de |d')/, ""), weekday = clean(parts.weekday!), year = parts.year!;
    const forms = locale === "en-GB" ? [`${day} ${month} ${year}`, `${month} ${day} ${year}`]
      : [`${day} de ${month} de ${year}`, `${day} de ${month} del ${year}`, `${day} ${month} ${year}`, `${day} d'${month} de ${year}`, `${day} d'${month} del ${year}`];
    dateForms.push(...forms.flatMap(form => [escape(`${weekday} ${form}`), escape(form)]));
  }
  const details = [
    prefix(`(?:el |on |the )?(?:${dateForms.join("|")})`),
    prefix(`(?:a las |a les |at )?${time}`),
  ];
  if (provider) {
    const name = clean(provider).replace(/^(?:dr|dra|doctor|doctora)\s+/, "");
    if (name) details.push(prefix(`(?:con |with |amb )(?:el |la )?(?:(?:dr|dra|doctor|doctora) )?${escape(name)}`));
  }
  if (location) details.push(prefix(`(?:en |at |in |a )${escape(clean(location))}`));
  if (typeof action.policy_id === "string") {
    // DKV commonly arrives from ASR as "de KV". Alias only this known plan;
    // never apply fuzzy matching to an arbitrary insurance provider.
    const plan = action.policy_id === "dkv" ? "(?:dkv|d k v|de kv|de ka uve)" : escape(clean(action.policy_id.replaceAll("_", " ")));
    details.push(prefix(`(?:(?:y |and |i )?(?:con facturacion a|facturad[ao](?: a)?|con cargo a|billed to|bill it to|amb facturacio a) |(?:con |with |amb ))(?:mi |my |el meu )?(?:(?:plan|seguro|insurance|pla|asseguranca) )?${plan}`));
  }
  const acceptance = prefix("yes|yeah|yep|si|vale|ok|okay|perfecto|perfecta|perfecte|perfect|correcto|correcte|correct|de acuerdo|d'acord|me viene (?:muy )?bien|em va be|that works(?: for me)?|that's (?:right|fine)|that is (?:right|fine)|exactly|es exactamente lo que (?:pedia|queria)|that's exactly what i (?:asked for|wanted)|that is exactly what i (?:asked for|wanted)|es exactament el que (?:demanava|volia)|confirmela|confirmelo|confirmo(?: esa cita| la reserva)?|confirm it|please confirm it|confirmi-la|confirmi-ho");
  const courtesy = prefix("por favor|please|gracias|muchas gracias|thanks|thank you|gracies|si us plau|sisplau");
  while (rest) {
    const polite = rest.match(courtesy);
    const yes = polite ? null : rest.match(acceptance);
    const matched = polite ?? yes ?? details.map(pattern => rest.match(pattern)).find(Boolean);
    if (!matched) return false;
    if (yes) affirmative = true;
    rest = rest.slice(matched[0].length).trimStart();
  }
  return affirmative;
}
