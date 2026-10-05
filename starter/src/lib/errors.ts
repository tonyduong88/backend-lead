export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'AppError';
  }
}

export function databaseErrorCode(error: unknown): string | undefined {
  const e = error as { original?: { code?: string }; parent?: { code?: string }; code?: string };
  return e?.original?.code ?? e?.parent?.code ?? e?.code;
}
