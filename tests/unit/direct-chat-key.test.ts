import { describe, expect, it } from 'vitest';
import { createDirectChatKey } from '../../src/utils/direct-chat-key';

describe('createDirectChatKey', () => {
  it('produces the same key regardless of argument order', () => {
    const a = '11111111-1111-4111-8111-111111111111';
    const b = '22222222-2222-4222-8222-222222222222';

    expect(createDirectChatKey(a, b)).toBe(createDirectChatKey(b, a));
    expect(createDirectChatKey(a, b)).toBe(`${a}_${b}`);
  });

  it('normalises case and surrounding whitespace', () => {
    expect(createDirectChatKey('  AAAA ', 'bbbb')).toBe('aaaa_bbbb');
  });

  it('keeps different user pairs distinct', () => {
    const key = createDirectChatKey('a', 'b');
    expect(key).not.toBe(createDirectChatKey('a', 'c'));
  });
});
