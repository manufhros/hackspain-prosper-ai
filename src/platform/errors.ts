export class PlatformApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: unknown,
  ) {
    super(`Platform API ${status} ${path}: ${JSON.stringify(body)}`);
    this.name = "PlatformApiError";
  }
}
