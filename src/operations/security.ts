import { createHmac, timingSafeEqual } from "node:crypto";

export function authorized(request: Request) {
  const secret = process.env.OPERATIONS_SECRET;
  const actual = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return !!secret && secret.length >= 32 && actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes);
}
export function phoneToken(id: string, expires: string) {
  return createHmac("sha256", process.env.OPERATIONS_SECRET ?? "").update(`demo-phone:${id}:${expires}`).digest("hex");
}
export function validPhoneToken(url: URL, id: string) {
  const expires = url.searchParams.get("expires") ?? "";
  const token = url.searchParams.get("token") ?? "";
  return !!process.env.OPERATIONS_SECRET && /^\d+$/.test(expires) &&
    Number(expires) > Date.now() && Number(expires) <= Date.now() + 360000 &&
    /^[a-f0-9]{64}$/.test(token) && timingSafeEqual(Buffer.from(token), Buffer.from(phoneToken(id, expires)));
}
