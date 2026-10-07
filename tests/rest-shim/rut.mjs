// Minimal stand-in for '@firebase/rules-unit-testing' using the Firestore emulator's REST API.
import { makeDb } from './firestore.mjs';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
export async function initializeTestEnvironment({ projectId, firestore: { host, port, rules } }){
  const base = `http://${host}:${port}`;
  const r = await fetch(`${base}/emulator/v1/projects/${projectId}:securityRules`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: rules }] } }) });
  if (!r.ok) throw new Error('rules failed to load: ' + await r.text());
  const token = (uid, claims = {}) => { const now = Math.floor(Date.now() / 1000);
    return b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({ iss: `https://securetoken.google.com/${projectId}`, aud: projectId, iat: now, exp: now + 3600, auth_time: now, sub: uid, user_id: uid, firebase: { sign_in_provider: 'custom', identities: {} }, ...claims }) + '.'; };
  return {
    authenticatedContext: (uid, claims) => ({ firestore: () => makeDb(base, projectId, token(uid, claims)) }),
    unauthenticatedContext: () => ({ firestore: () => makeDb(base, projectId, null) }),
    async withSecurityRulesDisabled(cb){ await cb({ firestore: () => makeDb(base, projectId, 'owner') }); },
    async clearFirestore(){ await fetch(`${base}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' }); },
    async cleanup(){}
  };
}
export async function assertSucceeds(p){ return await p; }
export async function assertFails(p){
  try { await p; } catch (e) { if (e.code === 'permission-denied') return e; throw new Error('expected permission-denied, got ' + e.message); }
  throw new Error('expected the request to be denied, but it succeeded');
}
