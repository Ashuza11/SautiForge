export type InterruptedTakeCleanup = {
  discarded: boolean;
  errors: string[];
};

type InterruptedTakeCleanupInput = {
  stop: () => Promise<void>;
  getUri: () => string | null;
  discard: (uri: string) => void;
};

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'unknown cleanup failure';
}

export async function stopAndDiscardInterruptedTake(input: InterruptedTakeCleanupInput): Promise<InterruptedTakeCleanup> {
  const errors: string[] = [];
  try {
    await input.stop();
  } catch (cause) {
    errors.push(`recorder stop: ${message(cause)}`);
  }

  const uri = input.getUri();
  if (!uri) {
    errors.push('recorder returned no temporary file');
    return { discarded: false, errors };
  }
  try {
    input.discard(uri);
    return { discarded: true, errors };
  } catch (cause) {
    errors.push(`temporary file cleanup: ${message(cause)}`);
    return { discarded: false, errors };
  }
}

export function appStateInterruptsRecording(state: string): boolean {
  return state !== 'active';
}
