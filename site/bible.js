// Bible tab + Verse of the Day.
// The daily verse is the one YouVersion features each day; the text shown in the app is the World English Bible
// (public domain), and "Read in YouVersion" opens NIV and other versions in the YouVersion app or bible.com.

export const BIBLE_BOOKS = Object.freeze([
  ['GEN', 'Genesis', 50], ['EXO', 'Exodus', 40], ['LEV', 'Leviticus', 27], ['NUM', 'Numbers', 36], ['DEU', 'Deuteronomy', 34], ['JOS', 'Joshua', 24], ['JDG', 'Judges', 21], ['RUT', 'Ruth', 4],
  ['1SA', '1 Samuel', 31], ['2SA', '2 Samuel', 24], ['1KI', '1 Kings', 22], ['2KI', '2 Kings', 25], ['1CH', '1 Chronicles', 29], ['2CH', '2 Chronicles', 36], ['EZR', 'Ezra', 10], ['NEH', 'Nehemiah', 13],
  ['EST', 'Esther', 10], ['JOB', 'Job', 42], ['PSA', 'Psalms', 150], ['PRO', 'Proverbs', 31], ['ECC', 'Ecclesiastes', 12], ['SNG', 'Song of Songs', 8], ['ISA', 'Isaiah', 66], ['JER', 'Jeremiah', 52],
  ['LAM', 'Lamentations', 5], ['EZK', 'Ezekiel', 48], ['DAN', 'Daniel', 12], ['HOS', 'Hosea', 14], ['JOL', 'Joel', 3], ['AMO', 'Amos', 9], ['OBA', 'Obadiah', 1], ['JON', 'Jonah', 4], ['MIC', 'Micah', 7],
  ['NAM', 'Nahum', 3], ['HAB', 'Habakkuk', 3], ['ZEP', 'Zephaniah', 3], ['HAG', 'Haggai', 2], ['ZEC', 'Zechariah', 14], ['MAL', 'Malachi', 4],
  ['MAT', 'Matthew', 28], ['MRK', 'Mark', 16], ['LUK', 'Luke', 24], ['JHN', 'John', 21], ['ACT', 'Acts', 28], ['ROM', 'Romans', 16], ['1CO', '1 Corinthians', 16], ['2CO', '2 Corinthians', 13],
  ['GAL', 'Galatians', 6], ['EPH', 'Ephesians', 6], ['PHP', 'Philippians', 4], ['COL', 'Colossians', 4], ['1TH', '1 Thessalonians', 5], ['2TH', '2 Thessalonians', 3], ['1TI', '1 Timothy', 6],
  ['2TI', '2 Timothy', 4], ['TIT', 'Titus', 3], ['PHM', 'Philemon', 1], ['HEB', 'Hebrews', 13], ['JAS', 'James', 5], ['1PE', '1 Peter', 5], ['2PE', '2 Peter', 3], ['1JN', '1 John', 5],
  ['2JN', '2 John', 1], ['3JN', '3 John', 1], ['JUD', 'Jude', 1], ['REV', 'Revelation', 22]
]);
const BOOK = Object.fromEntries(BIBLE_BOOKS.map(([c, n, ch]) => [c, { name: n, chapters: ch }]));
const youVersion = usfm => `https://www.bible.com/bible/111/${usfm}`;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// the chapter before/after, crossing into the next book at the edges
export function stepChapter(code, ch, dir) {
  const i = BIBLE_BOOKS.findIndex(b => b[0] === code); if (i < 0) return null;
  if (dir > 0) return ch < BIBLE_BOOKS[i][2] ? [code, ch + 1] : i < BIBLE_BOOKS.length - 1 ? [BIBLE_BOOKS[i + 1][0], 1] : null;
  return ch > 1 ? [code, ch - 1] : i > 0 ? [BIBLE_BOOKS[i - 1][0], BIBLE_BOOKS[i - 1][2]] : null;
}

const SAMPLE = {   // preview mode (no server): one verse and one chapter so the screens can be seen
  votd: { usfm: 'PSA.46.1', reference: 'Psalms 46:1', verses: [{ v: 1, t: 'God is our refuge and strength, a very present help in trouble.' }], translation: 'WEB', source: 'sample', youversion: youVersion('PSA.46.1') },
  chapter: { usfm: 'PSA.23', reference: 'Psalms 23', translation: 'WEB', youversion: youVersion('PSA.23'), verses: [
    'Yahweh is my shepherd: I shall lack nothing.', 'He makes me lie down in green pastures. He leads me beside still waters.', 'He restores my soul. He guides me in the paths of righteousness for his name’s sake.',
    'Even though I walk through the valley of the shadow of death, I will fear no evil, for you are with me. Your rod and your staff, they comfort me.', 'You prepare a table before me in the presence of my enemies. You anoint my head with oil. My cup runs over.',
    'Surely goodness and loving kindness shall follow me all the days of my life, and I will dwell in Yahweh’s house forever.'].map((t, i) => ({ v: i + 1, t })) }
};

