// Phone-only control panel (web mode). A floating button opens a sheet with:
//   - roaming buttons (send the pet to the PC / bring it back here)
//   - facing chips (0/45/90/135/180)
//   - model list (from the LAN API)
//   - animation list, grouped + filterable (126 clips)
// Selections travel upstream over the roaming WebSocket; the desktop applies
// them and broadcasts back, so every device (including this one) converges.
import { platform } from './platform.js';

const FACING_STEPS = [0, 45, 90, 135, 180];

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

  // --- floating button + sheet skeleton
  const fab = el('button', 'web-fab', '☰');
  fab.title = '桌宠控制台';
  const sheet = el('div', 'web-sheet hidden');
  const recallChip = el('button', 'web-recall hidden', '\u{1F4F1} 桌宠在电脑上 · 点此召回');
  recallChip.addEventListener('click', () => platform.roamTo('phone'));

  fab.addEventListener('click', () => sheet.classList.toggle('hidden'));
  document.body.append(fab, sheet, recallChip);

  const close = el('button', 'web-close', '✕');
  close.addEventListener('click', () => sheet.classList.add('hidden'));
  const title = el('div', 'web-title', '桌宠控制台');
  const head = el('div', 'web-head');
  head.append(title, close);
  sheet.append(head);

  // --- roaming + facing quick controls
  const roamRow = el('div', 'web-rowbtns');
  const toDesktop = el('button', 'web-btn', '\u{1F5A5} 送到电脑');
  const toPhone = el('button', 'web-btn', '留在这里 \u{1F4F1}');
  toDesktop.addEventListener('click', () => platform.roamTo('desktop'));
  toPhone.addEventListener('click', () => platform.roamTo('phone'));
  roamRow.append(toDesktop, toPhone);

  const faceRow = el('div', 'web-rowbtns');
  const faceBtns = FACING_STEPS.map((deg) => {
    const b = el('button', 'web-chip', `${deg}°`);
    b.addEventListener('click', () => platform.setFacingRemote(deg));
    faceRow.append(b);
    return { b, deg };
  });

  sheet.append(el('div', 'web-sec-h', '漫游'), roamRow);
  sheet.append(el('div', 'web-sec-h', '朝向'), faceRow);

  // --- model list
  sheet.append(el('div', 'web-sec-h', '模型'));
  const modelRows = models.map((m) => {
    const row = el('div', 'web-row', prettyName(m.path));
    row.addEventListener('click', () => platform.setModelRemote(basename(m.path)));
    sheet.append(row);
    return { row, name: basename(m.path) };
  });

  // --- animation list (grouped, filterable)
  sheet.append(el('div', 'web-sec-h', '待机动画'));
  const filter = el('input', 'web-filter');
  filter.type = 'search';
  filter.placeholder = '筛选动画...';
  sheet.append(filter);

  const groups = new Map(); // label -> { box, rows: [{row,name}] }
  for (const a of animations) {
    const label = groupOf(a.path);
    let g = groups.get(label);
    if (!g) {
      g = { box: el('div', 'web-group'), rows: [] };
      g.box.append(el('div', 'web-group-h', `${label} (${0})`));
      sheet.append(g.box);
      groups.set(label, g);
    }
    const row = el('div', 'web-row', prettyName(a.path));
    row.addEventListener('click', () => platform.setAnimationRemote(basename(a.path)));
    g.box.append(row);
    g.rows.push({ row, name: basename(a.path) });
  }
  for (const [label, g] of groups) {
    g.box.firstChild.textContent = `${label} (${g.rows.length})`;
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
    }
  });

  // --- selection highlighting
  function refresh() {
    for (const r of modelRows) r.row.classList.toggle('cur', r.name === state.model);
    for (const g of groups.values()) {
      for (const r of g.rows) r.row.classList.toggle('cur', r.name === state.animation);
    }
    for (const { b, deg } of faceBtns) b.classList.toggle('cur', deg === state.facing);
  }

  /** Called by app.js whenever the model/animation actually changed. */
  function select(sel) {
    if (sel.model !== undefined) state.model = sel.model ? basename(sel.model) : null;
    if (sel.animation !== undefined) {
      state.animation = sel.animation ? basename(sel.animation) : null;
    }
    if (sel.facing !== undefined) state.facing = sel.facing;
    refresh();
  }

  /** Pet stowed after a roam-away (true) or back home (false). */
  function setPetAway(v) {
    recallChip.classList.toggle('hidden', !v);
  }

  return { select, setPetAway };
}
