// Phone-only UI (web mode). Two parts:
//   1. A floating dock (right edge): roam buttons are ALWAYS available, the
//      ☰ button toggles the console sheet.
//   2. The console sheet: model chips + collapsible animation groups with a
//      filter. Kept deliberately short — facing is free-rotate by dragging
//      the background (src/interaction/mouse.js), not chips in here.
// Selections travel upstream over the roaming WebSocket; the desktop applies
// them and broadcasts back, so every device (including this one) converges.
import { platform } from './platform.js';

function basename(p) {
  return String(p ?? '').split(/[\\/]/).pop().toLowerCase();
}

function prettyName(p) {
  return basename(p)
    .replace(/\.(vrma?|glb)$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

/** Same grouping the desktop right-click menu uses. */
function groupOf(file) {
  const n = basename(file);
  if (n.startsWith('action_')) return 'Actions';
  if (n.startsWith('dance_')) return 'Dances';
  if (n.startsWith('sit_') || n.startsWith('idle')) return 'Idle & Sit';
  return 'Emotions & Others';
}

export function createWebPicker({ models, animations }) {
  const state = { model: null, animation: null };

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // --- floating dock: roam shortcuts + console toggle
  const dock = el('div', 'web-dock');
  const toPhone = el('button', 'web-fab web-roam', '\u{1F4F1}');
  toPhone.title = '留在这里（桌宠跑到手机）';
  const toDesktop = el('button', 'web-fab web-roam', '\u{1F5A5}');
  toDesktop.title = '送到电脑（桌宠回电脑）';
  const fab = el('button', 'web-fab', '☰');
  fab.title = '桌宠控制台';
  toPhone.addEventListener('click', () => platform.roamTo('phone'));
  toDesktop.addEventListener('click', () => platform.roamTo('desktop'));

  const sheet = el('div', 'web-sheet hidden');
  const recallChip = el('button', 'web-recall hidden', '\u{1F4F1} 桌宠在电脑上 · 点此召回');
  recallChip.addEventListener('click', () => platform.roamTo('phone'));

  fab.addEventListener('click', () => sheet.classList.toggle('hidden'));
  dock.append(toPhone, toDesktop, fab);
  document.body.append(dock, sheet, recallChip);

  const close = el('button', 'web-close', '✕');
  close.addEventListener('click', () => sheet.classList.add('hidden'));
  const title = el('div', 'web-title', '桌宠控制台');
  const head = el('div', 'web-head');
  head.append(title, close);
  sheet.append(head);

  // --- models: compact horizontal chips instead of tall rows
  sheet.append(el('div', 'web-sec-h', '模型'));
  const chipRow = el('div', 'web-chips');
  sheet.append(chipRow);
  const modelChips = models.map((m) => {
    const chip = el('button', 'web-mchip', prettyName(m.path));
    chip.addEventListener('click', () => platform.setModelRemote(basename(m.path)));
    chipRow.append(chip);
    return { chip, name: basename(m.path) };
  });

  // --- animations: collapsible groups + filter (sheet stays short by default)
  sheet.append(el('div', 'web-sec-h', '待机动画'));
  const filter = el('input', 'web-filter');
  filter.type = 'search';
  filter.placeholder = '筛选动画...';
  sheet.append(filter);

  const groups = new Map(); // label -> { box, headEl, rows: [{row,name}] }
  for (const a of animations) {
    const label = groupOf(a.path);
    let g = groups.get(label);
    if (!g) {
      g = { box: el('div', 'web-group'), headEl: null, rows: [] };
      g.headEl = el('button', 'web-gh', `${label} (0) ▸`);
      g.headEl.addEventListener('click', () => g.box.classList.toggle('open'));
      g.box.append(g.headEl);
      sheet.append(g.box);
      groups.set(label, g);
    }
    const row = el('div', 'web-row', prettyName(a.path));
    row.addEventListener('click', () => platform.setAnimationRemote(basename(a.path)));
    g.box.append(row);
    g.rows.push({ row, name: basename(a.path) });
  }
  for (const [label, g] of groups) {
    g.headEl.textContent = `${label} (${g.rows.length}) ▸`;
  }

  filter.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase();
    for (const g of groups.values()) {
      let visible = 0;
      for (const r of g.rows) {
        const hit = !q || r.name.includes(q) || prettyName(r.name).toLowerCase().includes(q);
        r.row.classList.toggle('filtered-out', !hit);
        if (hit) visible++;
      }
      g.box.classList.toggle('filtered-out', visible === 0);
      // Typing auto-expands matching groups; clearing collapses them again.
      g.box.classList.toggle('open', !!q && visible > 0);
    }
  });

  // --- selection highlighting
  function refresh() {
    for (const c of modelChips) c.chip.classList.toggle('cur', c.name === state.model);
    for (const g of groups.values()) {
      for (const r of g.rows) r.row.classList.toggle('cur', r.name === state.animation);
    }
  }

  /** Called by app.js whenever the model/animation actually changed. */
  function select(sel) {
    if (sel.model !== undefined) state.model = sel.model ? basename(sel.model) : null;
    if (sel.animation !== undefined) {
      state.animation = sel.animation ? basename(sel.animation) : null;
    }
    refresh();
  }

  /** Pet stowed after a roam-away (true) or back home (false). */
  function setPetAway(v) {
    recallChip.classList.toggle('hidden', !v);
  }

  return { select, setPetAway };
}
