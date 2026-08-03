import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  normalizePhone,
  normalizeStatus,
  verifySignature,
  parseWebhook,
} from "../src/server/kopokopo.ts";

test("normalizePhone handles Kenyan formats", () => {
  assert.equal(normalizePhone("0712345678"), "+254712345678");
  assert.equal(normalizePhone("+254712345678"), "+254712345678");
  assert.equal(normalizePhone("254712345678"), "+254712345678");
  assert.equal(normalizePhone("712345678"), "+254712345678");
  assert.equal(normalizePhone("0110000000"), "+254110000000");
  assert.equal(normalizePhone("+254 712 345 678"), "+254712345678");
  assert.equal(normalizePhone("12345"), null);
  assert.equal(normalizePhone("0812345678"), null); // invalid prefix
});

test("normalizeStatus maps Kopo Kopo statuses", () => {
  assert.equal(normalizeStatus("Received"), "success");
  assert.equal(normalizeStatus("Failed"), "failed");
  assert.equal(normalizeStatus("Pending"), "pending");
  assert.equal(normalizeStatus(""), "pending");
});

test("verifySignature accepts a correct HMAC and rejects a wrong one", async () => {
  const apiKey = "test_api_key";
  const body = JSON.stringify({ topic: "buygoods_transaction_received", id: "abc" });
  const good = createHmac("sha256", apiKey).update(body).digest("hex");
  assert.equal(await verifySignature(body, good, apiKey), true);
  assert.equal(await verifySignature(body, good, "wrong_key"), false);
  assert.equal(await verifySignature(body, "deadbeef", apiKey), false);
  assert.equal(await verifySignature(body, "", apiKey), false);
});

test("parseWebhook extracts status + reference across shapes", () => {
  const payload = {
    data: {
      id: "res_123",
      attributes: { status: "Received", event: { resource: { reference: "QWE123" } } },
    },
  };
  const r = parseWebhook(payload);
  assert.equal(normalizeStatus(r.status), "success");
  assert.equal(r.reference, "QWE123");
  assert.equal(r.ref, "res_123");
});
