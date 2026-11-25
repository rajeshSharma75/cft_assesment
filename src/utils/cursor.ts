import { badRequest } from './app-error';

/**
 * Position of a message in the (createdAt, messageId) ordering. `nanoseconds`
 * keeps the cursor lossless against Firestore's timestamp precision.
 */
export interface MessageCursor {
  seconds: number;
  nanoseconds: number;
  messageId: string;
}

export function encodeCursor(cursor: MessageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): MessageCursor {
  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw badRequest('Invalid pagination cursor');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw badRequest('Invalid pagination cursor');
  }

  const candidate = parsed as Record<string, unknown>;
  const { seconds, nanoseconds, messageId } = candidate;

  if (
    typeof seconds !== 'number' ||
    typeof nanoseconds !== 'number' ||
    typeof messageId !== 'string' ||
    messageId.length === 0 ||
    !Number.isFinite(seconds) ||
    !Number.isFinite(nanoseconds)
  ) {
    throw badRequest('Invalid pagination cursor');
  }

  return { seconds, nanoseconds, messageId };
}
