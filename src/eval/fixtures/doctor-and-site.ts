import {
  extracted,
  type ScriptedFixture,
  type ScriptedTurn,
} from "./simple-booking";

function turn(
  text: string,
  values: Parameters<typeof extracted>[0],
): ScriptedTurn {
  return { text, extraction: extracted(values) };
}

export const DOCTOR_AND_SITE_FIXTURES: ScriptedFixture[] = [
  {
    caseId: "doctor_and_site-2fe62ca2872f",
    fromNumber: "+34642674973",
    turns: [
      turn("I need Dra. Ortiz Vidal. I am Joaquín Ramírez Delgado.", {
        intent: "book",
        specialtyId: "general_practice",
        providerName: "Dra. Ortiz Vidal",
        identity: { name: "Joaquín Ramírez Delgado" },
      }),
      turn("At Arenal Centro, with no time preference.", { locationId: "centro" }),
      turn("Yes, that works.", { acceptance: "accepted" }),
    ],
  },
  {
    caseId: "doctor_and_site-057078bb5b44",
    fromNumber: "+34781850784",
    turns: [
      turn("I need Dr. Sáez, the GP. I am Emilio Rubio Jiménez.", {
        intent: "book",
        specialtyId: "general_practice",
        providerName: "Dr. Sáez",
        identity: { name: "Emilio Rubio Jiménez" },
      }),
      turn("No other preference.", {}),
      turn("Yes, book it.", { acceptance: "accepted" }),
    ],
  },
  {
    caseId: "doctor_and_site-d5b4f04886c5",
    fromNumber: "+34737358708",
    turns: [
      turn("I need Dr. Requena. I am Andrés Rubio Vázquez.", {
        intent: "book",
        providerName: "Dr. Requena",
        locationId: "norte",
        identity: { name: "Andrés Rubio Vázquez" },
      }),
      turn("It must be Arenal Norte.", { locationId: "norte" }),
      turn("Yes, another GP there is fine.", { acceptance: "accepted" }),
      turn("Yes, that appointment works.", { acceptance: "accepted" }),
    ],
  },
  {
    caseId: "doctor_and_site-9904a6d96cdd",
    fromNumber: "+34763783288",
    turns: [
      turn("I need Dr. Sáez. I am Mario Gómez Blanco.", {
        intent: "book",
        specialtyId: "general_practice",
        providerName: "Dr. Sáez",
        identity: { name: "Mario Gómez Blanco" },
      }),
      turn("At Arenal Centro on Monday.", {
        locationId: "centro",
        weekday: 1,
      }),
      turn("The day does not matter; keep that doctor and clinic.", {
        correction: true,
        clearConstraints: ["weekday"],
      }),
      turn("Yes, that works.", { acceptance: "accepted" }),
    ],
  },
  {
    caseId: "doctor_and_site-570e40a3f718",
    fromNumber: "+34764918391",
    turns: [
      turn("I need Dr. Fuentes, the orthopaedic surgeon. I am Vicente Álvarez Castro.", {
        intent: "book",
        specialtyId: "orthopaedics",
        providerName: "Dr. Fuentes",
        identity: { name: "Vicente Álvarez Castro" },
      }),
      turn("No other preference.", {}),
      turn("Fuentes. I only want that doctor.", { providerName: "Dr. Fuentes" }),
    ],
  },
];
