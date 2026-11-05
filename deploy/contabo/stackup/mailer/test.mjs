// node test.mjs — exercises server.mjs against a stand-in for Brevo.
import http from "node:http";
import assert from "node:assert/strict";

let last, mode = "ok";
const fake = http.createServer(async (req, res) => {
  let b = ""; for await (const c of req) b += c;
  last = { headers: req.headers, body: JSON.parse(b) };
  if (mode === "slow") return setTimeout(() => { res.writeHead(201); res.end("{}"); }, 2000);
  if (mode === "unverified") { res.writeHead(400, { "content-type": "application/json" }); return res.end('{"code":"invalid_parameter","message":"Sender is not valid"}'); }
  res.writeHead(201, { "content-type": "application/json" }); res.end('{"messageId":"<abc@smtp-relay.brevo.com>"}');
}).listen(0);
await new Promise((r) => fake.once("listening", r));

Object.assign(process.env, {
  MAILER_TOKEN: "t0ken", BREVO_API_KEY: "xkeysib-test", MAILER_NO_LISTEN: "1",
  BREVO_API_URL: `http://127.0.0.1:${fake.address().port}/`, BREVO_TIMEOUT_MS: "500",
});
const { server, parseAddress } = await import("./server.mjs");
server.listen(0);
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
const send = (body, token = "t0ken") => fetch(`${base}/send`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body),
});
let n = 0; const ok = (what) => console.log(`  ok   ${what}`, ++n);

// exactly what StackUp's EmailService posts
const stackup = { from: "StackUp <no-reply@smp.co.ke>", to: "jane@example.com", subject: "StackUp email is working ✅", text: "Hello", html: "<p>Hello</p>" };
let r = await send(stackup);
assert.equal(r.status, 200); assert.equal((await r.json()).ok, true);
assert.deepEqual(last.body, { sender: { name: "StackUp", email: "no-reply@smp.co.ke" }, to: [{ email: "jane@example.com" }], subject: "StackUp email is working ✅", textContent: "Hello", htmlContent: "<p>Hello</p>" });
assert.equal(last.headers["api-key"], "xkeysib-test");
ok("StackUp's message arrives at Brevo in Brevo's shape, with the key");

r = await send({ ...stackup, to: ["a@x.co", "Bob <b@y.co>"], html: undefined });
assert.equal(r.status, 200);
assert.deepEqual(last.body.to, [{ email: "a@x.co" }, { name: "Bob", email: "b@y.co" }]);
assert.equal(last.body.htmlContent, undefined);
ok("several recipients, and text-only mail");

r = await send(stackup, "wrong"); assert.equal(r.status, 401); ok("wrong token refused");
r = await fetch(`${base}/send`, { method: "POST", body: "{}" }); assert.equal(r.status, 401); ok("no token refused");

mode = "unverified"; r = await send(stackup);
assert.equal(r.status, 400); assert.match(JSON.stringify(await r.json()), /Sender is not valid/); ok("Brevo's refusal is passed back with its reason");

mode = "slow"; r = await send(stackup); assert.equal(r.status, 504); ok("a Brevo that does not answer in time is a 504, before StackUp's own 5s timeout");
mode = "ok";

for (const bad of [{ ...stackup, from: "nobody" }, { ...stackup, to: "not-an-email" }, { ...stackup, subject: "" }, { ...stackup, text: "", html: "" }]) {
  r = await send(bad); assert.equal(r.status, 400);
}
ok("malformed messages refused, not forwarded");

r = await fetch(`${base}/health`); assert.deepEqual(await r.json(), { ok: true, configured: true }); ok("health");
assert.deepEqual(parseAddress('"S P" <s@p.co>'), { name: "S P", email: "s@p.co" }); ok("quoted display names");

console.log(`\nALL GREEN — ${n} passed`);
server.close(); fake.close();
