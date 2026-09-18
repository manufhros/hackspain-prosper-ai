export const TRIAGE_SPECIALTIES = [
  "orthopaedics",
  "paediatrics",
  "general_practice",
  "gynaecology",
] as const;

export const TRIAGE_DESTINATIONS = [
  ...TRIAGE_SPECIALTIES,
  "medical_emergency",
] as const;

export type TriageSpecialty = (typeof TRIAGE_SPECIALTIES)[number];
export type TriageDestination = (typeof TRIAGE_DESTINATIONS)[number];
export type TriageTranscript = readonly string[];
export type TriageInput = string | TriageTranscript;

type SymptomRule = {
  destination: TriageSpecialty;
  matches: (text: string) => boolean;
};

const any = (text: string, patterns: readonly RegExp[]) =>
  patterns.some((pattern) => pattern.test(text));

const all = (text: string, patterns: readonly RegExp[]) =>
  patterns.every((pattern) => pattern.test(text));

function normalize(input: TriageInput, followingTurns: readonly string[]) {
  const turns = typeof input === "string" ? [input, ...followingTurns] : [...input, ...followingTurns];
  return turns
    .join(" ")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[’‘`´]/g, "'")
    .toLowerCase()
    .replace(/n['’]t\b/g, "nt")
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/'/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CHILD = [
  /\bchild\b/,
  /\bkid\b/,
  /\b(?:my|our|their) (?:son|daughter|boy|girl|baby|toddler)\b/,
  /\b\d{1,2} year old\b/,
] as const;

const FEVER = [/\bfever(?:ish)?\b/, /\btemperature\b/, /\brunning a temp\b/] as const;
const TWO_DAYS = [
  /\b(?:two|2) days?\b/,
  /\b(?:a )?couple of days?\b/,
  /\b48 hours?\b/,
] as const;
const WEEK_OR_MORE = [
  /\b(?:(?:just|a little) )?(?:over|more than|longer than) (?:a|one|1) week\b/,
  /\b(?:eight|8|nine|9|ten|10) days?\b/,
  /\bfor (?:a|one|1) week (?:now|or more)\b/,
] as const;
const WEEKS = [
  /\b(?:a )?couple of weeks?\b/,
  /\b(?:two|2|several) weeks?\b/,
  /\bfortnight\b/,
] as const;
const MONTHS = [
  /\b(?:a few|several|last few|past few|couple of) months?\b/,
  /\bfor months?\b/,
  /\bmonths? (?:now|running)\b/,
] as const;

function isEmergency(text: string) {
  const chestAndBreath =
    all(text, [
      /\bchest\b/,
      /\b(?:tight(?:ness)?|tight pain|pressure|squeez(?:ing|es|ed))\b/,
      /\b(?:struggl\w* to (?:catch (?:my|their|his|her) )?breath|struggl\w* for breath|cant (?:catch (?:my|their|his|her) )?breath|short of breath|difficulty breathing|hard to breathe)\b/,
    ]) &&
    !any(text, [/\bnot struggling to breathe\b/, /\bno (?:difficulty|trouble) breathing\b/]);

  const stroke =
    all(text, [
      /\b(?:face|mouth)\b.*\b(?:droop\w*|fallen|sag\w*)\b|\b(?:droop\w*|fallen|sag\w*)\b.*\b(?:face|mouth)\b/,
      /\barm\b.*\bweak\w*\b|\bweak\w*\b.*\barm\b/,
      /\b(?:speech|words?)\b.*\b(?:slurr\w*|garbl\w*)\b|\b(?:slurr\w*|garbl\w*)\b.*\b(?:speech|words?)\b/,
      /\b(?:sudden(?:ly)?|all of a sudden|out of nowhere)\b/,
    ]) &&
    !/\bnot sudden\b/.test(text);

  const suddenSevereBreathlessness = all(text, [
    /\b(?:cant|cannot|unable to) (?:get (?:my|their|his|her) breath|get enough air|breathe)(?: at all)?\b|\bno (?:air|breath) at all\b/,
    /\b(?:sudden(?:ly)?|all of a sudden|out of nowhere)\b/,
    /\b(?:stop\w*|pause\w*|break\w*|gap\w*) between words?\b|\b(?:cant|cannot|unable to) (?:finish|speak in) (?:a |full )?sentences?\b/,
  ]);

  const unstoppableCut =
    all(text, [
      /\b(?:cut|wound|gash)\b/,
      /\b(?:bleed\w* heavily|heavy bleeding|bleed\w* a lot|profuse bleeding)\b/,
      /\b(?:wont|will not|doesnt|does not|hasnt|has not|cant|cannot) stop\b|\bstill bleeding\b/,
      /\b(?:ten|10) minutes?\b/,
      /\bpressure\b/,
    ]) &&
    !/\b(?:has|have|had|it) stopped\b/.test(text);

  const headInjury =
    all(text, [
      /\b(?:bang\w*|hit|struck|knock\w*|bump\w*) (?:my|their|his|her|the) head\b|\bhead (?:injury|impact)\b/,
      /\bconfus\w*\b/,
      /\b(?:vomit\w*|throwing up|being sick|been sick)\b/,
      /\b(?:(?:about|roughly) )?(?:an|one|1) hour ago\b|\bwithin the (?:last|past) hour\b|\bjust\b.*\bhead\b/,
    ]) &&
    !/\bnot confused\b/.test(text);

  return chestAndBreath || stroke || suddenSevereBreathlessness || unstoppableCut || headInjury;
}

const SYMPTOM_RULES: readonly SymptomRule[] = [
  {
    destination: "orthopaedics",
    matches: (text) =>
      all(text, [
        /\bankle\b/,
        /\b(?:went over on|roll\w*|twist\w*|turn\w*|sprain\w*)\b/,
        /\bswell\w*|swollen\b/,
        /\b(?:walk\w*|weight)\b/,
        /\b(?:hurt\w*|pain\w*)\b/,
      ]) &&
      !any(text, [
        /\b(?:did not|didnt|never) (?:roll|twist|turn|sprain)\b/,
        /\bwalk\w* (?:does not|doesnt|did not|didnt) hurt\b/,
      ]),
  },
  {
    destination: "orthopaedics",
    matches: (text) =>
      all(text, [
        /\b(?:bike|bicycle|cycling)\b/,
        /\b(?:came|fell|fallen|fall|thrown|knocked) off\b|\b(?:bike|bicycle|cycling) (?:crash|accident)\b/,
        /\b(?:arm|shoulder)\b/,
        /\b(?:cant|cannot|unable to|wont|will not) (?:lift|raise|move|get)\b|\b(?:lift|raise|get)\b.*\b(?:above|past|over|higher than) (?:my|the) shoulder\b/,
      ]),
  },
  {
    destination: "orthopaedics",
    matches: (text) =>
      all(text, [
        /\bknee\b/,
        /\b(?:click\w*|popp\w*)\b/,
        /\block\w*\b|\bgets? stuck\b|\bcatch\w*\b/,
        /\b(?:stairs?|steps?)\b/,
        /\b(?:gave|give|giving|gives) way\b|\bbuckl\w*\b/,
      ]),
  },
  {
    destination: "orthopaedics",
    matches: (text) =>
      all(text, [
        /\bwrist\b/,
        /\b(?:slip\w*|fell|fallen|fall|trip\w*)\b/,
        /\boutstretched (?:hand|arm)\b|\bput (?:my|their|his|her) hand out\b|\bbroke (?:my|their|his|her) fall\b|\bcaught (?:myself|himself|herself|themself|themselves)\b|\blanded on (?:my|their|his|her|the) hand\b/,
        /\b(?:hurt\w*|pain\w*|sore)\b/,
        /\bweak\w*\b/,
      ]),
  },
  {
    destination: "paediatrics",
    matches: (text) =>
      any(text, CHILD) &&
      !/\badult (?:son|daughter|child)\b/.test(text) &&
      any(text, FEVER) &&
      any(text, TWO_DAYS) &&
      any(text, [/\boff (?:his|her|their|the) food\b/, /\bnot (?:eating|hungry)\b/, /\b(?:poor|lost|no) appetite\b/]),
  },
  {
    destination: "paediatrics",
    matches: (text) =>
      any(text, CHILD) &&
      !/\badult (?:son|daughter|child)\b/.test(text) &&
      /\bcough\w*\b/.test(text) &&
      any(text, WEEK_OR_MORE) &&
      any(text, [/\bworse at night\b/, /\bnight(?:time)?\b.*\bworse\b/, /\bwors\w*\b.*\b(?:night|overnight)\b/]),
  },
  {
    destination: "paediatrics",
    matches: (text) =>
      any(text, CHILD) &&
      !/\badult (?:son|daughter|child)\b/.test(text) &&
      any(text, [/\b(?:pull\w*|tug\w*|grabb\w*) (?:at|on) (?:his|her|their|the) ear\b/, /\bear\b.*\b(?:pull\w*|tug\w*|grabb\w*)\b/]) &&
      /\b(?:cry\w*|scream\w*|in tears)\b/.test(text) &&
      any(text, [/\b(?:barely|hardly|not) slept\b/, /\b(?:little|no) sleep\b/, /\bkept (?:him|her|them|us) awake\b/, /\bcouldnt sleep\b/]),
  },
  {
    destination: "paediatrics",
    matches: (text) =>
      any(text, CHILD) &&
      !/\badult (?:son|daughter|child)\b/.test(text) &&
      any(text, [/\b(?:tummy|stomach|belly|abdomen|abdominal)\b/]) &&
      /\b(?:sore|ache\w*|pain\w*|hurt\w*)\b/.test(text) &&
      any(text, [/\bon and off\b/, /\bintermittent\w*\b/, /\bcomes? and goes?\b/, /\bkeeps? coming back\b/]) &&
      any(text, [/\b(?:a|one|1) week\b/, /\bseven days?\b/, /\b(?:past|last) week\b/]),
  },
  {
    destination: "general_practice",
    matches: (text) =>
      any(text, [/\btired\b/, /\bfatig\w*\b/, /\bexhaust\w*\b/]) &&
      any(text, [/\brun down\b/, /\brundown\b/, /\bdrained\b/, /\bgenerally unwell\b/, /\blow energy\b/, /\bworn out\b/]) &&
      any(text, WEEKS),
  },
  {
    destination: "general_practice",
    matches: (text) =>
      /\bheadache\w*\b/.test(text) &&
      /\b(?:most|nearly every|every) afternoons?\b|\bafternoons? most days\b/.test(text) &&
      any(text, [/\b(?:a|one|1) month\b/, /\b(?:last|past) month\b/, /\b(?:four|4) weeks?\b/]),
  },
  {
    destination: "general_practice",
    matches: (text) =>
      /\bsore throat\b|\bthroat\b.*\b(?:sore|hurt\w*)\b/.test(text) &&
      any(text, FEVER) &&
      /\bsince (?:the )?weekend\b|\bfrom (?:the )?weekend\b/.test(text) &&
      !/\b(?:not|no longer) fever(?:ish)?\b|\bno (?:temperature|fever)\b/.test(text),
  },
  {
    destination: "general_practice",
    matches: (text) =>
      any(text, [/\bdizz\w*\b/, /\blight ?headed\b/]) &&
      any(text, [/\b(?:on|when|after) standing\b/, /\b(?:stand|get|getting|rise|rising) up\b/, /\bget to (?:my|their|his|her) feet\b/]) &&
      any(text, [/\bmore tired than usual\b/, /\b(?:unusually|extra) tired\b/, /\bmore fatigued\b/]),
  },
  {
    destination: "gynaecology",
    matches: (text) =>
      /\bperiods?\b|\bmenstrual\b/.test(text) &&
      /\bheav\w*\b/.test(text) &&
      any(text, [/\birregular\b/, /\ball over the place\b/, /\bunpredictable\b/, /\berratic\b/, /\bnot regular\b/]) &&
      any(text, MONTHS) &&
      !/\b(?:but |are |have been )?regular\b/.test(text),
  },
  {
    destination: "gynaecology",
    matches: (text) =>
      /\b(?:bleed\w*|spotting)\b/.test(text) &&
      any(text, [/\bbetween periods?\b/, /\bbetween cycles?\b/, /\bmid ?cycle\b/]) &&
      any(text, [/\b(?:three|3) cycles?\b/, /\bthird cycle\b/, /\bcycles? running\b/]),
  },
  {
    destination: "gynaecology",
    matches: (text) =>
      /\bdull\b/.test(text) &&
      /\b(?:pain\w*|ache\w*)\b/.test(text) &&
      any(text, [/\blow down\b/, /\blower (?:abdomen|belly|tummy)\b/, /\bpelvi\w*\b/]) &&
      any(text, [/\bone side\b/, /\b(?:left|right) side\b/, /\bunilateral\b/]) &&
      any(text, WEEKS),
  },
] as const;

/**
 * Classifies only the symptom families and red flags published for the triage
 * problem. Pass an array, or multiple string arguments, to accumulate caller
 * wording across turns without retaining mutable state.
 */
export function classifyTriage(
  input: TriageInput,
  ...followingTurns: readonly string[]
): TriageDestination | undefined {
  const text = normalize(input, followingTurns);
  if (!text) return undefined;
  if (isEmergency(text)) return "medical_emergency";
  return SYMPTOM_RULES.find((rule) => rule.matches(text))?.destination;
}
