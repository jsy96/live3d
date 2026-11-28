// Cloud roaming UI (CDN web mode): "桌宠去向" panel + first-open name prompt.
//
//   - First open: this browser gets asked for a home name ("谁的家") — the
//     name identifies it in every visitor's list and is stored locally.
//   - Dock 🏠 button toggles the whereabouts panel: where the pet is NOW,
//     the visit history (过去在谁家) and which homes are currently open
//     (waiting list). Adopting the free pet / sending it back happens here.
//   - When the pet leaves for someone else's home, the panel auto-opens.
import { platform } from './platform.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const today = new Date();
  return d.toDateString() === today.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

function fmtDur(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} 分钟`;
  return `${(min / 60).toFixed(1)} 小时`;
}

export function createCloudRoamUI() {
  // --- first-open prompt: name this home -------------------------------
  function askName() {
    return new Promise((resolve) => {
      const card = el('div', 'roam-prompt');
      const title = el('div', 'roam-prompt-title', '🐾 这里是谁的家？');
      const sub = el('div', 'roam-prompt-sub', '给这个浏览器起个名字，桌宠串门时好认路（只问这一次）');
      const input = el('input', 'roam-prompt-input');
      input.type = 'text';
      input.maxLength = 24;
      input.placeholder = '例如：老金的家 / 宿舍的电脑';
      const btn = el('button', 'web-btn', '就是这儿');
      btn.disabled = true;
      input.addEventListener('input', () => (btn.disabled = !input.value.trim()));
      const done = () => {
        const name = input.value.trim();
        if (!name) return;
        card.remove();
        resolve(name);
      };
      btn.addEventListener('click', done);
      input.addEventListener('keydown', (e) => e.key === 'Enter' && done());
      card.append(title, sub, input, btn);
      document.body.append(card);
      setTimeout(() => input.focus(), 100);
    });
  }
  if (!platform.getHomeName()) {
    askName().then((name) => platform.renameHome(name));
  }

  // --- dock button + whereabouts sheet ----------------------------------
  const dock = document.querySelector('.web-dock');
  const fab = el('button', 'web-fab', '🏠');
  fab.title = '桌宠去向';
  const sheet = el('div', 'web-sheet hidden roam-sheet');
  const backdrop = el('div', 'web-backdrop hidden');
  const close = el('button', 'web-close', '✕');
  const title = el('div', 'web-title', '桌宠去向');
  const head = el('div', 'web-head');
  head.append(title, close);
  sheet.append(head);
  const body = el('div', 'roam-body');
  sheet.append(body);
  document.body.append(backdrop, sheet);
  if (dock) dock.prepend(fab); // first dock slot: the always-there cloud action

  function open(v) {
    sheet.classList.toggle('hidden', !v);
    backdrop.classList.toggle('hidden', !v);
  }
  fab.addEventListener('click', () => open(sheet.classList.contains('hidden')));
  backdrop.addEventListener('click', () => open(false));
  close.addEventListener('click', () => open(false));
  window.addEventListener('keydown', (e) => e.key === 'Escape' && open(false));

  // --- rendering ---------------------------------------------------------
  let lastHolderSeen = undefined; // for the auto-open transition
  let busy = false;
  let lastActionAt = 0; // holder changes are dramatic: rapid double-fires
  // (a racing click, a re-render overlap) must not flip the pet around.

  function actionBtn(label, onClick, disabled = false) {
    const b = el('button', 'web-btn roam-act', label);
    b.disabled = disabled || busy;
    b.addEventListener('click', async () => {
      if (Date.now() - lastActionAt < 2000) return;
      lastActionAt = Date.now();
      busy = true;
      b.disabled = true;
      try {
        await onClick();
      } finally {
        busy = false;
      }
    });
    return b;
  }

  function render(state) {
    if (!state) return;
    // Test/debug handle: the pet shows on this page exactly when it is free
    // or hosted here; the homes count doubles as a presence probe.
    document.body.dataset.petHere = !state.holder || state.holder === state.me ? '1' : '0';
    document.body.dataset.roamHomesCount = String(state.homes.length);
    body.replaceChildren();

    // 现在
    body.append(el('div', 'web-sec-h', '现在'));
    const now = el('div', 'roam-now');
    if (!state.holder) {
      now.append(el('span', null, '☁️ 云之家 — 自由串门，谁都能接它回家'));
      body.append(now);
      body.append(actionBtn('接桌宠回家 🐾', () => platform.adoptPet()));
    } else if (state.holder === state.me) {
      now.append(el('span', null, `🎉 桌宠在你家（${fmtDur(Date.now() - (state.holderSince ?? Date.now()))}）`));
      body.append(now);
      body.append(actionBtn('送回云之家', () => platform.releasePet()));
    } else {
      const mins = fmtDur(Date.now() - (state.holderSince ?? Date.now()));
      const offline = state.holderOnline ? '' : '（那家已关页面，桌宠马上回云之家）';
      now.append(el('span', null, `🐾 在「${state.holderName ?? '某家'}」做客 · ${mins}${offline}`));
      body.append(now);
    }

    // 串门记录（过去在谁家，最新在上）
    body.append(el('div', 'web-sec-h', '串门记录'));
    const visits = [...state.visits].reverse();
    if (visits.length === 0) {
      body.append(el('div', 'roam-dim', '还没有串过门'));
    } else {
      const box = el('div', 'roam-visits');
      for (const v of visits.slice(0, 12)) {
        const span = v.to ? fmtDur(v.to - v.from) : '还在做客';
        const range = v.to ? `${fmtTime(v.from)} – ${fmtTime(v.to)}` : `${fmtTime(v.from)} 起`;
        const row = el('div', 'roam-vrow');
        row.append(el('span', 'roam-vname', `${v.name ?? '某家'}${v.id === state.me ? '（你）' : ''}`));
        row.append(el('span', 'roam-vtime', `${range} · ${span}`));
        box.append(row);
      }
      body.append(box);
    }

    // 现在开着的家（等待名单）
    body.append(el('div', 'web-sec-h', `开着的家（${state.homes.length}）`));
    const homesBox = el('div', 'roam-visits');
    const homes = [...state.homes].sort((a, b) =>
      a.id === state.me ? -1 : b.id === state.me ? 1 : 0
    );
    for (const h of homes) {
      const row = el('div', 'roam-vrow');
      const tag =
        h.id === state.holder ? '· 持有中' : h.id === state.me ? '· 你自己' : '· 等待中';
      row.append(el('span', 'roam-vname', `● ${h.name}${tag}`));
      row.append(el('span', 'roam-vtime', fmtTime(h.lastSeen)));
      homesBox.append(row);
    }
    if (state.homes.length === 0) {
      body.append(el('div', 'roam-dim', '现在只有你家开着（刚打开，等几秒名单就到）'));
    } else {
      body.append(homesBox);
    }

    // Pet left for someone else -> surface the list automatically.
    if (lastHolderSeen !== undefined && state.holder && state.holder !== state.me && state.holder !== lastHolderSeen) {
      open(true);
    }
    lastHolderSeen = state.holder ?? null;
  }

  platform.onRoamState(render);
  render(platform.getRoamState());
}