export function createBible({ root, apiBase = '/api/bible', demo = false, store, toast, onVotd }) {
  let votd = null, votdState = 'idle', chapter = null, loading = false, error = '';
  let pos = store.get('bible:pos', ['PSA', 23]);
  const get = async q => { const r = await fetch(`${apiBase}?${q}`); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Could not load'); return j; };

  async function loadVotd() {
    const today = localDate(), cached = store.get('bible:votd', null);
    if (cached?.date === today && cached.verses?.length) { votd = cached; votdState = 'ready'; onVotd?.(); return; }
    if (votdState === 'loading') return;
    votdState = 'loading';
    try {
      votd = demo ? { ...SAMPLE.votd, date: today } : await get(`votd=1&d=${today}`);
      votd.date = today; votdState = 'ready';
      if (votd.source !== 'fallback') store.set('bible:votd', votd);
    } catch { votdState = cached ? 'ready' : 'error'; votd = cached; }
    onVotd?.(); render();
  }
  const votdText = v => v.verses.map(x => x.t).join(' ');
  // small card for the top of News
  function votdCard(compact = true) {
    if (votdState === 'idle') loadVotd();
    if (!votd) return votdState === 'error' ? '' : `<div class="votd ${compact ? 'compact' : ''}"><span class="votd-label">Verse of the Day</span><p class="sg-muted">Loading…</p></div>`;
    return `<article class="votd ${compact ? 'compact' : ''}">
      <span class="votd-label">✨ Verse of the Day</span>
      <p class="votd-text">“${esc(votdText(votd))}”</p>
      <div class="votd-ref">— ${esc(votd.reference)} <small>(${esc(votd.translation)})</small></div>
      <div class="votd-actions"><a class="link-btn" href="${esc(votd.youversion)}" target="_blank" rel="noopener">Read in YouVersion ↗</a>${compact ? '<button class="link-btn" data-bible="open">Open Bible</button>' : '<button class="link-btn" data-bible="share">Copy</button>'}</div>
    </article>`;
  }

  async function loadChapter() {
    const [code, ch] = pos, usfm = `${code}.${ch}`;
    if (chapter?.usfm === usfm || loading) return;
    loading = true; error = ''; render();
    try {
      const key = 'bible:ch:' + usfm, cached = store.get(key, null);
      chapter = cached || (demo ? { ...SAMPLE.chapter, usfm, reference: `${BOOK[code].name} ${ch}`, youversion: youVersion(usfm) } : await get(`p=${usfm}`));
      if (!cached && !demo) { store.set(key, chapter); }
    } catch (e) { error = e.message || 'Could not load this chapter.'; chapter = null; }
    loading = false; render();
    root.querySelector('.bible-text')?.scrollIntoView({ block: 'start' });
  }
  function go(code, ch) { pos = [code, ch]; store.set('bible:pos', pos); chapter = null; loadChapter(); }

  function render() {
    if (!root || root.classList.contains('hidden')) return;
    const [code, ch] = pos, book = BOOK[code];
    const prev = stepChapter(code, ch, -1), next = stepChapter(code, ch, 1);
    root.innerHTML = `${votdCard(false)}
      <section class="bible-reader">
        <div class="bible-pick">
          <select id="bibleBook" aria-label="Book">${BIBLE_BOOKS.map(([c, n]) => `<option value="${c}" ${c === code ? 'selected' : ''}>${n}</option>`).join('')}</select>
          <select id="bibleCh" aria-label="Chapter">${Array.from({ length: book.chapters }, (_, i) => `<option ${i + 1 === ch ? 'selected' : ''}>${i + 1}</option>`).join('')}</select>
        </div>
        <div class="bible-text">
          <h2>${esc(book.name)} ${ch}</h2>
          ${loading ? '<p class="sg-muted">Loading…</p>' : error ? `<p class="sg-error">${esc(error)}</p><button class="btn secondary" data-bible="retry">Try again</button>` :
            chapter ? `<p class="bible-verses">${chapter.verses.map(x => `<sup>${x.v}</sup>${esc(x.t)} `).join('')}</p>` : ''}
        </div>
        <div class="bible-nav">
          <button class="btn secondary" data-bible="prev" ${prev ? '' : 'disabled'}>‹ ${prev ? esc(BOOK[prev[0]].name + ' ' + prev[1]) : ''}</button>
          <button class="btn secondary" data-bible="next" ${next ? '' : 'disabled'}>${next ? esc(BOOK[next[0]].name + ' ' + next[1]) : ''} ›</button>
        </div>
        <a class="btn accent bible-yv" href="${youVersion(`${code}.${ch}`)}" target="_blank" rel="noopener">Open ${esc(book.name)} ${ch} in YouVersion (NIV & more) ↗</a>
        <p class="sg-muted">Text: World English Bible (public domain). YouVersion opens in its app if you have it.</p>
      </section>`;
    if (!chapter && !loading && !error) loadChapter();
  }

  root?.addEventListener('change', e => {
    if (e.target.id === 'bibleBook') go(e.target.value, 1);
    if (e.target.id === 'bibleCh') go(pos[0], Number(e.target.value));
  });
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-bible]'); if (!b) return;
    const a = b.dataset.bible, [code, ch] = pos;
    if (a === 'prev' || a === 'next') { const t = stepChapter(code, ch, a === 'next' ? 1 : -1); if (t) go(...t); }
    if (a === 'retry') { chapter = null; loadChapter(); }
    if (a === 'share' && votd) { try { await navigator.clipboard.writeText(`“${votdText(votd)}” — ${votd.reference}`); toast('Copied'); } catch { toast('Press and hold the verse to copy it'); } }
  });
  return { render, votdCard, loadVotd };
}
