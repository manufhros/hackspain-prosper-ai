import { describe, expect, test } from "bun:test";
import { createCallState } from "../state/call-state";
import {
  buildCancelPayload,
  buildRegisterPayload,
  validSpanishNationalId,
} from "./submissions";

describe("submission guards", () => {
  test("validates DNI and NIE check letters", () => {
    expect(validSpanishNationalId("48064716Y")).toBe(true);
    expect(validSpanishNationalId("X2245876H")).toBe(true);
    expect(validSpanishNationalId("48064716Z")).toBe(false);
  });

  test("builds normalized REGISTER only when complete", () => {
    const state = createCallState("CA1");
    state.registration = {
      given_name: "Joaquín",
      first_surname: "González",
      second_surname: "Ortega",
      national_id: "18 921 027-P",
      date_of_birth: "1970-06-25",
      phone: "+34 783 869 132",
      email: " Joaquin@Example.COM ",
      insurer: "cigna",
    };
    expect(buildRegisterPayload(state)).toMatchObject({
      call_id: "CA1",
      national_id: "18921027P",
      email: "joaquin@example.com",
    });
  });

  test("rejects cancellation IDs not returned by appointments", () => {
    const state = createCallState("CA1");
    expect(() => buildCancelPayload(state, "A000001")).toThrow("upcoming appointments");
  });
});
