// Both accounts' chats and handoffs in one list, read from the connector.
const $ = (id) => document.getElementById(id);
const ask = (msg) => chrome.runtime.sendMessage(msg);

let labels = { work: 'Company', personal: 'Personal', shared: 'Shared' };

const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter(Boolean));
  return n;
};
const when = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

function actions(item, text) {
  const row = el('div', { className: 'row actions' });
  row.append(
    el('button', { textContent: 'Claude mein paste', onclick: () => ask({ type: 'fill', text }) }),
    el('button', { textContent: 'Copy', onclick: () => navigator.clipboard.writeText(text) })
  );
  if (item.chatUrl) {
    const same = item.space === current;
    row.append(
      el('button', {
        textContent: same ? 'Chat kholein' : `${labels[item.space]} par switch + kholein`,
        onclick: () => ask({ type: 'open-chat', url: item.chatUrl, space: item.space }),
      })
    );
  }
  return row;
}

function entry(item) {
  const isHandoff = item.kind === 'handoff';
  const who = isHandoff ? 'Handoff' : item.role === 'user' ? 'Aap' : 'Claude';
  const text = isHandoff
    ? `${item.title}\n\n${item.summary}${item.nextSteps?.length ? `\n\nNext:\n- ${item.nextSteps.join('\n- ')}` : ''}`
    : item.text;
  const li = el(
    'li',
    {},
    el(
      'div',
      { className: 'row head' },
      el('span', { className: `dot ${item.space}` }),
      el('span', { textContent: `${labels[item.space] || item.space} · ${who} · ${when(item.at)}` })
    ),
    (isHandoff ? item.title : item.chatTitle) && el('div', { className: 'title', textContent: isHandoff ? item.title : item.chatTitle }),
    el('div', { className: 'body', textContent: isHandoff ? item.summary : item.text })
  );
  li.querySelector('.body').addEventListener('click', () => li.classList.toggle('open'));
  li.append(actions(item, text));
  return li;
}

let current = null;

async function load() {
  const status = await ask({ type: 'status' });
  current = status.active;
  labels = { ...labels, ...status.config.labels };
  $('state').textContent = 'Load ho raha hai...';

  const r = await ask({ type: 'history', q: $('q').value.trim() });
  $('list').replaceChildren();
  $('handoff').hidden = true;

  if (r?.error === 'not-configured') {
    $('state').replaceChildren(
      'Connector set nahi hai. ',
      el('button', { className: 'link', textContent: 'Settings kholein', onclick: () => chrome.runtime.openOptionsPage() })
    );
    return;
  }
  if (r?.error) {
    $('state').textContent = `Connector se rabta nahi hua: ${r.error}`;
    $('state').className = 'err small';
    return;
  }
  $('state').className = 'muted small';
  $('state').textContent = r.items.length ? `${r.items.length} items` : 'Abhi kuch nahi. Claude se baat karein, yahan dikhega.';

  if (r.handoff && !$('q').value.trim()) {
    $('handoff').hidden = false;
    $('handoff').replaceChildren(el('h2', { textContent: 'Aakhri handoff' }), entry({ ...r.handoff, kind: 'handoff' }));
  }
  $('list').append(...r.items.filter((i) => !(r.handoff && i.id === r.handoff.id)).map(entry));
}

let debounce;
$('q').addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(load, 300);
});
$('refresh').addEventListener('click', load);
chrome.storage.onChanged.addListener((changes) => {
  if (changes['twin.sessions'] || changes['twin.config']) load();
});

load();
