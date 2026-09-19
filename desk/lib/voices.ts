export const RECEPTION_VOICES = [
  { id: "UOIqAnmS11Reiei1Ytkc", name: "Voz de recepción" },
] as const;

export const DEFAULT_VOICE_ID = RECEPTION_VOICES[0].id;

export function voiceNameFor(voiceId: string) {
  return RECEPTION_VOICES.find((voice) => voice.id === voiceId)?.name ?? RECEPTION_VOICES[0].name;
}
