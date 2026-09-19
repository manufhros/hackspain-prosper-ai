import { it, expect } from "vitest";
import { languageHint, supportedLanguage } from "../packages/conversation/src/language.js";
it("normalizes provider codes but rejects languages outside clinic coverage", () => {
  expect(supportedLanguage("eng")).toBe("en");
  expect(supportedLanguage("es-ES")).toBe("es");
  expect(supportedLanguage("cat")).toBe("ca");
  expect(supportedLanguage("fr")).toBeUndefined();
  expect(supportedLanguage("eu")).toBeUndefined();
});
it("does not switch on acknowledgements, IDs, empty speech or unsupported detection", () => {
  for (const text of ["Yes", "OK", "12345678Z", "14 de marzo de 1988", ""]) {
    expect(languageHint("es", "en", text)).toBe("es");
  }
  expect(languageHint("en", "fr", "Je voudrais un rendez-vous")).toBe("en");
});
it("accepts substantive Spanish, English and Catalan switches", () => {
  expect(languageHint("es", "eng", "I need an appointment")).toBe("en");
  expect(languageHint("en", "spa", "Quiero pedir una cita")).toBe("es");
  expect(languageHint("es", "cat", "Vull demanar una visita")).toBe("ca");
});
