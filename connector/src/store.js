// Tiny file store. Good for one person's two accounts; no native deps.
// Handoffs live in claudetwin.json; messages in log.jsonl, appended one line each,
// so a full history import (tens of thousands of messages) stays cheap to write.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_HANDOFFS = 500;

// Same message from the live hook and from a history import → same key, stored once.
const dedupKey = (l) =>
  crypto.createHash('sha1').update(`${l.space}\n${l.chatUrl}\n${l.role}\n${l.text}`).digest('base64url');

export class Store {
  constructor(dir) {
    this.file = path.join(dir, 'claudetwin.json');
    this.logFile = path.join(dir, 'log.jsonl');
    fs.mkdirSync(dir, { recursive: true });
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.data = {};
    }
    this.data.handoffs ??= [];
    this.log = [];
    this.keys = new Set();
    try {
      for (const line of fs.readFileSync(this.logFile, 'utf8').split('\n')) {
        if (!line) continue;
        try {
          this.#remember(JSON.parse(line));
        } catch {
          /* torn last line: skip */
        }
      }
    } catch {
      /* no log yet */
    }
    // Older versions kept the log inside claudetwin.json: move it to log.jsonl once.
    if (Array.isArray(this.data.log)) {
      const fresh = this.data.log.filter((l) => this.#remember(l));
      if (fresh.length) fs.appendFileSync(this.logFile, fresh.map((l) => JSON.stringify(l) + '\n').join(''));
      delete this.data.log;
      this.#save();
    }
    this.sorted = false;
  }

  #save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  #remember(entry) {
    const key = dedupKey(entry);
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    this.log.push(entry);
    this.sorted = false;
    return true;
  }

  #byTime() {
    if (!this.sorted) {
      this.log.sort((a, b) => a.at.localeCompare(b.at));
      this.sorted = true;
    }
    return this.log;
  }

  addHandoff({ space, title, summary, nextSteps = [], context = '', chatUrl = '' }) {
    const h = {
      id: crypto.randomUUID(),
      space,
      title: title.trim(),
      summary: summary.trim(),
      nextSteps,
      context: context.trim(),
      chatUrl,
      at: new Date().toISOString(),
    };
    this.data.handoffs.push(h);
    if (this.data.handoffs.length > MAX_HANDOFFS) this.data.handoffs.splice(0, this.data.handoffs.length - MAX_HANDOFFS);
    this.#save();
    return h;
  }

  #entry({ space, role, text, chatUrl = '', chatTitle = '', at }) {
    const when = at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : new Date().toISOString();
    return { id: crypto.randomUUID(), space, role, text: String(text).slice(0, 20000), chatUrl, chatTitle, at: when };
  }

  addLog(fields) {
    const entry = this.#entry(fields);
    if (this.#remember(entry)) fs.appendFileSync(this.logFile, JSON.stringify(entry) + '\n');
    return entry;
  }

  // Bulk import of past messages; ones already stored are skipped.
  importLogs(space, entries) {
    const fresh = [];
    for (const e of entries) {
      if (!['user', 'assistant'].includes(e?.role) || !e.text) continue;
      const entry = this.#entry({ ...e, space });
      if (this.#remember(entry)) fresh.push(entry);
    }
    if (fresh.length) fs.appendFileSync(this.logFile, fresh.map((l) => JSON.stringify(l) + '\n').join(''));
    return { added: fresh.length, skipped: entries.length - fresh.length };
  }

  stats(canSee) {
    const bySpace = {};
    let oldest;
    for (const l of this.log) {
      if (!canSee(l.space)) continue;
      bySpace[l.space] = (bySpace[l.space] || 0) + 1;
      if (!oldest || l.at < oldest) oldest = l.at;
    }
    return { messages: bySpace, handoffs: this.data.handoffs.filter((h) => canSee(h.space)).length, oldest };
  }

  latestHandoff(canSee) {
    for (let i = this.data.handoffs.length - 1; i >= 0; i--) {
      if (canSee(this.data.handoffs[i].space)) return this.data.handoffs[i];
    }
    return null;
  }

  recent(canSee, limit = 20) {
    const log = this.#byTime();
    const messages = [];
    for (let i = log.length - 1; i >= 0 && messages.length < limit; i--) {
      if (canSee(log[i].space)) messages.push({ kind: 'message', ...log[i] });
    }
    const items = [...this.data.handoffs.filter((h) => canSee(h.space)).map((h) => ({ kind: 'handoff', ...h })), ...messages];
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }

  // Handoffs alone, newest first, for clients that keep no message log (TwinBridge).
  recentHandoffs(canSee, limit = 20) {
    return this.data.handoffs
      .filter((h) => canSee(h.space))
      .map((h) => ({ kind: 'handoff', ...h }))
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit);
  }

  searchHandoffs(canSee, query, limit = 10) {
    return this.search(canSee, query, Number.MAX_SAFE_INTEGER)
      .filter((i) => i.kind === 'handoff')
      .slice(0, limit);
  }

  search(canSee, query, limit = 10) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return this.recent(canSee, limit);
    const score = (text) => {
      const t = text.toLowerCase();
      let s = 0;
      for (const term of terms) if (t.includes(term)) s += 1;
      return s;
    };
    const items = [];
    for (const h of this.data.handoffs) {
      if (!canSee(h.space)) continue;
      const s = score(`${h.title} ${h.summary} ${h.nextSteps.join(' ')} ${h.context}`);
      if (s) items.push({ kind: 'handoff', score: s + 0.5, ...h });
    }
    for (const l of this.log) {
      if (!canSee(l.space)) continue;
      const s = score(`${l.chatTitle} ${l.text}`);
      if (s) items.push({ kind: 'message', score: s, ...l });
    }
    return items.sort((a, b) => b.score - a.score || b.at.localeCompare(a.at)).slice(0, limit);
  }
}
