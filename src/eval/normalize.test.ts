import { describe, expect, test } from "bun:test";
import {
  actionsEqual,
  normalizeEmail,
  normalizeEnum,
  normalizeNationalId,
  normalizePhone,
  normalizeSlot,
} from "./normalize";

describe("Prosper scorer normalization", () => {
  test("normalizes DNI and NIE exactly like the published table", () => {
    expect(normalizeNationalId("12345678-Z")).toBe("12345678Z");
    expect(normalizeNationalId("1234 5678 z")).toBe("12345678Z");
    expect(normalizeNationalId("x-1234567-l")).toBe("X1234567L");
  });

  test("normalizes Spanish phones and email", () => {
    expect(normalizePhone("+34 612 345 678")).toBe("612345678");
    expect(normalizePhone("0034612345678")).toBe("612345678");
    expect(normalizeEmail(" Ana.Garcia @ Gmail.com ")).toBe("ana.garcia@gmail.com");
  });

  test("compares appointment slots by instant and minute", () => {
    expect(normalizeSlot("2026-09-19T10:30:07+02:00")).toBe(
      normalizeSlot("2026-09-19T08:30:00+00:00"),
    );
  });

  test("folds free-text enums", () => {
    expect(normalizeEnum("  Review  ")).toBe("review");
    expect(normalizeEnum("NO_AVAILABILITY")).toBe("no_availability");
    expect(normalizeEnum("Paediátric_Review")).toBe("paediatric_review");
  });

  test("allows surname order and accents for REGISTER", () => {
    expect(
      actionsEqual(
        [
          {
            action: "REGISTER",
            new_patient: {
              given_name: "José",
              first_surname: "López",
              second_surname: "Garcia",
            },
          },
        ],
        [
          {
            action: "REGISTER",
            new_patient: {
              given_name: "jose",
              first_surname: "García",
              second_surname: "López",
            },
          },
        ],
      ),
    ).toBe(true);
  });

  test("does not normalize exact IDs", () => {
    expect(
      actionsEqual(
        [
          {
            action: "BOOK",
            patient_id: "P00001",
            provider_id: "pr01",
            location_id: "centro",
            appointment_type_id: "review",
            slot: "2026-09-19T11:00:00+02:00",
            policy_id: "mapfre",
          },
        ],
        [
          {
            action: "BOOK",
            patient_id: "P00001",
            provider_id: "PR01",
            location_id: "centro",
            appointment_type_id: "review",
            slot: "2026-09-19T11:00:00+02:00",
            policy_id: "mapfre",
          },
        ],
      ),
    ).toBe(false);
  });
});
