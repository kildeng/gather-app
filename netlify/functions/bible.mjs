// Gather Bible helper (Netlify, free).
//  GET /api/bible?votd=1&d=YYYY-MM-DD → today's Verse of the Day: the reference YouVersion picked for the day,
//      with the text from the World English Bible (public domain) so it can be shown right in the app.
//  GET /api/bible?p=JHN.3 → a chapter (World English Bible) for the in-app reader.
// Results are cached in Netlify Blobs so each day/chapter is fetched only once.
import { getStore } from "@netlify/blobs";

const BOOKS = { GEN: "Genesis", EXO: "Exodus", LEV: "Leviticus", NUM: "Numbers", DEU: "Deuteronomy", JOS: "Joshua", JDG: "Judges", RUT: "Ruth", "1SA": "1 Samuel", "2SA": "2 Samuel", "1KI": "1 Kings", "2KI": "2 Kings", "1CH": "1 Chronicles", "2CH": "2 Chronicles", EZR: "Ezra", NEH: "Nehemiah", EST: "Esther", JOB: "Job", PSA: "Psalms", PRO: "Proverbs", ECC: "Ecclesiastes", SNG: "Song of Solomon", ISA: "Isaiah", JER: "Jeremiah", LAM: "Lamentations", EZK: "Ezekiel", DAN: "Daniel", HOS: "Hosea", JOL: "Joel", AMO: "Amos", OBA: "Obadiah", JON: "Jonah", MIC: "Micah", NAM: "Nahum", HAB: "Habakkuk", ZEP: "Zephaniah", HAG: "Haggai", ZEC: "Zechariah", MAL: "Malachi", MAT: "Matthew", MRK: "Mark", LUK: "Luke", JHN: "John", ACT: "Acts", ROM: "Romans", "1CO": "1 Corinthians", "2CO": "2 Corinthians", GAL: "Galatians", EPH: "Ephesians", PHP: "Philippians", COL: "Colossians", "1TH": "1 Thessalonians", "2TH": "2 Thessalonians", "1TI": "1 Timothy", "2TI": "2 Timothy", TIT: "Titus", PHM: "Philemon", HEB: "Hebrews", JAS: "James", "1PE": "1 Peter", "2PE": "2 Peter", "1JN": "1 John", "2JN": "2 John", "3JN": "3 John", JUD: "Jude", REV: "Revelation" };
// used only if YouVersion's page can't be read that day
const FALLBACK = ["JHN.3.16", "PSA.23.1", "PRO.3.5-6", "ISA.41.10", "PHP.4.13", "ROM.8.28", "JER.29.11", "MAT.11.28", "PSA.46.1", "JOS.1.9", "2CO.5.17", "GAL.5.22-23", "ROM.12.2", "PHP.4.6-7", "HEB.11.1", "1CO.13.4-5", "PSA.119.105", "MAT.6.33", "ISA.40.31", "EPH.2.8-9", "1JN.4.19", "PSA.37.4", "MRK.12.30", "LAM.3.22-23", "COL.3.23", "JAS.1.5", "1PE.5.7", "PSA.139.14", "MAT.5.16", "ROM.15.13", "2TI.1.7"];
const json = (o, status = 200, maxAge = 300) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": `public, max-age=${maxAge}` } });
const USFM = /^([1-3]?[A-Z]{2,3})\.(\d{1,3})(?:\.(\d{1,3})(?:-(\d{1,3}))?)?$/;
const store = () => getStore({ name: "gather-bible", consistency: "strong" });
const human = u => { const m = u.match(USFM); return m && BOOKS[m[1]] ? `${BOOKS[m[1]]} ${m[2]}${m[3] ? ":" + m[3] + (m[4] ? "-" + m[4] : "") : ""}` : null; };

// World English Bible text from bible-api.com (public domain)
async function webText(usfm){
  const ref = human(usfm); if (!ref) throw new Error("bad reference");
  const r = await fetch(`https://bible-api.com/${encodeURIComponent(ref)}?translation=web`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error("bible-api " + r.status);
  const j = await r.json();
  return { reference: ref, verses: (j.verses || []).map(v => ({ v: v.verse, t: String(v.text || "").replace(/\s+/g, " ").trim() })), translation: "WEB" };
}
// The reference YouVersion features today, read from bible.com's public Verse of the Day page
async function youVersionToday(){
  const r = await fetch("https://www.bible.com/verse-of-the-day", { headers: { "user-agent": "Mozilla/5.0 (compatible; GatherApp/1.0)", "accept-language": "en-US,en;q=0.9" } });
  if (!r.ok) throw new Error("bible.com " + r.status);
  const html = await r.text();
  const candidates = [];
  const nd = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  // "usfm": ["PSA.46.1", "PSA.46.2"] → PSA.46.1-2
  if (nd) for (const m of nd[1].matchAll(/"usfm"\s*:\s*(\[[^\]]*\]|"[^"]*")/g)) {
    const list = (m[1].match(/[1-3]?[A-Z]{2,3}\.\d{1,3}\.\d{1,3}/g) || []);
    if (!list.length) continue;
    const [b0, c0, v0] = list[0].split("."), last = list[list.length - 1].split(".");
    candidates.push(list.length > 1 && last[0] === b0 && last[1] === c0 ? `${b0}.${c0}.${v0}-${last[2]}` : list[0]);
  }
  for (const m of html.matchAll(/\/bible\/\d+\/([1-3]?[A-Z]{2,3}\.\d{1,3}\.\d{1,3}(?:-\d{1,3})?)/g)) candidates.push(m[1]);
  return candidates.find(c => USFM.test(c) && BOOKS[c.split(".")[0]]) || null;
}

export default async req => {
  try {
    const q = new URL(req.url).searchParams;
    if (q.get("votd")) {
      const today = new Date().toISOString().slice(0, 10);
      let d = q.get("d") || today;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Math.abs(Date.parse(d) - Date.parse(today)) > 2 * 864e5) d = today;
      const s = store(), key = `votd-${d}`;
      const hit = await s.get(key, { type: "json" }).catch(() => null);
      if (hit) return json(hit, 200, 3600);
      let usfm = null, source = "youversion";
      try { usfm = await youVersionToday(); } catch (e) { console.log("votd page", String(e)); }
      if (!usfm) { const day = Math.floor(Date.parse(d) / 864e5); usfm = FALLBACK[day % FALLBACK.length]; source = "fallback"; }
      const text = await webText(usfm);
      const out = { date: d, usfm, source, ...text, youversion: `https://www.bible.com/bible/111/${usfm}` };
      if (source === "youversion") await s.setJSON(key, out).catch(() => {});
      return json(out, 200, source === "youversion" ? 3600 : 300);
    }
    const p = q.get("p") || "";
    const m = p.match(/^([1-3]?[A-Z]{2,3})\.(\d{1,3})$/);
    if (!m || !BOOKS[m[1]]) return json({ error: "Use ?p=BOOK.CHAPTER, e.g. JHN.3" }, 400);
    const s = store(), key = `ch-${p}`;
    const hit = await s.get(key, { type: "json" }).catch(() => null);
    if (hit) return json(hit, 200, 86400);
    const text = await webText(p);
    if (!text.verses.length) return json({ error: "That chapter doesn't exist." }, 404);
    const out = { usfm: p, ...text, youversion: `https://www.bible.com/bible/111/${p}` };
    await s.setJSON(key, out).catch(() => {});
    return json(out, 200, 86400);
  } catch (e) {
    console.error(e);
    return json({ error: "The Bible text couldn't be loaded right now." }, 502, 30);
  }
};

export const config = { path: "/api/bible" };
