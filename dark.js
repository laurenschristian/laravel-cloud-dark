// Match the page to the macOS appearance: invert only when the site's own theme disagrees with it.
const root = document.documentElement;
const systemDark = matchMedia('(prefers-color-scheme: dark)');

// Body text color is untouched by our CSS, so light text means the site renders dark.
function pageIsDark() {
  if (!document.body) return null;
  const [r, g, b] = getComputedStyle(document.body).color.match(/\d+/g).map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b >= 128;
}

function update() {
  const dark = pageIsDark();
  const pref = getPref();
  const want = pref === 'system' ? systemDark.matches : pref === 'dark';
  const mode = (dark === null ? want : want && !dark) ? 'dark' : dark !== null && !want && dark ? 'light' : '';
  // A data attribute survives sites that rewrite html.className, and only changed values are written.
  if ((root.dataset.lcd || '') !== mode) mode ? (root.dataset.lcd = mode) : delete root.dataset.lcd;
}

const attrs = { attributeFilter: ['class', 'style', 'data-theme'] };
update();
systemDark.addEventListener('change', update);
document.addEventListener('DOMContentLoaded', () => {
  update();
  new MutationObserver(update).observe(document.body, attrs);
});
new MutationObserver(update).observe(root, attrs);

// Cloud's markup has no stable hooks, so find the grid under the "Recently deployed" heading.
function tagAppGrid() {
  if (document.querySelector('[data-lcd-apps]')) return;
  const heading = [...document.querySelectorAll('h1, h2, h3, h4')].find((h) => h.textContent.trim() === 'Recently deployed');
  for (let el = heading?.parentElement; el && el !== document.body; el = el.parentElement) {
    const grid = [...el.querySelectorAll('*')].find((n) => getComputedStyle(n).display === 'grid');
    if (grid) return (grid.dataset.lcdApps = '');
  }
}

let queued = false;
new MutationObserver(() => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => ((queued = false), tagAppGrid(), tagOverview(), sortApps(), compactCards(), linkRepos(), mountSwitch(), mountEnvFilter(), tagRows()));
}).observe(root, { childList: true, subtree: true });

// Hide the org title above "Recently deployed" and mark the New application button as primary.
function tagOverview() {
  const button = [...document.querySelectorAll('a, button')].find((n) => n.textContent.trim() === 'New application');
  if (button) button.dataset.lcdPrimary = '';
  const headings = [...document.querySelectorAll('h1, h2, h3, h4')].filter((h) => !h.closest('header'));
  const recent = headings.findIndex((h) => h.textContent.trim() === 'Recently deployed');
  let el = headings[recent - 1];
  if (!el || el.closest('[data-lcd-hidden]')) return;
  while (el.parentElement && !el.parentElement.contains(headings[recent])) el = el.parentElement;
  el.dataset.lcdHidden = '';
  // The hidden title leaves its container's top padding behind; tighten it.
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement)
    if (parseFloat(getComputedStyle(p).paddingTop) > 24) p.dataset.lcdTight = '';
}

// Production first, then Staging, then everything else in Cloud's order.
const envRank = { Production: 0, Staging: 1 };
function sortApps() {
  const grid = document.querySelector('[data-lcd-apps]');
  if (!grid) return;
  for (const card of grid.children) {
    if (card.dataset.lcdRank) continue;
    const env = [...card.querySelectorAll('*')].find((n) => !n.children.length && n.textContent.trim() in envRank);
    card.dataset.lcdRank = card.style.order = env ? envRank[env.textContent.trim()] : 2;
  }
}

// Swap "owner/repo" for a short GitHub link; branch names look the same but render monospace.
function linkRepos() {
  const grid = document.querySelector('[data-lcd-apps]');
  if (!grid) return;
  const walker = document.createTreeWalker(grid, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode()); ) {
    const repo = n.data.trim();
    const el = n.parentElement;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || /mono/i.test(getComputedStyle(el).fontFamily)) continue;
    n.data = 'GitHub';
    el.title = repo;
    el.dataset.lcdRepo = '';
    el.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(`https://github.com/${repo}`, '_blank', 'noopener');
    };
  }
}

// Card details on one row; the branch chip opens that branch on GitHub.
function compactCards() {
  document.querySelectorAll('[data-lcd-apps] [data-test="environment-card"] .space-y-3:not([data-lcd-row])').forEach((rows) => {
    rows.dataset.lcdRow = '';
    const repo = rows.querySelector('a[href^="https://github.com/"]')?.getAttribute('href');
    const icon = rows.querySelector('a[href^="https://github.com/"]')?.parentElement.querySelector('button');
    if (repo && icon) {
      icon.dataset.lcdGh = '';
      icon.dataset.lcdTip = repo.replace('https://github.com/', '');
      icon.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(repo, '_blank', 'noopener');
      };
    }
    const site = rows.querySelector('a[href]:not([href^="https://github.com/"])');
    if (site) {
      site.dataset.lcdSite = '';
      site.dataset.lcdTip = site.textContent.trim();
    }
    const code = rows.querySelector('code');
    const branch = code?.querySelector('span span')?.textContent.trim();
    if (!repo || !branch) return;
    code.dataset.lcdBranch = '';
    code.dataset.lcdTip = `Open ${branch} on GitHub`;
    code.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(`${repo}/tree/${branch}`, '_blank', 'noopener');
    };
  });
}

let envColors = {};
try {
  envColors = JSON.parse(localStorage.getItem('lcd-env-colors')) || {};
} catch {}

