import test from "node:test";
import assert from "node:assert/strict";
import { directoryIdentity, spokenIdentity } from "./caller-identity.ts";

test("directory identity requires one unredacted patient", () => {
  const patient = { given_name: "Josefa", first_surname: "Domínguez", second_surname: "Navarro", patient_id: "P01", insurer: "sanitas" };
  assert.deepEqual(directoryIdentity({ matches: [patient] }), { patientName: "Josefa Domínguez Navarro", patientId: "P01", insurer: "sanitas" });
  assert.equal(directoryIdentity({ matches: [patient, patient] }), undefined);
  assert.equal(directoryIdentity({ matches: [] }), undefined);
  assert.equal(directoryIdentity({ matches: [{ ...patient, given_name: "[redacted]" }] }), undefined);
});

test("spoken display names accept explicit introductions and direct name answers", () => {
  assert.deepEqual(spokenIdentity("Sí, soy Josefa Domínguez Navarro."), { patientName: "Josefa Domínguez Navarro" });
  assert.deepEqual(spokenIdentity("My full name is Michael Evans Parker. My date of birth is tomorrow."), { patientName: "Michael Evans Parker" });
  assert.deepEqual(spokenIdentity("Yo me llamo Lucía."), { patientName: "Lucía" });
  assert.deepEqual(spokenIdentity("María de la Cruz", "¿Cuál es su nombre completo?"), { patientName: "María de la Cruz" });
  assert.deepEqual(spokenIdentity("me llamo facundo tannhausen"), { patientName: "Facundo Tannhausen" });
  for (const phrase of ["Sí, soy yo.", "Yo vengo privado, es que soy rico.", "This is an emergency", "Me llamo porque necesito una cita", "Quiero hablar con María", "My name is [redacted]"]) {
    assert.equal(spokenIdentity(phrase), undefined, phrase);
  }
  assert.equal(spokenIdentity("María de la Cruz"), undefined);
});
