// Minimal Web Push (RFC 8291 message encryption + RFC 8292 VAPID), using only Node's built-in crypto.
import crypto from "node:crypto";

export const b64u = buf => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64u = s => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();

export function newVapidKeys(){
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

// encrypt one push message for one subscription (aes128gcm). `test` lets the RFC test vector pin the random parts.
export function encrypt(plaintext, p256dh, authSecret, test = {}){
  const uaPublic = unb64u(p256dh), auth = unb64u(authSecret);
  const ecdh = crypto.createECDH("prime256v1");
  if (test.asPrivate) ecdh.setPrivateKey(unb64u(test.asPrivate)); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(uaPublic);
  const salt = test.salt ? unb64u(test.salt) : crypto.randomBytes(16);
  const prkKey = hmac(auth, secret);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12);
  const c = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const header = Buffer.alloc(21); salt.copy(header, 0); header.writeUInt32BE(4096, 16); header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, body]);
}

function vapidAuth(endpoint, keys, subject){
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const pub = unb64u(keys.publicKey);
  const key = crypto.createPrivateKey({ format: "jwk", key: { kty: "EC", crv: "P-256", d: keys.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
  const sig = crypto.sign("sha256", Buffer.from(head + "." + claims), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

export async function sendPush(sub, payload, keys, { subject = "mailto:support@gather.app", ttl = 86400, urgency = "high", topic } = {}){
  const body = encrypt(JSON.stringify(payload), sub.keys.p256dh, sub.keys.auth);
  const headers = { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: String(ttl), Urgency: urgency, Authorization: vapidAuth(sub.endpoint, keys, subject) };
  if (topic) headers.Topic = topic;
  const r = await fetch(sub.endpoint, { method: "POST", headers, body });
  return { status: r.status, text: r.ok ? "" : (await r.text().catch(() => "")).slice(0, 200) };
}
