import { getConfig, setConfig, connector, ACCOUNTS } from '../src/config.js';

const $ = (id) => document.getElementById(id);

function read(cfg) {
  return {
    labels: {
      work: $('label-work').value.trim() || cfg.labels.work,
      personal: $('label-personal').value.trim() || cfg.labels.personal,
    },
    connectorUrl: $('url').value.trim().replace(/\/+$/, ''),
    tokens: { work: $('token-work').value.trim(), personal: $('token-personal').value.trim() },
    logMessages: $('log').checked,
  };
}

async function fill() {
  const cfg = await getConfig();
  $('label-work').value = cfg.labels.work;
  $('label-personal').value = cfg.labels.personal;
  $('url').value = cfg.connectorUrl;
  $('token-work').value = cfg.tokens.work;
  $('token-personal').value = cfg.tokens.personal;
  $('log').checked = cfg.logMessages;
  $('tok-work-label').textContent = `${cfg.labels.work} token`;
  $('tok-personal-label').textContent = `${cfg.labels.personal} token`;
  $('forget-work').textContent = `Forget ${cfg.labels.work}`;
  $('forget-personal').textContent = `Forget ${cfg.labels.personal}`;
}

$('save').addEventListener('click', async () => {
  await setConfig(read(await getConfig()));
  await fill();
  $('saved').hidden = false;
  setTimeout(() => ($('saved').hidden = true), 2000);
});

$('test').addEventListener('click', async () => {
  const cfg = { ...(await getConfig()), ...read(await getConfig()) };
  const out = $('test-result');
  out.className = 'small';
  out.textContent = 'Checking...';
  const parts = [];
  for (const id of ACCOUNTS) {
    const c = connector(cfg, id);
    if (!c) {
      parts.push(`${cfg.labels[id]}: no token`);
      continue;
    }
    try {
      await c.history('');
      parts.push(`${cfg.labels[id]}: OK`);
    } catch (err) {
      parts.push(`${cfg.labels[id]}: ${err.message}`);
    }
  }
  const ok = parts.every((p) => p.endsWith(': OK'));
  out.className = `small ${ok ? 'ok' : 'err'}`;
  out.textContent = parts.join(' · ');
});

for (const id of ACCOUNTS) {
  $(`forget-${id}`).addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'forget', id });
    const cfg = await getConfig();
    $('forget-result').textContent = `Forgot the saved ${cfg.labels[id]} sign-in. You will sign in again on the next switch.`;
  });
}

fill();
