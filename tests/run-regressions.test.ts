import { it, expect } from "vitest";
import { Session } from "../packages/domain/src/session.js";
import { explicitConfirmation } from "../packages/domain/src/confirmation.js";
import { ToolGateway } from "../packages/application/src/tools.js";
import { FixtureClinic } from "../packages/adapters/src/clinic.js";
import type { Availability, BookingRequest } from "../packages/contracts/src/index.js";

// Anonymized regression inputs from the 18 Sep 22:21 UTC calls (run 41).
class LoggedClinic extends FixtureClinic {
  queries: unknown[] = [];
  async catalog() { return { ...await super.catalog(), specialties: [
    { id: "general_practice", name: "General Practice" }, { id: "orthopaedics", name: "Orthopaedics" },
  ] }; }
  async availability(request: BookingRequest & { patient_id: string }): Promise<Availability> {
    this.queries.push(request);
    if (request.specialty_id === "orthopedics") throw Error("404 no matching provider");
    const result = await super.availability(request);
    return { ...result, slots: result.slots.map(s => ({ ...s, specialty_id: request.specialty_id! })) };
  }
}
async function setup() {
  const session = new Session("replay", new Date("2026-09-18T22:21:49Z"), () => {});
  const clinic = new LoggedClinic(), tools = new ToolGateway(session, clinic), task = session.newTask();
  session.identify(task, clinic.patient);
  return { session, clinic, tools, task };
}
it("replays the wrong orthopedics spelling with server-calculated Madrid dates", async () => {
  const {session,clinic,tools,task} = await setup();
  expect((await tools.execute("search_earliest", {task_id:task.id,request:{specialty_id:"orthopedics"}})).ok).toBe(true);
  expect(task.request).toMatchObject({specialty_id:"orthopaedics",date_from:"2026-09-20",date_to:"2026-10-03"});
  expect(task.slots.length).toBeGreaterThan(0);
  expect(clinic.queries).toHaveLength(1);
  expect(session.earliestWindow()).toEqual({date_from:"2026-09-20",date_to:"2026-10-03"});
});
it("rejects the logged 2024 dates before any availability request and returns recovery context",async()=>{
  const {tools,task,clinic}=await setup();
  const r=await tools.execute("set_request",{task_id:task.id,request:{date_from:"2024-09-19",date_to:"2024-10-02",specialty_id:"general_practice"}});
  expect(r.error).toBe("future_date_required");expect(r.data).toHaveProperty("earliestSearch");expect(clinic.queries).toHaveLength(0);
});
it("accepts the three actual spoken confirmations but rejects negations and corrections",()=>{
  for(const text of ["Ah, yes, that's fine. Please book it.","Yes, please go ahead.","Mm, yes, I confirm.","Sí, por favor.","D'acord."])expect(explicitConfirmation(text),text).toBe(true);
  for(const text of ["Yes, but another day", "No, I confirm nothing", "I don't confirm", "Yes if it is tomorrow", "Book it?", "Maybe", "Sí, pero el lunes"]) {
    expect(explicitConfirmation(text),text).toBe(false);
  }
});
it("requires a new answer after the summary, preserves repeated proposals, and invalidates corrections",async()=>{
  const {session,tools,task}=await setup();await tools.execute("search_earliest",{task_id:task.id,request:{specialty_id:"general_practice"}});
  const args={task_id:task.id,slot_index:0,policy_id:"sanitas",language:"en"};
  await tools.execute("propose_booking",args);const proposal=task.proposal!;
  session.hear("Yes, please go ahead.");session.presented(proposal.summary);
  expect(()=>session.confirm(task,proposal.id)).toThrow("proposal_must_be_presented_first");
  session.hear("Mm, yes, I confirm.");await tools.execute("propose_booking",args);
  expect(task.proposal!.id).toBe(proposal.id);session.confirm(task,proposal.id);
  expect(session.finalActions()[0]?.action.action).toBe("BOOK");
  await tools.execute("search_earliest",{task_id:task.id,request:{specialty_id:"general_practice",period:"afternoon"}});
  expect(session.finalActions()).toEqual([]);
});
it("caps unchanged failed availability lookups at two without misclassifying them",async()=>{
  const {tools,task,clinic}=await setup();let attempts=0;clinic.availability=async()=>{attempts++;throw Error("unavailable");};
  for(let i=0;i<3;i++)await tools.execute("search_earliest",{task_id:task.id,request:{specialty_id:"general_practice"}});
  expect(attempts).toBe(2);
  expect((await tools.execute("conclude",{task_id:task.id,action:"NO_ACTION",reason:"no_availability"})).error).toBe("availability_evidence_required");
});
it("bounds model availability for 250 slots while preserving pagination and booking indices", async () => {
  const {session,tools,task,clinic}=await setup();
  await tools.execute("search_earliest",{task_id:task.id,request:{specialty_id:"general_practice"}});
  const base=task.slots[0]!;
  clinic.availability=async()=>({slots:Array.from({length:250},()=>({...base})),blocked:[]});
  const first=await tools.execute("find_slots",{task_id:task.id});
  expect(first.ok).toBe(true);
  expect(first.data).toMatchObject({total:250,next_offset:5});
  expect((first.data as {slots:unknown[]}).slots).toHaveLength(5);
  expect(task.slots).toHaveLength(250);
  const compact=JSON.stringify(session.modelSnapshot()), full=JSON.stringify(session.snapshot());
  expect(compact.length).toBeLessThan(full.length/10);
  expect(session.modelSnapshot().tasks[0]).not.toHaveProperty("slots");
  const page=await tools.execute("more_slots",{task_id:task.id,offset:245,revision:task.revision});
  expect(page.data).toMatchObject({next_offset:null,slots:[{index:245},{index:246},{index:247},{index:248},{index:249}]});
  expect((await tools.execute("propose_booking",{task_id:task.id,slot_index:249,policy_id:"sanitas",language:"en"})).ok).toBe(true);
  const revision=task.revision;
  await tools.execute("set_request",{task_id:task.id,request:{...task.request,period:"afternoon"}});
  expect((await tools.execute("more_slots",{task_id:task.id,offset:5,revision})).error).toBe("stale_result");
});
