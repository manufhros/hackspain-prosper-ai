export class ClinicApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly payload: unknown,
  ) {
    super(`Clinic API ${status} ${path}`);
    this.name = "ClinicApiError";
  }
}
