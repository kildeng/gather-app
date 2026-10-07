// Gather notification helper (runs on Netlify, free).
// It never sees message text: phones only say "I posted something in room X of group Y".
// It checks that claim against the database using the sender's own sign-in (so the same
// security rules apply), then sends a short "Hannah sent a message" notice to the others.
import { getStore } from "@netlify/blobs";
import { sendPush, newVapidKeys } from "../lib/webpush.mjs";

const PROJECT = "gather-48b50";
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// VAPID keys are created by this function the first time it runs and kept in Netlify Blobs.
let cachedKeys = null;
async function vapid(){
  if (cachedKeys) return cachedKeys;
  const store = getStore({ name: "gather-push", consistency: "strong" });
  let k = await store.get("vapid", { type: "json" });
  if (!k?.publicKey){
    await store.setJSON("vapid", newVapidKeys(), { onlyIfNew: true });
    k = await store.get("vapid", { type: "json" });
  }
  return (cachedKeys = k);
}

// Firestore REST, as the signed-in sender
const val = v => !v ? null : "stringValue" in v ? v.stringValue : "integerValue" in v ? Number(v.integerValue) : "booleanValue" in v ? v.booleanValue
  : "timestampValue" in v ? Date.parse(v.timestampValue) : "nullValue" in v ? null : "arrayValue" in v ? (v.arrayValue.values || []).map(val)
  : "mapValue" in v ? obj(v.mapValue.fields) : null;
const obj = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, val(v)]));
async function get(path, token){
  const r = await fetch(`${FS}/${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (r.status === 404) return null;
  if (!r.ok) throw Object.assign(new Error(`read ${path}: ${r.status}`), { status: r.status });
  return obj((await r.json()).fields);
}
async function approvedMembers(cid, token, roles = ["member", "leader"]){
  const r = await fetch(`${FS}/churches/${cid}:runQuery`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "members" }], select: { fields: [{ fieldPath: "role" }] },
      where: { fieldFilter: { field: { fieldPath: "role" }, op: "IN", value: { arrayValue: { values: roles.map(r => ({ stringValue: r })) } } } } } }) });
  if (!r.ok) throw new Error("members: " + r.status);
  return (await r.json()).filter(x => x.document).map(x => x.document.name.split("/").pop());
}
const uidOf = token => { try { const p = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()); return p.user_id || p.sub; } catch { return null; } };

export default async req => {
  try {
    if (req.method === "GET") return json({ key: (await vapid()).publicKey });
    if (req.method !== "POST") return json({ error: "method" }, 405);
    const { token, cid, rid = "", kind } = await req.json().catch(() => ({}));
    const uid = token && uidOf(token);
    if (!uid || !ID.test(cid || "") || (rid && !ID.test(rid)) || !["msg", "ann", "test", "event", "prayer", "devotion", "comment"].includes(kind)) return json({ error: "bad request" }, 400);

    // these reads only succeed if the token is real and the sender is an approved member (security rules)
    const [church, me] = await Promise.all([get(`churches/${cid}`, token), get(`churches/${cid}/members/${uid}`, token)]);
    if (!church || !["member", "leader"].includes(me?.role)) return json({ error: "not a member" }, 403);
    const group = church.theme?.name || church.name || "Gather", who = me.name || "Someone";

    let to = [], body = "", room = rid, tag = rid || "ann";
    if (kind === "test"){ to = [uid]; body = "Notifications are working ✅"; room = ""; tag = "test"; }
    else if (kind === "ann"){
      if (me.role !== "leader") return json({ error: "leaders only" }, 403);
      to = await approvedMembers(cid, token); body = `📣 New announcement from ${who}`; room = "";
    } else if (kind === "event"){
      // the event must exist, be the sender's, and be brand new (stops replaying old events as pings)
      const e = rid && await get(`churches/${cid}/events/${rid}`, token);
      if (!e || e.uid !== uid || me.role !== "leader" || Date.now() - (e.createdAt || 0) > 120000) return json({ sent: 0, skipped: "not a new event" });
      to = await approvedMembers(cid, token); body = `📅 ${who} posted a new event`; room = ""; tag = "events";
    } else if (kind === "prayer" || kind === "devotion" || kind === "comment"){
      const coll = { prayer: "prayers", devotion: "devotions", comment: "devComments" }[kind];
      const p = rid && await get(`churches/${cid}/${coll}/${rid}`, token);
      // the post must be brand new and the sender's: signed with their uid, or anonymous with their private owner record
      const mineNow = p && (p.uid === uid || (p.anon === true && (await get(`churches/${cid}/owners/${rid}`, token).catch(() => null))?.uid === uid));
      if (!mineNow || Date.now() - (p.createdAt || 0) > 120000) return json({ sent: 0, skipped: "not a new post" });
      const name = p.anon ? "Someone" : who;
      room = ""; tag = kind;
      if (kind === "prayer"){
        // "Leaders Only" requests ping only the leaders
        to = p.privacy === "leaders" ? await approvedMembers(cid, token, ["leader"]) : await approvedMembers(cid, token);
        body = p.privacy === "leaders" ? `🙏 ${name} shared a prayer request with leaders` : `🙏 ${name} shared a prayer request`;
      } else if (kind === "devotion"){
        to = await approvedMembers(cid, token); body = `📖 ${name} shared today's devotion`;
      } else {
        // a comment pings the devotion's author (when it was posted with a name)
        const dv = p.did && await get(`churches/${cid}/devotions/${p.did}`, token).catch(() => null);
        to = dv?.uid ? [dv.uid] : []; body = `💬 ${name} commented on your devotion`;
      }
    } else {
      const r = await get(`churches/${cid}/rooms/${rid}`, token);           // fails unless the sender is in this chat
      if (!r) return json({ error: "no room" }, 404);
      if (r.lastUid !== uid || Date.now() - (r.lastAt || 0) > 120000) return json({ sent: 0, skipped: "no recent message" });
      to = r.type === "main" ? await approvedMembers(cid, token) : (r.members || []);
      body = r.type === "dm" ? `${who} sent you a message` : r.type === "main" ? `${who} sent a message in ${group} Chat` : `${who} sent a message in a group chat`;
    }
    to = [...new Set(to)].filter(u => kind === "test" || u !== uid).slice(0, 500);

    const keys = await vapid();
    const docs = await Promise.all(to.map(u => get(`churches/${cid}/push/${u}`, token).catch(() => null)));
    const subs = docs.flatMap(d => Object.values(d?.subs || {})).filter(s => s?.endpoint?.startsWith("https://") && s.keys?.p256dh && s.keys?.auth);
    const payload = { title: group, body, g: cid, room, tag: `${cid}:${tag}`, kind };
    const results = await Promise.all(subs.map(s => sendPush(s, payload, keys, { topic: tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined }).catch(e => ({ status: 0, text: String(e) }))));
    const sent = results.filter(x => x.status >= 200 && x.status < 300).length;
    const errors = results.filter(x => !(x.status >= 200 && x.status < 300)).map(x => x.status);
    if (errors.length) console.log("push errors", errors, results.filter(x => x.text).map(x => x.text));
    return json({ sent, failed: errors.length, people: to.length, devices: subs.length });
  } catch(e){
    console.error(e);
    return json({ error: "failed" }, e.status === 403 || e.status === 401 ? 403 : 500);
  }
};

export const config = { path: "/api/notify" };
