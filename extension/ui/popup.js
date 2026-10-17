import { setConfig } from '../src/config.js';

const $ = (id) => document.getElementById(id);
const ask = (msg) => chrome.runtime.sendMessage(msg);

async function render() {
  const s = await ask({ type: 'status' });
  const cfg = s.config;
  $('setup').hidden = !!s.active;
  $('main').hidden = !s.active;
  $('set-work').textContent = cfg.labels.work;
  $('set-personal').textContent = cfg.labels.personal;
  if (!s.active) return;

  for (const id of ['work', 'personal']) {
    const active = s.active === id;
    $(`label-${id}`).textContent = cfg.labels[id];
    $(`meta-${id}`).textContent = active ? 'Is waqt khula hai' : s.saved[id] ? 'Login yaad hai' : 'Pehli dafa login karna hoga';
    $(`now-${id}`).textContent = active ? 'Active' : '';
    document.querySelector(`.acct[data-id="${id}"]`).setAttribute('aria-pressed', String(active));
  }
  $('carry').checked = cfg.carryPrompt;

  const limit = s.limit && s.limit.account === s.active;
  $('limit').hidden = !limit;
  if (limit) {
    const to = s.active === 'work' ? 'personal' : 'work';
    $('limit').textContent = `${cfg.labels[s.active]} ki limit khatam lagti hai. ${cfg.labels[to]} par switch kar sakte hain.`;
  }
}

function say(text) {
  $('msg').hidden = !text;
  $('msg').textContent = text || '';
}

document.querySelectorAll('[data-set]').forEach((b) =>
  b.addEventListener('click', async () => {
    await ask({ type: 'set-active', id: b.dataset.set });
    render();
  })
);

document.querySelectorAll('.acct').forEach((b) =>
  b.addEventListener('click', async () => {
    const id = b.dataset.id;
    say('Switch ho raha hai...');
    const r = await ask({ type: 'switch', id });
    if (r?.error) return say(`Masla: ${r.error}`);
    await render();
    const { config } = await ask({ type: 'status' });
    say(
      !r.changed
        ? `${config.labels[id]} pehle se khula hai.`
        : r.loggedIn
          ? `${config.labels[id]} khul gaya.`
          : `Ab claude.ai par ${config.labels[id]} account se login karein (Google bhi chalega). Agli dafa ye yaad rahega.`
    );
  })
);

$('carry').addEventListener('change', (e) => setConfig({ carryPrompt: e.target.checked }));

$('history').addEventListener('click', async () => {
  const win = await chrome.windows.getCurrent();
  await chrome.sidePanel.open({ windowId: win.id });
  window.close();
});

$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

render();
