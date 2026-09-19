/** Fixed, non-personal speech that can be synthesized once and reused across calls. */
export const callPhrases = {
  en: {
    greeting: "Clínica Arenal, how can I help you?",
    waiting: "Of course, let me check that for you. One moment, please.",
    repeat: "I couldn't hear that clearly. Please repeat what you said.",
    idle: "I'm still here. If I missed you, please repeat your request.",
    failure: "I'm sorry, I couldn't finish processing your request. Please call again. No new appointment has been confirmed.",
  },
  es: {
    greeting: "Clínica Arenal, ¿en qué puedo ayudarle?",
    waiting: "De acuerdo, déjeme revisarlo un momento.",
    repeat: "No le he oído con claridad. Por favor, repita lo que ha dicho.",
    idle: "Sigo aquí. Si no le he oído, por favor, repita su solicitud.",
    failure: "Lo siento, no he podido terminar de tramitar su solicitud. Por favor, vuelva a llamar. No se ha confirmado ninguna cita nueva.",
  },
  ca: {
    greeting: "Clínica Arenal, en què el puc ajudar?",
    waiting: "D'acord, deixi'm revisar-ho un moment.",
    repeat: "No l'he sentit amb claredat. Si us plau, repeteixi el que ha dit.",
    idle: "Continuo aquí. Si no l'he sentit, si us plau, repeteixi la seva petició.",
    failure: "Em sap greu, no he pogut acabar de tramitar la seva petició. Si us plau, torni a trucar. No s'ha confirmat cap cita nova.",
  },
};
