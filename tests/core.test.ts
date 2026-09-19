import { describe, it, expect } from "vitest";
import { Session } from "../packages/domain/src/session.js";
import { ToolGateway } from "../packages/application/src/tools.js";
import {
  FixtureClinic,
  MemorySink,
  ProsperHttp,
  ProsperSink,
} from "../packages/adapters/src/clinic.js";
import {
  MemoryRepository,
  FileRepository,
} from "../packages/adapters/src/storage.js";
import { DeliveryService } from "../packages/runtime/src/delivery.js";
import { bookingScenario } from "../packages/evaluation/src/scenario.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const date = new Date("2026-09-18T10:00:00Z");
const request = {
  date_from: "2026-09-21",
  date_to: "2026-09-21",
  specialty_id: "general_practice",
};
async function prepared(clinic = new FixtureClinic()) {
  const session = new Session("call", date, () => {}),
    tools = new ToolGateway(session, clinic),
    task = session.newTask();
  session.hear("Quiero una cita");
  await tools.execute("verify_patient", {
    task_id: task.id,
    national_id: "12345678Z",
    date_of_birth: "1988-03-14",
  });
  await tools.execute("set_request", { task_id: task.id, request });
  await tools.execute("find_slots", { task_id: task.id });
  return { session, tools, task, clinic };
}
describe("Guardas de agenda", () => {
  it("requires two identifiers and refuses ambiguity", async () => {
    const s = new Session("c", date, () => {}),
      clinic = new FixtureClinic(),
      g = new ToolGateway(s, clinic),
      t = s.newTask();
    expect(
      (
        await g.execute("verify_patient", {
          task_id: t.id,
          national_id: "12345678Z",
        })
      ).error,
    ).toBe("two_identifiers_required");
    clinic.patients = async () => [clinic.patient, clinic.patient];
    expect(
      (
        await g.execute("verify_patient", {
          task_id: t.id,
          national_id: "12345678Z",
          phone: "612345678",
        })
      ).data,
    ).toEqual({ status: "ambiguous", count: 2 });
    expect(t.patient).toBeUndefined();
  });
  it("requires presentation then a new explicit confirmation", async () => {
    const { session, tools, task } = await prepared();
    await tools.execute("propose_booking", {
      task_id: task.id,
      slot_index: 0,
      policy_id: "sanitas",
    });
    const p = task.proposal!;
    expect(
      (
        await tools.execute("confirm_proposal", {
          task_id: task.id,
          proposal_id: p.id,
        })
      ).ok,
    ).toBe(false);
    session.presented(p.summary);
    session.hear("sí, pero por la tarde");
    expect(
      (
        await tools.execute("confirm_proposal", {
          task_id: task.id,
          proposal_id: p.id,
        })
      ).error,
    ).toBe("explicit_confirmation_required");
    session.hear("sí");
    expect(
      (
        await tools.execute("confirm_proposal", {
          task_id: task.id,
          proposal_id: p.id,
        })
      ).ok,
    ).toBe(true);
  });
  it("invalidates confirmation and slots after correction", async () => {
    const { session, tools, task } = await prepared();
    await tools.execute("propose_booking", {
      task_id: task.id,
      slot_index: 0,
      policy_id: "sanitas",
    });
    const p = task.proposal!;
    session.presented(p.summary);
    session.hear("sí");
    session.confirm(task, p.id);
    expect(session.finalActions()).toHaveLength(1);
    session.request(task, { ...request, period: "afternoon" });
    expect(session.finalActions()).toHaveLength(0);
    expect(task.slots).toHaveLength(0);
    expect(() => session.confirm(task, p.id)).toThrow("stale_proposal");
  });
  it("discards a stale lookup after preferences change", async () => {
    const { session, tools, task, clinic } = await prepared();
    const original = clinic.availability.bind(clinic);
    let release!: () => void;
    clinic.availability = async (r) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return original(r);
    };
    const pending = tools.execute("find_slots", { task_id: task.id });
    session.request(task, { ...request, location_id: "norte" });
    release();
    expect((await pending).error).toBe("stale_result");
    expect(task.slots).toHaveLength(0);
  });
  it("filters same day and enforces the requested period", async () => {
    const { session, tools, task } = await prepared();
    session.request(task, {
      ...request,
      date_from: "2026-09-18",
      date_to: "2026-09-18",
    });
    await tools.execute("find_slots", { task_id: task.id });
    expect(task.slots).toHaveLength(0);
    session.request(task, { ...request, period: "afternoon" });
    await tools.execute("find_slots", { task_id: task.id });
    expect(task.slots).toHaveLength(1);
    expect(task.slots[0]?.start_time).toContain("16:00");
  });
  it("cannot invent an accepted insurer or refusal", async () => {
    const { tools, task } = await prepared();
    expect(
      (
        await tools.execute("propose_booking", {
          task_id: task.id,
          slot_index: 0,
          policy_id: "invented",
        })
      ).error,
    ).toBe("policy_not_accepted");
    expect(
      (
        await tools.execute("conclude", {
          task_id: task.id,
          action: "NO_ACTION",
          reason: "no_availability",
        })
      ).error,
    ).toBe("availability_evidence_required");
    expect(
      (
        await tools.execute("conclude", {
          task_id: task.id,
          action: "NO_ACTION",
          reason: "referral_required",
        })
      ).error,
    ).toBe("restriction_evidence_required");
  });
  it("supports an explicit emergency disposition without a booking", async () => {
    const { tools, task, session } = await prepared();
    expect(
      (
        await tools.execute("conclude", {
          task_id: task.id,
          action: "ESCALATE",
          reason: "medical_emergency",
        })
      ).ok,
    ).toBe(true);
    expect(session.finalActions()[0]?.action).toEqual({
      action: "ESCALATE",
      reason: "medical_emergency",
    });
  });
  it("checks ownership for cancellation and rescheduling", async () => {
    const { tools, task } = await prepared();
    expect(
      (
        await tools.execute("propose_cancellation", {
          task_id: task.id,
          appointment_id: "someone-else",
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await tools.execute("propose_cancellation", {
          task_id: task.id,
          appointment_id: "DEMO-A1",
        })
      ).ok,
    ).toBe(true);
    expect(task.proposal?.action.action).toBe("CANCEL");
    await tools.execute("propose_booking", {
      task_id: task.id,
      appointment_id: "DEMO-A1",
      slot_index: 0,
      policy_id: "sanitas",
    });
    expect(task.proposal?.action.action).toBe("RESCHEDULE");
  });
});
describe("Entrega y persistencia", () => {
  it("isolates 20 concurrent calls", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, bookingScenario),
    );
    expect(new Set(results.map((r) => r.runtime.callId)).size).toBe(20);
    for (const r of results) {
      expect(r.sink.records.size).toBe(1);
      expect(r.sink.records.get(r.runtime.callId)).toHaveLength(1);
    }
  });
  it("retries exactly the same action and deduplicates concurrent sends", async () => {
    const repo = new MemoryRepository();
    let calls = 0;
    const sink = new MemorySink();
    const deliver = sink.deliver.bind(sink);
    sink.deliver = async (...args) => {
      if (++calls === 1) throw new Error("network");
      return deliver(...args);
    };
    const svc = new DeliveryService(repo, sink, () => 100);
    const d = await svc.prepare(
      "c",
      "t",
      { action: "CANCEL", appointment_id: "a" },
      100,
    );
    expect((await svc.send(d)).status).toBe("pending");
    await Promise.all([svc.send(d), svc.send(d)]);
    expect(calls).toBe(2);
    expect(sink.records.get("c")).toHaveLength(1);
  });
  it("recovers durable pending actions and expires them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arenal-test-"));
    try {
      const first = await FileRepository.open(dir);
      await new DeliveryService(first, new MemorySink(), () => 0).prepare(
        "c",
        "t",
        { action: "NO_ACTION", reason: "out_of_scope" },
        0,
      );
      await first.close();
      const recovered = await FileRepository.open(dir);
      await new DeliveryService(
        recovered,
        new MemorySink(),
        () => 31000,
      ).recover();
      expect((await recovered.deliveries())[0]?.status).toBe("expired");
      await recovered.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("flattens registration and maps 409 to duplicate", async () => {
    let body: any;
    let path = "";
    const http = new ProsperHttp(
      "https://example.test",
      "test",
      async (url, init) => {
        path = String(url);
        body = JSON.parse(String(init?.body));
        return new Response("{}", { status: 409 });
      },
    );
    const sink = new ProsperSink(http);
    const p = {
      given_name: "A",
      first_surname: "B",
      second_surname: "C",
      national_id: "00000000T",
      date_of_birth: "1990-01-01",
      phone: "600000000",
      email: "a@example.test",
      insurer: "sanitas" as const,
    };
    expect(
      (
        await sink.deliver("real-call-id", {
          action: "REGISTER",
          new_patient: p,
        })
      ).status,
    ).toBe("duplicate");
    expect(path).toBe("https://example.test/api/v1/submit/register");
    expect(body).toEqual({ call_id: "real-call-id", ...p });
  });
});

