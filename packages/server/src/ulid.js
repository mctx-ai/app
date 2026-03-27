/**
 * Minimal ULID generator
 * ULIDs are 26 characters: 10 timestamp chars + 16 random chars (Crockford base32)
 * Lexicographically sortable by creation time.
 *
 * @module ulid
 */

const CROCKFORD_CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeBase32(n, length) {
  let result = "";
  for (let i = 0; i < length; i++) {
    result = CROCKFORD_CHARS[Number(n & 31n)] + result;
    n >>= 5n;
  }
  return result;
}

/**
 * Generate a ULID.
 *
 * When `timestampMs` is provided (e.g. for deferred events), the ULID timestamp
 * component reflects the delivery time so cursor-based pagination returns events
 * in delivery order. When omitted, the current wall-clock time is used.
 *
 * @param {number} [timestampMs] - Optional timestamp in milliseconds
 * @returns {string} 26-character ULID string
 */
export function generateUlid(timestampMs) {
  const now = BigInt(timestampMs !== undefined ? timestampMs : Date.now());
  const randomBytes = new Uint8Array(10);
  crypto.getRandomValues(randomBytes);

  // Encode 48-bit timestamp into 10 base32 chars
  const timeStr = encodeBase32(now, 10);

  // Encode 80 random bits into 16 base32 chars
  let randomBigInt = 0n;
  for (const byte of randomBytes) {
    randomBigInt = (randomBigInt << 8n) | BigInt(byte);
  }
  const randomStr = encodeBase32(randomBigInt, 16);

  return timeStr + randomStr;
}
