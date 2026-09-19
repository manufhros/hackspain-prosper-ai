import { explicitConfirmation } from "./confirmation.js";
import { randomUUID } from "node:crypto";
import {
  actionSchema,
  DomainError,
  requestSchema,
  type Action,
  type BookingRequest,
  type Patient,
  type Slot,
} from "../../contracts/src/index.js";
export type Proposal = {
  id: string;
  revision: number;
  action: Action;
  summary: string;
  createdTurn: number;
  presented: boolean;
  presentedTurn?: number;
  confirmed: boolean;
};
export type Task = {
  id: string;
  revision: number;
  patient?: Patient;
  request?: BookingRequest;
  slots: Slot[];
  blocked: string[];
  proposal?: Proposal;
};
export const madridDate = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
export const madridHour = (date: Date) =>
  Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Madrid",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(date),
  );
export function validNationalId(value: string): boolean {
  const s = value.toUpperCase().replace(/[\s-]/g, "");
  if (!/^(\d{8}|[XYZ]\d{7})[A-Z]$/.test(s)) return false;
  const n = s.slice(0, -1).replace(/^[XYZ]/, (v) => String("XYZ".indexOf(v)));
  return "TRWAGMYFPDXBNJZSQVHLCKE"[Number(n) % 23] === s.at(-1);
}
export class Session {
  readonly tasks = new Map<string, Task>();
  turn = 0;
  lastUserText = "";
  closed = false;
  constructor(
    readonly callId: string,
    readonly startedAt: Date,
    readonly emit: (type: string, data: unknown) => void,
  ) {}
  getTask(id: string): Task {
    const t = this.tasks.get(id);
    if (!t) throw new DomainError("unknown_task");
    return t;
  }
  newTask(): Task {
    this.assertOpen();
    const task: Task = {
      id: randomUUID(),
      revision: 0,
      slots: [],
      blocked: [],
    };
    this.tasks.set(task.id, task);
    this.emit("task.created", { taskId: task.id });
    return task;
  }
  assertOpen() {
    if (this.closed) throw new DomainError("call_closed");
  }
  hear(text: string) {
    this.assertOpen();
    this.turn++;
    this.lastUserText = text;
    this.emit("user.text", { text });
  }
  invalidate(task: Task) {
    this.assertOpen();
    task.revision++;
    task.slots = [];
    task.blocked = [];
    task.proposal = undefined;
    this.emit("task.invalidated", { taskId: task.id, revision: task.revision });
  }
  identify(task: Task, patient: Patient) {
    this.invalidate(task);
    task.patient = patient;
    task.request = undefined;
    this.emit("patient.verified", {
      taskId: task.id,
      patientId: patient.patient_id,
      name: [patient.given_name, patient.first_surname].join(" "),
    });
  }
  request(task: Task, input: unknown) {
    const request = requestSchema.parse(input);
    const from = Date.parse(request.date_from),
      to = Date.parse(request.date_to);
    if (request.date_from < madridDate(this.startedAt)) throw new DomainError("future_date_required");
    if (to < from || to - from > 13 * 86400000)
      throw new DomainError("window_must_be_1_to_14_days");
    this.invalidate(task);
    task.request = request;
    this.emit("request.updated", {
      taskId: task.id,
      request,
      revision: task.revision,
    });
  }
  acceptSlots(task: Task, revision: number, slots: Slot[], blocked: string[]) {
    this.assertOpen();
    if (task.revision !== revision) {
      this.emit("result.discarded", { taskId: task.id, revision });
      throw new DomainError("stale_result");
    }
    const today = madridDate(this.startedAt);
    task.slots = slots
      .filter((s) => {
        const date = new Date(s.start_time);
        const day = madridDate(date);
        const req = task.request;
        return (
          day > today &&
          (!req ||
            (day >= req.date_from &&
              day <= req.date_to &&
              (!req.provider_id || s.provider_id === req.provider_id) &&
              (!req.location_id || s.location_id === req.location_id) &&
              (!req.specialty_id || s.specialty_id === req.specialty_id) &&
              (req.period === "any" ||
                (req.period === "morning"
                  ? madridHour(date) < 14
                  : madridHour(date) >= 14))))
        );
      })
      .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
    task.blocked = blocked;
    this.emit("availability.received", {
      taskId: task.id,
      count: task.slots.length,
      blocked,
    });
  }
  propose(task: Task, raw: unknown, summary: string) {
    this.assertOpen();
    const action = actionSchema.parse(raw);
    if (
      action.action === "REGISTER" &&
      !validNationalId(action.new_patient.national_id)
    )
      throw new DomainError("invalid_national_id");
    if (task.proposal?.revision === task.revision && task.proposal.summary === summary && JSON.stringify(task.proposal.action) === JSON.stringify(action)) return task.proposal;
    const proposal: Proposal = {
      id: randomUUID(),
      revision: task.revision,
      action,
      summary,
      createdTurn: this.turn,
      presented: false,
      confirmed: false,
    };
    task.proposal = proposal;
    this.emit("proposal.created", { taskId: task.id, ...proposal });
    return proposal;
  }
  presented(text: string) {
    for (const t of this.tasks.values())
      if (t.proposal && text.includes(t.proposal.summary)) {
        t.proposal.presented = true;
        t.proposal.presentedTurn = this.turn;
        this.emit("proposal.presented", { taskId: t.id, proposalId: t.proposal.id });
      }
  }
  confirm(task: Task, id: string) {
    this.assertOpen();
    const p = task.proposal;
    if (!p || p.id !== id || p.revision !== task.revision)
      throw new DomainError("stale_proposal");
    if (!p.presented || this.turn <= (p.presentedTurn ?? p.createdTurn))
      throw new DomainError("proposal_must_be_presented_first");
    if (!explicitConfirmation(this.lastUserText))
      throw new DomainError("explicit_confirmation_required");
    p.confirmed = true;
    this.emit("proposal.confirmed", { taskId: task.id, proposalId: p.id });
    return p;
  }
  finalActions() {
    return [...this.tasks.values()].flatMap((t) =>
      t.proposal?.confirmed && t.proposal.revision === t.revision
        ? [{ taskId: t.id, action: t.proposal.action }]
        : [],
    );
  }
  earliestWindow() {
    const today = Date.parse(madridDate(this.startedAt));
    const day = (offset: number) => new Date(today + offset * 86400000).toISOString().slice(0, 10);
    return { date_from: day(1), date_to: day(14) };
  }
  modelSnapshot() {
    const state = this.snapshot();
    return { ...state, tasks: state.tasks.map(({ slots, ...task }) => ({
      ...task, availability: { total: slots.length, page_size: 5 },
    })) };
  }
  snapshot() {
    return {
      callId: this.callId,
      startedAt: this.startedAt.toISOString(),
      today: madridDate(this.startedAt),
      timezone: "Europe/Madrid",
      earliestSearch: this.earliestWindow(),
      closed: this.closed,
      tasks: [...this.tasks.values()].map((t) => ({
        ...t,
        patient: t.patient
          ? {
              patient_id: t.patient.patient_id,
              given_name: t.patient.given_name,
              first_surname: t.patient.first_surname,
            }
          : undefined,
      })),
    };
  }
}
