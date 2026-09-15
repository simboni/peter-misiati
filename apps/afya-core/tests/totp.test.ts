/**
 * Time-based one-time passwords.
 *
 * Checked against the RFC 6238 test vectors rather than against itself: a
 * home-grown authenticator that only agrees with its own maths would let
 * everyone enrol and nobody sign in.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { codeAt, verifyCode, generateSecret, base32Encode, base32Decode, enrolmentUri } from "../src/lib/totp.ts";

/**
 * RFC 6238 Appendix B, SHA-1 rows.
 *
 * The published vectors use the ASCII seed "12345678901234567890" and eight
 * digits; ours are six, so these are the last six of each published code.
 */
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

test("it produces the codes RFC 6238 says it should", () => {
  const vectors: [number, string][] = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ];
  for (const [seconds, expected] of vectors) {
    assert.equal(codeAt(RFC_SECRET, seconds * 1000), expected, `at ${seconds}s`);
  }
});

test("base32 survives a round trip, including the padding case", () => {
  for (const text of ["", "a", "ab", "abc", "abcd", "abcde", "hello world"]) {
    const encoded = base32Encode(Buffer.from(text));
    assert.equal(base32Decode(encoded).toString(), text, text);
  }
});

test("a decoder ignores the spaces and lower case people actually type", () => {
  const secret = generateSecret();
  const typed = secret.toLowerCase().replace(/(.{4})/g, "$1 ");
  assert.deepEqual(base32Decode(typed), base32Decode(secret));
});

test("the current code verifies and a wrong one does not", () => {
  const secret = generateSecret();
  const at = Date.now();
  assert.equal(verifyCode(secret, codeAt(secret, at), at), true);
  assert.equal(verifyCode(secret, "000000", at), false);
  assert.equal(verifyCode(secret, codeAt(generateSecret(), at), at), false, "another account's code is not this one's");
});

test("a clock that drifts by a step still works, and one that drifts by a minute does not", () => {
  const secret = generateSecret();
  const at = Date.now();
  // A clinic machine nobody can set is a lockout, so one step either side passes.
  assert.equal(verifyCode(secret, codeAt(secret, at - 30_000), at), true);
  assert.equal(verifyCode(secret, codeAt(secret, at + 30_000), at), true);
  assert.equal(verifyCode(secret, codeAt(secret, at - 90_000), at), false, "but not indefinitely");
});

test("malformed input is refused rather than parsed generously", () => {
  const secret = generateSecret();
  for (const bad of ["", "12345", "1234567", "abcdef", "12 34 56 ", "-12345"]) {
    assert.equal(verifyCode(secret, bad), false, JSON.stringify(bad));
  }
  // Spaces inside a genuine code are stripped — people read them in threes.
  const code = codeAt(secret, Date.now());
  assert.equal(verifyCode(secret, `${code.slice(0, 3)} ${code.slice(3)}`), true);
});

test("a generated secret is base32 and long enough to be worth having", () => {
  const secret = generateSecret();
  assert.match(secret, /^[A-Z2-7]+$/);
  assert.ok(base32Decode(secret).length >= 20, "160 bits, as the RFC recommends");
  assert.notEqual(generateSecret(), generateSecret());
});

test("the enrolment URI is what an authenticator app expects to scan", () => {
  const uri = enrolmentUri({ secret: "JBSWY3DPEHPK3PXP", account: "g.kimani", issuer: "Demo Medical Clinic" });
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, /Demo%20Medical%20Clinic%3Ag\.kimani/);
  assert.match(uri, /secret=JBSWY3DPEHPK3PXP/);
  assert.match(uri, /digits=6/);
  assert.match(uri, /period=30/);
});