function collectEnvColors() {
  let changed = false;
  for (const card of document.querySelectorAll('[data-test="environment-card"]')) {
    const name = card.querySelector('[data-test="environment-name"]')?.textContent.trim();
    const color = card.querySelector('span[style*="background-color"]')?.style.backgroundColor;
    if (name && color && envColors[name] !== color) (envColors[name] = color), (changed = true);
  }
  if (!changed) return;
  try {
    localStorage.setItem('lcd-env-colors', JSON.stringify(envColors));
  } catch {}
}

const envFilters = ['All', 'Production', 'Staging'];

function getEnvFilter() {
  try {
    return localStorage.getItem('lcd-env') || 'All';
  } catch {
    return 'All';
  }
}

function mountEnvFilter() {
  const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === 'Latest deployments');
  const section = heading?.parentElement;
  if (!section || section.querySelector('.lcd-seg')) return;
  const envs = new Set([...document.querySelectorAll('tr[data-test="deployment-row"]')].map(envOf).filter(Boolean));
  if (envs.size < 2) return;
  section.dataset.lcdDeploys = '';
  const el = document.createElement('div');
  el.className = 'lcd-switch lcd-seg';
  el.setAttribute('role', 'radiogroup');
  for (const env of envFilters) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = env;
    b.dataset.env = env;
    b.onclick = () => {
      try {
        localStorage.setItem('lcd-env', env);
      } catch {}
      tagRows();
    };
    el.append(b);
  }
  section.append(el);
}

// Only the org overview has an environment column; environment pages list a single env.
const envLink = (tr) => [...tr.querySelectorAll('a:not([data-row-link]):not([href^="https://github.com/"])')].pop();
const envOf = (tr) => envLink(tr)?.textContent.trim();

// Filter rows by environment, show full commit titles on hover, and mirror deploy state in the favicon.
function tagRows() {
  collectEnvColors();
  const filter = getEnvFilter();
  document.querySelectorAll('.lcd-seg button').forEach((b) => b.setAttribute('aria-checked', b.dataset.env === filter));
  const seen = new Set();
  let state = '';
  for (const tr of document.querySelectorAll('tr[data-test="deployment-row"]')) {
    const env = envOf(tr);
    const off = !!env && filter !== 'All' && env !== filter;
    if (off !== (tr.dataset.lcdOff != null)) off ? (tr.dataset.lcdOff = '') : delete tr.dataset.lcdOff;
    const link = envLink(tr);
    if (link && envColors[env] && link.style.getPropertyValue('--lcd-env') !== envColors[env]) {
      link.dataset.lcdEnv = '';
      link.style.setProperty('--lcd-env', envColors[env]);
    }
    const p = tr.querySelector('p.truncate');
    const title = tr.querySelector('a[data-row-link]')?.getAttribute('aria-label');
    if (p && title && p.title !== title) p.title = title;
    // Rows are newest first, so the first row per environment is its current state.
    if (seen.has(env)) continue;
    seen.add(env);
    const status = tr.cells[0]?.querySelector('.sr-only')?.textContent || '';
    if (/deploying|building|pending|queued|running|progress/i.test(status)) state = 'busy';
    else if (/fail|error/i.test(status) && !state) state = 'fail';
  }
  setFavicon(state);
}

let favState = '';
function setFavicon(state) {
  if (state === favState) return;
  favState = state;
  const links = [...document.querySelectorAll('link[rel~="icon"]')];
  links.forEach((l) => (l.dataset.lcdOrig ??= l.href));
  if (!links.length) return;
  if (!state) return links.forEach((l) => (l.href = l.dataset.lcdOrig));
  const img = new Image();
  img.crossOrigin = 'anonymous';
  const draw = (withIcon) => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    if (withIcon) ctx.drawImage(img, 0, 0, 32, 32);
    ctx.beginPath();
    ctx.arc(24, 24, 7, 0, 2 * Math.PI);
    ctx.fillStyle = state === 'busy' ? '#2563eb' : '#dc2626';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    try {
      const url = c.toDataURL();
      if (favState === state) links.forEach((l) => (l.href = url));
    } catch {
      draw(false);
    }
  };
  img.onload = () => draw(true);
  img.onerror = () => draw(false);
  img.src = links[0].dataset.lcdOrig;
}

function getPref() {
  try {
    return localStorage.getItem('lcd-theme') || 'system';
  } catch {
    return 'system';
  }
}

const icons = {
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  dark: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/>',
  system: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
};

function mountSwitch() {
  const header = document.querySelector('header');
  if (!header || header.querySelector('.lcd-switch')) return;
  const el = document.createElement('div');
  el.className = 'lcd-switch';
  el.setAttribute('role', 'radiogroup');
  for (const mode of ['light', 'dark', 'system']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = mode[0].toUpperCase() + mode.slice(1);
    b.setAttribute('aria-label', b.title);
    b.dataset.mode = mode;
    b.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[mode]}</svg>`;
    b.onclick = () => {
      try {
        localStorage.setItem('lcd-theme', mode);
      } catch {}
      syncSwitch();
      update();
    };
    el.append(b);
  }
  const search = [...header.querySelectorAll('button, a, [role="button"]')].find((n) => n.textContent.trim().startsWith('Search'));
  if (search) {
    if (search.offsetHeight) el.style.height = `${search.offsetHeight}px`;
    search.before(el);
  } else header.append(el);
  syncSwitch();
}

function syncSwitch() {
  const pref = getPref();
  document.querySelectorAll('.lcd-switch button').forEach((b) => b.setAttribute('aria-checked', b.dataset.mode === pref));
}
