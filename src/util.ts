export const encoder = new TextEncoder();

export function toCString(str: string): Uint8Array {
  return encoder.encode(str + "\0");
}

export function isObject(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

export function isNull(v: Deno.PointerValue): boolean {
  return v === 0 || v === 0n;
}

export class SqliteError extends Error {
  public name = 'SqliteError'
  public constructor(public code: number, message: string) {
    super(`(${code}) ${message}`)
  }
}
