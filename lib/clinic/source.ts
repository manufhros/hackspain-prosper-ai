import { getFixtureSource } from "./fixture";
import { HttpClinicSource } from "./http";
import type { ClinicSource } from "./types";

export type ClinicConnection = {
  baseUrl?: string;
  apiKey?: string;
  apiKeyHeader?: string;
  name?: string;
};

export function getClinicSource(connection?: ClinicConnection): ClinicSource {
  const baseUrl = connection?.baseUrl || process.env.CLINIC_API_BASE_URL;
  const apiKey = connection?.apiKey || process.env.CLINIC_API_KEY;
  if (baseUrl && apiKey) {
    return new HttpClinicSource({
      name: connection?.name ?? "Connected clinic",
      baseUrl,
      apiKey,
      apiKeyHeader: connection?.apiKeyHeader || process.env.CLINIC_API_KEY_HEADER,
    });
  }
  return getFixtureSource();
}
