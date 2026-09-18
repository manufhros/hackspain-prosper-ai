import { describe, expect, test } from "bun:test";
import {
  TRIAGE_DESTINATIONS,
  TRIAGE_SPECIALTIES,
  classifyTriage,
  type TriageDestination,
} from "./triage";

describe("classifyTriage symptom families", () => {
  const families: ReadonlyArray<{
    name: string;
    turns: readonly string[];
    expected: TriageDestination;
  }> = [
    {
      name: "rolled swollen ankle",
      turns: [
        "Coming down the stairs yesterday, I went over on my ankle and it has swollen right up.",
        "Walking really hurts, although I can put a little weight on it.",
      ],
      expected: "orthopaedics",
    },
    {
      name: "bike fall and immobile shoulder",
      turns: ["I can't lift my arm above my shoulder.", "That started when I came off my bike."],
      expected: "orthopaedics",
    },
    {
      name: "clicking and locking knee",
      turns: ["My knee gave way on the stairs; it locks and clicks when I go up steps."],
      expected: "orthopaedics",
    },
    {
      name: "fall onto an outstretched hand",
      turns: ["My wrist feels weak and painful after I slipped and landed on my outstretched hand."],
      expected: "orthopaedics",
    },
    {
      name: "child with fever and poor appetite",
      turns: ["He is off his food.", "My son has had a temperature for two days."],
      expected: "paediatrics",
    },
    {
      name: "child with persistent night cough",
      turns: ["My daughter’s cough is worse at night and has lasted more than a week."],
      expected: "paediatrics",
    },
    {
      name: "child pulling ear and not sleeping",
      turns: ["My child is crying and tugging on her ear. She has barely slept."],
      expected: "paediatrics",
    },
    {
      name: "child with intermittent tummy pain",
      turns: ["For one week my boy's sore tummy has been hurting on and off."],
      expected: "paediatrics",
    },
    {
      name: "tired and run down",
      turns: ["For a fortnight I have felt run down and unusually tired."],
      expected: "general_practice",
    },
    {
      name: "afternoon headaches",
      turns: ["For four weeks I have had headaches nearly every afternoon."],
      expected: "general_practice",
    },
    {
      name: "sore throat and fever",
      turns: ["I've felt feverish since the weekend, and my throat is sore."],
      expected: "general_practice",
    },
    {
      name: "postural dizziness and fatigue",
      turns: ["I am more tired than usual, and I get light-headed when I stand up."],
      expected: "general_practice",
    },
    {
      name: "heavy irregular periods",
      turns: ["For the last few months my periods have been irregular and very heavy."],
      expected: "gynaecology",
    },
    {
      name: "bleeding between periods",
      turns: ["This is the third cycle with bleeding between periods."],
      expected: "gynaecology",
    },
    {
      name: "one-sided low pain",
      turns: ["For a couple of weeks I have had a dull pelvic pain on my left side."],
      expected: "gynaecology",
    },
  ];

  for (const family of families) {
    test(family.name, () => {
      expect(classifyTriage(family.turns)).toBe(family.expected);
    });
  }

  test("accumulates split turns without mutable state", () => {
    const turns = [
      "It has swollen a lot and walking hurts.",
      "Yesterday I rolled my ankle.",
    ] as const;

    expect(classifyTriage(turns[0])).toBeUndefined();
    expect(classifyTriage(turns)).toBe("orthopaedics");
    expect(classifyTriage(...turns)).toBe("orthopaedics");
    expect(turns).toEqual([
      "It has swollen a lot and walking hurts.",
      "Yesterday I rolled my ankle.",
    ]);
  });
});

describe("classifyTriage published red flags", () => {
  const redFlags = [
    "There is a tight pain across my chest and I'm struggling to catch my breath.",
    "All of a sudden my words are slurred, one side of my face is drooping, and one arm feels weak.",
    "I can't get my breath at all. It came on out of nowhere and I keep stopping between words.",
    "The cut is still bleeding heavily; it won’t stop after ten minutes of pressure.",
    "I banged my head one hour ago and since then I've been sick and confused.",
  ] as const;

  for (const [index, redFlag] of redFlags.entries()) {
    test(`red flag ${index + 1}`, () => {
      expect(classifyTriage(redFlag)).toBe("medical_emergency");
    });
  }

  test("red flags take precedence over a routine family", () => {
    expect(
      classifyTriage([
        "I have been tired and run down for two weeks.",
        "Now there is a tight pain in my chest and I am short of breath.",
      ]),
    ).toBe("medical_emergency");
  });
});

describe("classifyTriage close negatives", () => {
  const negatives = [
    "My chest is sore after lifting weights, with no trouble breathing.",
    "My face has always been uneven, but my arms and speech are normal.",
    "I was breathless after running but can speak normally and it was not sudden.",
    "The cut bled heavily but stopped after ten minutes of pressure.",
    "I bumped my head an hour ago, but I am not confused and haven't been sick.",
    "My ankle is swollen, but I did not twist it and walking does not hurt.",
    "My wrist aches after typing and feels weak.",
    "My adult brother has had a cough for over a week, worse at night.",
    "My child had a temperature for two days but is eating normally.",
    "I have felt tired since yesterday.",
    "I get headaches every morning and have done for a month.",
    "My throat is sore but I do not have a fever.",
    "I feel dizzy while sitting down, but standing makes no difference.",
    "My periods are heavy but regular.",
    "A shaving cut is bleeding between my fingers.",
    "I have sharp pain across both sides of my lower back.",
    "I fell from my bike but can lift and move both arms normally.",
    "My knee clicked once, but it has never locked or given way.",
  ] as const;

  for (const [index, negative] of negatives.entries()) {
    test(`near miss ${index + 1}`, () => {
      expect(classifyTriage(negative)).toBeUndefined();
    });
  }

  test("returns undefined for empty and unrelated text", () => {
    expect(classifyTriage([])).toBeUndefined();
    expect(classifyTriage("I would like the earliest appointment.")).toBeUndefined();
  });

  test("exports only the closed published destinations", () => {
    expect(TRIAGE_SPECIALTIES).toEqual([
      "orthopaedics",
      "paediatrics",
      "general_practice",
      "gynaecology",
    ]);
    expect(TRIAGE_DESTINATIONS).toEqual([...TRIAGE_SPECIALTIES, "medical_emergency"]);
  });
});
