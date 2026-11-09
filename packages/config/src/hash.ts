/**
 * Stable configuration hashing: UTF-8, sorted object keys, array order preserved, finite JSON values
 * only, SHA-256, lowercase hexadecimal.
 *
 * Declared as an addition to the UDG-002 file list (docs/contracts/UDG-002.md names
 * movement/network/limits/region/index) because the serialisation and digest have to be shared by
 * every configuration module and must not live in a barrel.
 *
 * It is a pure-TypeScript implementation on purpose. @udg/config compiles with `lib: ["ES2024"]` and
 * `types: []`, so `node:crypto` is both unavailable and unwanted: the same hash must be computable by
 * a browser client that only reads configuration, and a client that cannot recompute `configHash`
 * cannot verify that it agrees with the server. The unit suite cross-checks every digest against
 * `node:crypto`, which is how a hand-written digest is allowed to be trusted at all.
 */

/** Encode UTF-8 without relying on `TextEncoder`, which is not in the declared lib. */
export const encodeUtf8 = (text: string): Uint8Array => {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    let code = text.charCodeAt(index);
    // Combine a surrogate pair into one code point, matching UTF-8 exactly.
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        index += 1;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
};

const K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const rotr = (value: number, bits: number): number => ((value >>> bits) | (value << (32 - bits))) >>> 0;

/** SHA-256 over a byte sequence, returning raw bytes. */
export const sha256Bytes = (input: Uint8Array): Uint8Array => {
  const h: number[] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const bitLength = input.length * 8;
  const paddedLength = (((input.length + 9) >> 6) + 1) << 6;
  const message = new Uint8Array(paddedLength);
  message.set(input);
  message[input.length] = 0x80;
  const view = new DataView(message.buffer);
  // SHA-256 length is a 64-bit big-endian count. Message lengths above 2^32 bytes are far outside
  // any configuration payload, so the high word is written as zero rather than approximated.
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) schedule[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(schedule[i - 15] ?? 0, 7) ^ rotr(schedule[i - 15] ?? 0, 18) ^ ((schedule[i - 15] ?? 0) >>> 3);
      const s1 = rotr(schedule[i - 2] ?? 0, 17) ^ rotr(schedule[i - 2] ?? 0, 19) ^ ((schedule[i - 2] ?? 0) >>> 10);
      schedule[i] = ((schedule[i - 16] ?? 0) + s0 + (schedule[i - 7] ?? 0) + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e ?? 0, 6) ^ rotr(e ?? 0, 11) ^ rotr(e ?? 0, 25);
      const ch = ((e ?? 0) & (f ?? 0)) ^ (~(e ?? 0) & (g ?? 0));
      const temp1 = ((hh ?? 0) + S1 + ch + (K[i] ?? 0) + (schedule[i] ?? 0)) >>> 0;
      const S0 = rotr(a ?? 0, 2) ^ rotr(a ?? 0, 13) ^ rotr(a ?? 0, 22);
      const maj = ((a ?? 0) & (b ?? 0)) ^ ((a ?? 0) & (c ?? 0)) ^ ((b ?? 0) & (c ?? 0));
      const temp2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = ((d ?? 0) + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    const next = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i += 1) h[i] = ((h[i] ?? 0) + (next[i] ?? 0)) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i += 1) outView.setUint32(i * 4, h[i] ?? 0, false);
  return out;
};

const HEX = '0123456789abcdef';

const toHex = (bytes: Uint8Array): string => {
  let out = '';
  for (const byte of bytes) {
    out += (HEX[byte >> 4] as string) + (HEX[byte & 0x0f] as string);
  }
  return out;
};

/**
 * Canonical serialisation: object keys sorted by code unit, array order preserved, no insignificant
 * whitespace.
 *
 * Anything that a configuration document cannot legitimately contain is refused rather than coerced:
 * non-finite numbers, `undefined`, functions, symbols and bigints all have no faithful JSON form, and
 * a hash that silently dropped them would be reproducible in name only.
 */
export const canonicalJson = (value: unknown): string => {
  const encode = (input: unknown, path: string): string => {
    if (input === null) return 'null';
    if (typeof input === 'boolean') return input ? 'true' : 'false';
    if (typeof input === 'string') return JSON.stringify(input);
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) {
        throw new TypeError(`canonicalJson refuses the non-finite number at ${path}`);
      }
      // `-0` serialises as `0`, which is the same normalisation the wire applies.
      return Object.is(input, -0) ? '0' : String(input);
    }
    if (Array.isArray(input)) return `[${input.map((entry, index) => encode(entry, `${path}[${String(index)}]`)).join(',')}]`;
    if (typeof input === 'object') {
      const entries = Object.entries(input as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
      return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${encode(entry, `${path}.${key}`)}`).join(',')}}`;
    }
    throw new TypeError(`canonicalJson refuses ${typeof input} at ${path}`);
  };
  return encode(value, '$');
};

/** sha256(canonicalJson(value)) as lowercase hex. */
export const canonicalHash = (value: unknown): string => toHex(sha256Bytes(encodeUtf8(canonicalJson(value))));

/** sha256 over raw UTF-8 text, lowercase hex. Used by fixtures that hash a file body. */
export const textHash = (text: string): string => toHex(sha256Bytes(encodeUtf8(text)));

export const sha256Hex = (bytes: Uint8Array): string => toHex(sha256Bytes(bytes));
