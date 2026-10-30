// Histoire des villes-étapes, tirée de Wikipédia en français (API publique, sans clé).
// On garde l'introduction de l'article et le début de sa section « Histoire ».

import { loadCache, saveCache } from './kv.js';
const CACHE_KEY = 'capouest.history.v1';
const API = 'https://fr.wikipedia.org/w/api.php';

const REGION = {
  QC: 'Québec', ON: 'Ontario', MB: 'Manitoba', SK: 'Saskatchewan', AB: 'Alberta', BC: 'Colombie-Britannique',
  ND: 'Dakota du Nord', SD: 'Dakota du Sud', MT: 'Montana', WY: 'Wyoming', ID: 'Idaho', UT: 'Utah',
};

let cache = {};
// Chargé depuis IndexedDB (kv.js) : attendre « ready » avant d'utiliser le cache
export const ready = loadCache(CACHE_KEY).then(c => { cache = { ...c, ...cache }; });
const persist = () => { saveCache(CACHE_KEY, cache); };

// « Kakabeka Falls (Thunder Bay), ON » → « Kakabeka Falls Ontario »
function searchText(name) {
  const [place, code] = name.split(',').map(s => s.trim());
  const clean = place.replace(/\(.*?\)/g, '').replace(/\bNP\b/g, 'parc national').replace(/\bPP\b/g, 'parc provincial').trim();
  return `${clean} ${REGION[code] || code || ''}`.trim();
}

async function api(params) {
  const url = API + '?' + new URLSearchParams({ format: 'json', origin: '*', ...params });
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Wikipédia HTTP ${r.status}`);
  return r.json();
}

function trim(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf('. ') + 1, max * 0.6)) + ' …';
}

// { title, url, intro, history, thumb } ou null si aucun article
export async function cityHistory(stepName) {
  const q = searchText(stepName);
  if (cache[q] !== undefined) return cache[q];

  const search = await api({ action: 'query', list: 'search', srsearch: q, srlimit: '1' });
  const hit = search.query?.search?.[0];
  if (!hit) { cache[q] = null; persist(); return null; }

  const page = Object.values((await api({
    action: 'query', prop: 'extracts|pageimages|info', inprop: 'url', explaintext: '1', exsectionformat: 'wiki',
    piprop: 'thumbnail', pithumbsize: '400', titles: hit.title, redirects: '1',
  })).query.pages)[0];

  const text = page.extract || '';
  const intro = text.split(/\n==/)[0].trim();
  const hist = /\n==\s*Histo(?:ire|rique)\s*==\n([\s\S]*?)(?=\n==[^=]|$)/.exec(text);
  const history = hist ? hist[1].replace(/\n===.*?===\n/g, '\n').replace(/\n{2,}/g, '\n').trim() : '';

  cache[q] = {
    title: page.title,
    url: page.fullurl || `https://fr.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
    intro: trim(intro, 600),
    history: trim(history, 1200),
    thumb: page.thumbnail?.source || '',
  };
  persist();
  return cache[q];
}
