<p align="center"><img src="plugin/assets/banner.svg" alt="ClaudeTwin by Omer Bin Saleem: one memory for your two Claude accounts" width="720"></p>

# ClaudeTwin

**One memory for your two Claude accounts.**

Many people run two Claude accounts: one from work, one of their own. Each account remembers only its own chats, so moving between them means copying context by hand, re-explaining the task, and losing the decisions you already made.

ClaudeTwin gives both accounts one shared memory. You save a handoff in one account and continue in the other from the same point. Every prompt and reply from both accounts is searchable from either. A `/twin` panel in Claude Code shows both sign-ins, the latest handoff, and your full history in one place.

By Omer Bin Saleem. MIT licensed.

## Use cases

**Office to home, same task.** You spend the afternoon on a migration in your work account. In the evening you open your personal account, press **Continue here** in `/twin`, and Claude loads the handoff: what was asked, what is done, the decisions behind it, and the next three steps. No re-explaining.

**"What did we decide about that?"** Weeks later you remember a fix but not which account it was in. Search from either account and get the prompt, the reply, the account and the date.

**One project, two contexts.** A side project you also discuss at work, or a work tool you prototype at home. Both accounts read the same notes, so neither starts from zero.

**Start with your whole history.** Installing the plugin imports every past Claude Code session from both profiles, not only what happens after install. On a machine with about 4,000 sessions the first sync takes around 30 seconds; later syncs read only new sessions and take under a second.

**Switch in three steps, anywhere.** Type `/logout`, then `/login` with the other account, then `continue`. Works the same in the terminal, Cursor, VS Code and the desktop app, with as many accounts as you like. Nothing to copy or sync: every message is already in the shared memory.

What ClaudeTwin is not: it does not share a login, merge accounts, or move between them for you. You choose which account to use. Your work account's policies still apply to what you put in it, so check them before you sync work history to a connector outside your company.

## How it works

```
 Work account                       Personal account
 (Claude Code, claude.ai)           (Claude Code, claude.ai)
        │  prompts, replies,                 │
        │  handoffs                          │
        ▼                                    ▼
   ┌──────────────── ClaudeTwin connector ────────────────┐
   │  save_handoff · get_handoff · search_history · recent │
   │  your own server: localhost, or a host you deploy     │
   └───────────────────────────────────────────────────────┘
```

- **Connector** (`connector/`): a small MCP and REST server you run yourself. Each account has its own token, so the connector knows who wrote what. Data stays in one folder on that server.
- **Plugin** (`plugin/`): connects Claude Code to the connector, adds the `/twin` panel, and installs hooks:
  - at session start, the latest handoff and recent activity from both accounts are added to Claude's context;
  - each prompt and Claude's final reply are logged to the connector;
  - past sessions are imported once, then kept in sync.
- **Skill** (`claudetwin`): tells Claude when to save a handoff and how to pick one up.

## Install

### 1. Run the connector

```bash
git clone https://github.com/deadlydiamond/claudetwin
cd claudetwin/connector
npm install
cp .env.example .env
```

Fill both tokens in `.env`. Generate each one with:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Then start it:

```bash
node --env-file=.env src/server.js
```

`http://localhost:8787/health` should answer `{"ok":true}`. That is enough when both accounts use Claude Code on the same computer. To reach it from another machine or from claude.ai, deploy `connector/Dockerfile` (Render, Railway, Fly.io) with a persistent volume on `/data` and both tokens set as environment variables.

### 2. Install the plugin in each account

At the prompt of a Claude Code session:

```
/plugin install claudetwin --marketplace deadlydiamond/claudetwin
```

Press `y` to add the marketplace, then pick a scope. From a shell:

```bash
claude plugin install claudetwin --marketplace deadlydiamond/claudetwin
```

When asked, set:

- **connector_url**: `http://localhost:8787`, or your deployed URL (no trailing slash)
- **account_token**: the work token in your work account, the personal token in your personal one

### Switch accounts

1. Type `/logout` in your Claude Code chat.
2. Type `/login` and sign in with the other account.
3. Type `continue`. Claude loads the shared memory and picks up where you stopped.

The plugin and its token stay installed across logins, so there are no extra profiles to set up.

### 3. Open the panel

Type `/twin`. You will see:

| Section | What it shows |
|---|---|
| Account | The account signed in here, email and plan, and **Switch account** with the three steps |
| Memory | Message and handoff counts, how far back the history goes, sync progress, **Sync all history** and **Refresh** |
| Latest handoff | Title, summary and next steps, with **Continue here** and **Save handoff** |
| History | Search across both accounts, or the most recent items |

### Optional: claude.ai and the Claude desktop chat

- **claude.ai**: Settings, Connectors, Add custom connector, with `https://<host>/mcp/<ACCOUNT_TOKEN>`. Each account uses its own token. Team and Enterprise plans may need an admin to allow custom connectors.
- **Claude desktop chat**: it can run a local MCP server, so no public URL is needed. Point `claude_desktop_config.json` at `connector/src/bridge.js` with `CLAUDETWIN_URL` and `CLAUDETWIN_TOKEN` in its `env`, using the full path from `which node`.

## Privacy

- Everything is stored on the connector you run. Nothing goes to a third party.
- Synced history is your prompts and Claude's final reply for each turn. Tool calls, tool output and subagent transcripts are not sent.
- Tokens live in the plugin's settings (stored as sensitive) or in the connector's `.env`. A connector URL that contains a token gives access to that memory, so keep it private.
- `CLAUDETWIN_MODE=isolated` keeps each account to its own history, plus items saved with `visibility: "shared"`.

## Tools

| Tool | What it does |
|---|---|
| `save_handoff` | Save where the work stands: title, summary, next steps, context |
| `get_handoff` | Load the latest handoff, usually from the other account |
| `search_history` | Search handoffs and messages from both accounts |
| `list_recent` | The most recent handoffs and messages |

Sync from a terminal at any time:

```bash
node plugin/scripts/sync-history.mjs http://localhost:8787 <TOKEN> ~/.claude
```

## Development

```bash
cd connector && npm test          # connector: MCP, REST, import, dedup
claude plugin test plugin         # /twin panel on terminal and desktop
claude plugin validate .          # marketplace, manifest and hooks
```

The repository also holds two earlier experiments, a Chrome extension (`extension/`) and an Electron app (`app/`). They are not part of the plugin. Their notes are in [docs/README-roman-urdu.md](docs/README-roman-urdu.md).

## License

MIT, see [LICENSE](LICENSE). Made by [Omer Bin Saleem](https://github.com/deadlydiamond).
