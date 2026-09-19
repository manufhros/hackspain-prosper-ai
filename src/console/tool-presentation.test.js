import assert from "node:assert/strict";
import { test } from "node:test";
import { presentTool } from "../../public/tool-presentation.js";
import { clinicalDate, TOOL_NAMES } from "../../public/model.js";

const run = (name, output, input = {}, status = "completed") => ({
  name,
  input,
  output,
  status,
});
const booking = {
  action: "BOOK",
  patient_id: "P00480",
  provider_id: "PR10",
  location_id: "sur",
  appointment_type_id: "orthopaedic_review",
  slot: "2026-09-21T09:30:00+02:00",
  policy_id: "sanitas",
};
const receipt = (actions) => ({
  call_id: "call-1",
  received_at: "2026-09-19T00:12:31.242841Z",
  record: { actions },
});

test("booking receipt displays the actual recorded appointment with translated labels and Madrid time", () => {
  const { html } = presentTool(
    run("submit_book", receipt([booking]), {
      ...booking,
      slot: "2026-09-22T10:00:00+02:00",
    }),
  );
  for (const value of [
    "Reserva registrada",
    "P00480",
    "PR10",
    "Arenal Sur",
    "Revisión de traumatología",
    "Sanitas",
    "09:30",
    "Recibido",
  ])
    assert.ok(html.includes(value), value);
  assert.ok(
    html.indexOf("09:30") < html.indexOf("Solicitud"),
    "response is not reconstructed from input",
  );
  assert.ok(!html.includes("patient_id"));
  assert.ok(
    !html.includes("call-1"),
    "receipt identifiers stay in technical details",
  );
});

test("names resolve from earlier successful tools in this call, never from future or failed runs", () => {
  const directory = run("search_directory", {
    matches: [
      { patient_id: "P00480", given_name: "Ana", first_surname: "López" },
    ],
  });
  const availability = run("search_availability", {
    slots: [{ provider_id: "PR10", provider_name: "Dra. Vega" }],
  });
  const book = run("submit_book", receipt([booking]), booking);
  const html = presentTool(book, [directory, availability, book]).html;
  assert.match(html, /Ana López · P00480/);
  assert.match(html, /Dra. Vega · PR10/);
  assert.doesNotMatch(
    presentTool(book, [book, directory, availability]).html,
    /Ana López|Dra. Vega/,
  );
  assert.doesNotMatch(
    presentTool(book, [{ ...directory, status: "failed" }, book]).html,
    /Ana López/,
  );
});

test("directory renders each match, false values, identity details, referrals and no-match state", () => {
  const match = {
    given_name: "Ana",
    first_surname: "López",
    date_of_birth: "1990-01-02",
    has_visited_before: false,
    insurer: "dkv",
    referrals: ["dermatology"],
    note: "Prefiere la tarde",
  };
  const result = presentTool(
    run("search_directory", { matches: [match, { given_name: "Eva" }] }),
  );
  assert.equal(result.summary, "2 pacientes encontrados");
  for (const value of [
    "Ana López",
    "Eva",
    "No",
    "DKV",
    "Dermatología",
    "Prefiere la tarde",
    "1990",
  ])
    assert.ok(result.html.includes(value));
  assert.match(
    presentTool(run("search_directory", { matches: [] })).html,
    /No se encontraron pacientes/,
  );
});

test("ranked and full availability show slots, Saturday alternatives and every restriction", () => {
  const slot = {
    start_time: booking.slot,
    provider_id: "PR10",
    provider_name: "Dra. Vega",
    location_id: "sur",
    appointment_type_id: "orthopaedic_review",
  };
  const output = {
    soonest: slot,
    slots: [slot],
    saturday: [{ ...slot, start_time: "2026-09-26T10:00:00+02:00" }],
    blocked: [{ provider_id: "PR12", restriction: "provider_on_leave" }],
    appointment_type_id: "orthopaedic_review",
  };
  const result = presentTool(
    run("search_availability", JSON.stringify(output)),
  );
  assert.equal(result.summary, "1 horario disponible");
  for (const value of [
    "Primera disponibilidad",
    "Opciones en sábado",
    "Profesional ausente",
    "Dra. Vega",
    "Revisión de traumatología",
  ])
    assert.ok(result.html.includes(value));
  assert.match(
    presentTool(
      run("search_availability", {
        slots: [],
        blocked: [{ restriction: "referral_required" }],
      }),
    ).html,
    /No hay horarios disponibles[\s\S]*Se necesita una derivación/,
  );
});

