export const RECEPTION_VOICES = [
  { id: "UOIqAnmS11Reiei1Ytkc", name: "Carolina · español peninsular" },
  { id: "1XKosoC1PO6b8UZKO1CE", name: "Lucía · voz propia" },
] as const;

export const DEFAULT_VOICE_ID = RECEPTION_VOICES[0].id;

export function voiceNameFor(voiceId: string) {
  return RECEPTION_VOICES.find((voice) => voice.id === voiceId)?.name ?? RECEPTION_VOICES[0].name;
}
