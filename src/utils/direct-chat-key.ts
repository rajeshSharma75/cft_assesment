/**
 * Deterministic key for a 1:1 conversation: the two user IDs sorted and joined.
 * `userA=101, userB=202` and `userA=202, userB=101` both produce `101_202`.
 */
export function createDirectChatKey(userAId: string, userBId: string): string {
  return [userAId.trim().toLowerCase(), userBId.trim().toLowerCase()].sort().join('_');
}
