export class ImportFailure extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly transient = false,
    public readonly retryAfterMs = 1000,
  ) {
    super(message);
  }
}
export function safeFailure(error: unknown): ImportFailure {
  return error instanceof ImportFailure
    ? error
    : new ImportFailure(
        'IMPORT_FAILED',
        'Import failed. Retry the job; if it persists, ask the workspace Owner to check server configuration.',
      );
}
export const canceled = () => new ImportFailure('CANCELED', 'Import canceled.');