it("clears an old verified patient when a new identity cannot be verified", async () => {
  const { tools, task } = await prepared();
  expect(task.patient).toBeDefined();
  const result = await tools.execute("verify_patient", {
    task_id: task.id,
    national_id: "00000000T",
    date_of_birth: "1990-01-01",
  });
  expect(result.data).toEqual({ status: "not_found", count: 0 });
  expect(task.patient).toBeUndefined();
  expect(task.slots).toHaveLength(0);
});
it("registers a new patient only after validating the check digit and confirmation", async () => {
  const { tools, task, session } = await prepared();
  const patient = {
    given_name: "Nueva",
    first_surname: "Persona",
    second_surname: "Prueba",
    national_id: "00000000A",
    date_of_birth: "1990-01-01",
    phone: "600000000",
    email: "nueva@example.test",
    insurer: "privado",
  };
  expect(
    (await tools.execute("propose_registration", { task_id: task.id, patient }))
      .error,
  ).toBe("invalid_national_id");
  expect(
    (
      await tools.execute("propose_registration", {
        task_id: task.id,
        patient: { ...patient, national_id: "00000000T" },
      })
    ).ok,
  ).toBe(true);
  const proposal = task.proposal!;
  session.presented(proposal.summary);
  session.hear("sí");
  session.confirm(task, proposal.id);
  expect(session.finalActions()[0]?.action.action).toBe("REGISTER");
});

it('localises the proposal without modifying its submitted action',async()=>{
 const {tools,task,session}=await prepared();
 await tools.execute('propose_booking',{task_id:task.id,slot_index:0,policy_id:'sanitas',language:'en'});
 const english=task.proposal!;expect(english.summary).toContain('insurance sanitas');expect(english.summary).not.toContain('seguro');expect(english.summary).not.toContain('T09:');
 session.presented(english.summary);session.hear('Yes, confirmo.');expect(()=>session.confirm(task,english.id)).not.toThrow();
 await tools.execute('propose_booking',{task_id:task.id,slot_index:0,policy_id:'sanitas',language:'ca'});expect(task.proposal!.summary).toContain('assegurança');expect(task.proposal!.action).toEqual(english.action);
 session.presented(task.proposal!.summary);session.hear('Yes, confirmo, but another day');expect(()=>session.confirm(task,task.proposal!.id)).toThrow('explicit_confirmation_required');
});
