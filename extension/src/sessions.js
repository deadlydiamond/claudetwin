// Keeps one saved claude.ai login per account and swaps them in the browser's
// cookie jar. Logging in still happens on claude.ai itself, in a real Chrome tab,
// so "Continue with Google" works; this module only remembers the result.
//
// Saved cookies live in chrome.storage.local on this machine and never leave it.

export const DOMAIN = 'claude.ai';
const KEY = 'twin.sessions';

const cookieUrl = (c) => `https://${c.domain.replace(/^\./, '')}${c.path || '/'}`;

// Only the fields chrome.cookies.set accepts.
function toSetDetails(c) {
  const d = {
    url: cookieUrl(c),
    name: c.name,
    value: c.value,
    path: c.path || '/',
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
  };
  if (!c.hostOnly) d.domain = c.domain;
  if (c.sameSite) d.sameSite = c.sameSite;
  if (!c.session && c.expirationDate) d.expirationDate = c.expirationDate;
  if (c.storeId) d.storeId = c.storeId;
  return d;
}

export function createSessions({ cookies, storage }) {
  async function load() {
    const { [KEY]: data } = await storage.get(KEY);
    return data || { active: null, slots: {} };
  }
  const save = (data) => storage.set({ [KEY]: data });

  const snapshot = () => cookies.getAll({ domain: DOMAIN });

  async function clearJar() {
    for (const c of await snapshot()) {
      await cookies.remove({ url: cookieUrl(c), name: c.name, ...(c.storeId ? { storeId: c.storeId } : {}) });
    }
  }

  async function restore(saved) {
    for (const c of saved) {
      try {
        await cookies.set(toSetDetails(c));
      } catch {
        /* an expired or rejected cookie: the account just needs a fresh login */
      }
    }
  }

  const hasLogin = (list) => (list || []).some((c) => c.name === 'sessionKey' && c.value);

  return {
    async getActive() {
      return (await load()).active;
    },

    async setActive(id) {
      const data = await load();
      data.active = id;
      await save(data);
    },

    async status() {
      const data = await load();
      const saved = {};
      for (const id of ['work', 'personal']) saved[id] = hasLogin(data.slots[id]);
      return { active: data.active, saved };
    },

    // Save the live login under the active account, then load the target's.
    async switchTo(id) {
      const data = await load();
      if (data.active === id) return { changed: false, loggedIn: hasLogin(await snapshot()) };

      if (data.active) data.slots[data.active] = await snapshot();
      await clearJar();
      await restore(data.slots[id] || []);
      data.active = id;
      await save(data);
      return { changed: true, loggedIn: hasLogin(data.slots[id]) };
    },

    // Drop a saved login, e.g. when the user wants to sign in to that slot again.
    async forget(id) {
      const data = await load();
      delete data.slots[id];
      if (data.active === id) await clearJar();
      await save(data);
    },
  };
}
