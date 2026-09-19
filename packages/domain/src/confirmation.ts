/** Conservative whole-answer grammar: tolerate speech fillers, never extra corrections. */
export function explicitConfirmation(text: string): boolean {
  if (/[?¿]/.test(text)) return false;
  const answer = text.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/[’]/g, "'").replace(/[.,!¡¿?;:]/g, " ").replace(/\s+/g, " ").trim()
    .replace(/^(?:(?:ah|uh|um|hmm|hm|mm|mmm|eh|em|mhm)\s+)+/, "");
  return /^(?:(?:yes|si)(?: (?:please|por favor|si us plau))?|(?:yes )?(?:that's fine|that is fine)(?: please book it)?|(?:yes )?(?:please )?go ahead|(?:yes )?i confirm|yes confirmo|(?:yes )?(?:please )?book it|(?:si )?(?:confirmo|confirmat|ho confirmo)|correcto|correct|de acuerdo|d'acord|vale|okay|ok|confirm|(?:si )?(?:reserva|reservalo|reserva-la)(?: por favor| si us plau)?)(?: thank you| gracias| gracies)?$/.test(answer);
}
