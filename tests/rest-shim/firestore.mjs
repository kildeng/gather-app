// Minimal stand-in for the parts of 'firebase/firestore' our rule tests use, talking to the emulator's REST API.
export class Timestamp {
  constructor(ms){ this.ms = ms; }
  static fromMillis(ms){ return new Timestamp(ms); }
  static now(){ return new Timestamp(Date.now()); }
  toMillis(){ return this.ms; }
}
const SENTINEL = Symbol('sentinel');
export const serverTimestamp = () => ({ [SENTINEL]: 'ts' });
export const increment = n => ({ [SENTINEL]: 'inc', n });
export const deleteField = () => ({ [SENTINEL]: 'del' });
const enc = v => {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Timestamp) return { timestampValue: new Date(v.ms).toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
};
const dec = v => {
  if ('nullValue' in v) return null; if ('booleanValue' in v) return v.booleanValue; if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue; if ('stringValue' in v) return v.stringValue; if ('timestampValue' in v) return new Timestamp(Date.parse(v.timestampValue));
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec); if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)]));
  return null;
};
export class FirestoreError extends Error { constructor(status, body){ super(`HTTP ${status}: ${body}`); this.status = status; this.code = status === 403 ? 'permission-denied' : 'http-' + status; } }
export function makeDb(base, project, token){ return { base, project, token, root: `projects/${project}/databases/(default)/documents` }; }
async function call(db, method, url, body){
  const r = await fetch(`${db.base}/v1/${url}`, { method, headers: { ...(db.token ? { authorization: `Bearer ${db.token}` } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new FirestoreError(r.status, t.slice(0, 300));
  return t ? JSON.parse(t) : {};
}
export const doc = (db, path) => ({ db, path, kind: 'doc', id: path.split('/').pop() });
export const collection = (db, path) => ({ db, path, kind: 'col' });
export const where = (field, op, value) => ({ field, op, value });
export const query = (col, ...filters) => ({ ...col, filters });
const snap = (path, fields) => ({ id: path.split('/').pop(), exists: () => !!fields, data: () => fields ? dec({ mapValue: { fields } }) : undefined });
export async function getDoc(ref){
  try { const j = await call(ref.db, 'GET', `${ref.db.root}/${ref.path}`); return snap(ref.path, j.fields || {}); }
  catch (e) { if (e.status === 404) return snap(ref.path, null); throw e; }
}
export async function getDocs(q){
  const parts = q.path.split('/'), coll = parts.pop(), parent = parts.join('/');
  const ops = { '==': 'EQUAL', 'array-contains': 'ARRAY_CONTAINS', 'in': 'IN' };
  const sq = { from: [{ collectionId: coll }] };
  const fs = (q.filters || []).map(f => ({ fieldFilter: { field: { fieldPath: f.field }, op: ops[f.op], value: enc(f.value) } }));
  if (fs.length === 1) sq.where = fs[0]; else if (fs.length > 1) sq.where = { compositeFilter: { op: 'AND', filters: fs } };
  const j = await call(q.db, 'POST', `${q.db.root}${parent ? '/' + parent : ''}:runQuery`, { structuredQuery: sq });
  const docs = j.filter(x => x.document).map(x => snap(x.document.name.split('/documents/')[1], x.document.fields || {}));
  return { docs, size: docs.length, empty: !docs.length };
}
// turn a JS object (with dotted keys for updates) into REST fields + mask + transforms
function toWrite(ref, data, isUpdate){
  const fields = {}, mask = [], transforms = [];
  const put = (path, v) => { const keys = path.split('.'); let o = fields; keys.slice(0, -1).forEach(k => { o[k] ||= { mapValue: { fields: {} } }; o = o[k].mapValue.fields; }); o[keys.at(-1)] = enc(v); };
  for (const [k, v] of Object.entries(data)) {
    if (v && v[SENTINEL] === 'ts') { transforms.push({ fieldPath: k, setToServerValue: 'REQUEST_TIME' }); continue; }
    if (v && v[SENTINEL] === 'inc') { transforms.push({ fieldPath: k, increment: enc(v.n) }); continue; }
    if (v && v[SENTINEL] === 'del') { mask.push(k); continue; }
    if (isUpdate) { mask.push(k); put(k, v); } else fields[k] = enc(v);
  }
  const w = { update: { name: `${ref.db.root}/${ref.path}`, fields } };
  if (isUpdate) { w.updateMask = { fieldPaths: mask }; w.currentDocument = { exists: true }; }
  if (transforms.length) w.updateTransforms = transforms;
  return w;
}
const commit = (db, writes) => call(db, 'POST', `${db.root}:commit`, { writes });
export const setDoc = (ref, data) => commit(ref.db, [toWrite(ref, data, false)]);
export const updateDoc = (ref, data) => commit(ref.db, [toWrite(ref, data, true)]);
export const deleteDoc = ref => commit(ref.db, [{ delete: `${ref.db.root}/${ref.path}` }]);
export const addDoc = (col, data) => setDoc(doc(col.db, col.path + '/' + Math.random().toString(36).slice(2)), data);
export function writeBatch(db){
  const writes = [];
  return { set(ref, d){ writes.push(toWrite(ref, d, false)); return this; }, update(ref, d){ writes.push(toWrite(ref, d, true)); return this; },
    delete(ref){ writes.push({ delete: `${ref.db.root}/${ref.path}` }); return this; }, commit: () => commit(db, writes) };
}
