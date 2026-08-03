import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptSecret, decryptSecret } from "../src/server/crypto.ts";

test("encrypt/decrypt round-trips", async () => {
  const secret = "app-secret-abc-123";
  const plain = "fake-kopokopo-secret-for-tests-only";
  const blob = await encryptSecret(plain, secret);
  assert.notEqual(blob, plain);
  assert.equal(await decryptSecret(blob, secret), plain);
});

test("different app secret cannot decrypt", async () => {
  const blob = await encryptSecret("hello", "secret-one");
  assert.equal(await decryptSecret(blob, "secret-two"), null);
});

test("encryption is non-deterministic (random IV)", async () => {
  const a = await encryptSecret("same", "k");
  const b = await encryptSecret("same", "k");
  assert.notEqual(a, b);
  assert.equal(await decryptSecret(a, "k"), "same");
  assert.equal(await decryptSecret(b, "k"), "same");
});

test("garbage blob returns null, not a throw", async () => {
  assert.equal(await decryptSecret("not-valid-base64-@@@", "k"), null);
  assert.equal(await decryptSecret("", "k"), null);
});
