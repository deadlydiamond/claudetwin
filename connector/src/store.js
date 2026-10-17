// Tiny JSON-file store. Good for one person's two accounts; no native deps.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_LOG = 5000;
const MAX_HANDOFFS = 500;

export class Store {
  constructor(dir) {
    this.file = path.join(dir, 'claudetwin.json');
    fs.mkdirSync(dir, { recursive: true });
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.data = {};
    }
    this.data.handoffs ??= [];
    this.data.log ??= [];
  }

  #save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
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

  addLog({ space, role, text, chatUrl = '', chatTitle = '' }) {
    const entry = {
      id: crypto.randomUUID(),
      space,
      role,
      text: String(text).slice(0, 20000),
      chatUrl,
      chatTitle,
      at: new Date().toISOString(),
    };
    this.data.log.push(entry);
    if (this.data.log.length > MAX_LOG) this.data.log.splice(0, this.data.log.length - MAX_LOG);
    this.#save();
    return entry;
  }

  latestHandoff(canSee) {
    for (let i = this.data.handoffs.length - 1; i >= 0; i--) {
      if (canSee(this.data.handoffs[i].space)) return this.data.handoffs[i];
    }
    return null;
  }

  recent(canSee, limit = 20) {
    const items = [
      ...this.data.handoffs.filter((h) => canSee(h.space)).map((h) => ({ kind: 'handoff', ...h })),
      ...this.data.log.filter((l) => canSee(l.space)).map((l) => ({ kind: 'message', ...l })),
    ];
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
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
    for (const l of this.data.log) {
      if (!canSee(l.space)) continue;
      const s = score(`${l.chatTitle} ${l.text}`);
      if (s) items.push({ kind: 'message', score: s, ...l });
    }
    return items.sort((a, b) => b.score - a.score || b.at.localeCompare(a.at)).slice(0, limit);
  }
}