test("appointments render identifiers, dates, duration, and the empty state", () => {
  const result = presentTool(
    run("list_appointments", {
      appointments: [
        {
          appointment_id: "APT-1",
          start_time: booking.slot,
          duration_minutes: 30,
        },
      ],
    }),
  );
  assert.equal(result.summary, "1 cita encontrada");
  assert.match(result.html, /APT-1[\s\S]*30 min/);
  assert.match(
    presentTool(run("list_appointments", { appointments: [] })).html,
    /No se encontraron citas/,
  );
});

test("all submission tools render their actual action and support cumulative receipts", () => {
  const cases = [
    ["submit_book", booking, "Reserva registrada"],
    [
      "submit_cancel",
      { action: "CANCEL", appointment_id: "APT-1" },
      "Cancelación registrada",
    ],
    [
      "submit_reschedule",
      { action: "RESCHEDULE", appointment_id: "APT-1", slot: booking.slot },
      "Cambio de cita registrado",
    ],
    [
      "submit_register",
      {
        action: "REGISTER",
        new_patient: { given_name: "Eva", insurer: "sanitas" },
      },
      "Alta de paciente registrada",
    ],
    [
      "submit_no_action",
      { action: "NO_ACTION", reason: "no_availability" },
      "Sin gestión adicional",
    ],
    [
      "submit_escalate",
      { action: "ESCALATE", reason: "medical_emergency" },
      "Derivación registrada",
    ],
  ];
  assert.deepEqual(
    cases.map(([name]) => name).sort(),
    Object.keys(TOOL_NAMES)
      .filter((name) => name.startsWith("submit_"))
      .sort(),
  );
  for (const [name, action, expected] of cases)
    assert.ok(
      presentTool(run(name, receipt([action]))).html.includes(expected),
    );
  const html = presentTool(
    run("submit_book", receipt(cases.map(([, action]) => action))),
  ).html;
  for (const [, , expected] of cases) assert.ok(html.includes(expected));
  assert.match(html, /Urgencia médica/);
  assert.match(
    presentTool(run("submit_book", receipt([]))).html,
    /Registro sin acciones/,
  );
});

test("failures, running and interrupted calls never claim successful actions", () => {
  assert.match(
    presentTool(run("submit_book", { error: "missing book fields" })).html,
    /Faltan datos necesarios para reservar/,
  );
  for (const status of ["running", "failed", "interrupted"]) {
    const result = presentTool(
      run("submit_book", receipt([booking]), {}, status),
    );
    assert.notEqual(result.summary, "Registro recibido");
    if (status !== "failed")
      assert.doesNotMatch(result.html, /Reserva registrada/);
  }
  assert.match(
    presentTool(run("submit_book", undefined)).html,
    /No se recibió un resultado/,
  );
});

test("unknown, malformed and nested payloads remain readable without crashing or hiding false/zero", () => {
  for (const output of [
    null,
    undefined,
    "truncated {",
    0,
    false,
    [],
    [null, "item"],
    { nested: { count: 0, enabled: false } },
    { matches: [null, 5] },
  ])
    assert.doesNotThrow(() => presentTool(run("new_tool", output)));
  assert.match(
    presentTool(run("new_tool", { nested: { enabled: false, count: 0 } })).html,
    /Enabled[\s\S]*No[\s\S]*Count[\s\S]*0/,
  );
  assert.match(
    presentTool(run("submit_book", "truncated {")).html,
    /truncated/,
  );
});

test("all untrusted names, keys and values are escaped, including prototype-shaped codes", () => {
  const attack = '<img src=x onerror="alert(1)">';
  const result = presentTool(
    run(
      "search_directory",
      {
        matches: [
          { given_name: attack, [attack]: attack, insurer: "constructor" },
        ],
      },
      { name: attack },
    ),
  );
  assert.ok(!result.html.includes("<img"));
  assert.match(result.html, /&lt;img/);
  assert.match(result.html, /constructor/);
  assert.doesNotMatch(result.html, /function Object/);
});

test("clinical dates handle daylight saving, date-only values and malformed input", () => {
  assert.match(clinicalDate("2026-09-21T07:30:00Z"), /09:30/);
  assert.match(clinicalDate("2026-12-21T08:30:00Z"), /09:30/);
  assert.match(clinicalDate("1990-01-02"), /^2 ene 1990$/);
  assert.equal(clinicalDate("2026-99-99"), "2026-99-99");
  assert.equal(clinicalDate("bad date"), "bad date");
});
