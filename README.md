<p align="center"><img src="plugin/assets/banner.svg" alt="ClaudeTwin by Omer Bin Saleem: one memory for all your Claude accounts" width="720"></p>

# ClaudeTwin

**One memory for your company and personal Claude accounts.**

ClaudeTwin is a Claude Code plugin plus a small server you run yourself. Every prompt and final reply from each account is saved to that server, so you can search it, and hand a task from one account to the other, from either account.

**Who it is for:** people who use two or more Claude accounts, for example one for work and one of their own, or a backup plan for the days the main one hits its limit.

**Why not the alternatives:**

- *Copying files or pasting context* means re-explaining the task each time and losing the decisions. Here, a handoff carries what was asked, what is done, why, and the next steps.
- *Staying on one account* is not always possible: a work account has its own rules, and a plan has limits.
- *Account switchers* swap login tokens. ClaudeTwin leaves your login alone: you use the normal `/logout` and `/login`.
- *Hosted memory services* keep your history on their servers. ClaudeTwin keeps it in one folder on a machine you control.

**First command** (full steps in [Install](#install)):

```bash
git clone https://github.com/deadlydiamond/claudetwin && cd claudetwin/connector && npm install
```

MIT licensed.

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

- **Connector** (`connector/`): a small MCP and REST server. Each account has its own token, so it knows who wrote what. Data stays in one folder (`DATA_DIR`).
- **Plugin** (`plugin/`): connects Claude Code to the connector, adds a `/twin` panel, and installs three hooks. At session start it adds the latest handoff and recent activity from all your accounts to Claude's context. Each prompt and Claude's final reply are logged to the connector. Past Claude Code sessions on the computer are imported once, then kept in sync.
- **Skill** (`claudetwin`): tells Claude when to save a handoff and how to pick one up.

## Use cases

- **Office to home, same task.** Open your personal account, press **Continue here** in `/twin`, and Claude loads the handoff instead of you re-explaining.
- **"What did we decide about that?"** Search from either account and get the prompt, the reply, the account and the date.
- **One project, two contexts.** Both accounts read the same notes, so neither starts from zero.
- **Hit a limit mid-task.** Switch accounts and carry on with context.

What it is not: it does not share a login, merge accounts or their limits, or switch for you. If an account belongs to an employer, their policies still apply to what you sync to a connector outside the company.

## Install

You need Node 20.6 or newer (the connector declares `>=20`, and the start command below uses `--env-file`) and Claude Code.

### 1. Run the connector

```bash
git clone https://github.com/deadlydiamond/claudetwin
cd claudetwin/connector
npm install
cp .env.example .env
```

Put two different random tokens in `.env` as `CLAUDETWIN_WORK_TOKEN` and `CLAUDETWIN_PERSONAL_TOKEN`. The connector will not start without them. Generate each with:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Start it:

```bash
node --env-file=.env src/server.js
```

`http://localhost:8787/health` answers `{"ok":true,"mode":"shared"}`. That is enough when all your accounts use Claude Code on the same computer. To reach it from another machine or from claude.ai, build `connector/Dockerfile` on a host you control, with a persistent volume on `/data` and the tokens set as environment variables.

### 2. Install the plugin in each account

```bash
claude plugin marketplace add deadlydiamond/claudetwin
claude plugin install claudetwin@claudetwin
```

When asked, set:

- **connector_url**: `http://localhost:8787`, or your deployed URL (no trailing slash)
- **account_token**: the work token in your work account, the personal token in your personal one

### 3. Switch accounts and open the panel

1. Type `/logout`, then `/login` with the other account.
2. Type `continue`. Claude loads the shared memory and picks up where you stopped.
3. Type `/twin` for the panel: the signed-in account, memory counts and sync, the latest handoff with **Continue here** and **Save handoff**, and a search over all your history.

### Optional: claude.ai and Claude desktop chat

- **claude.ai**: Settings, Connectors, Add custom connector, with `https://<host>/mcp/<ACCOUNT_TOKEN>`. Each account uses its own token. Team and Enterprise plans may need an admin to allow custom connectors.
- **Claude desktop chat**: point `claude_desktop_config.json` at `connector/src/bridge.js` with `CLAUDETWIN_URL` and `CLAUDETWIN_TOKEN` in its `env`, using the full path from `which node`.

## Privacy

- Everything is stored on the connector you run. Nothing goes to a third party.
- Synced history is your prompts and Claude's final reply for each turn. Tool calls, tool output and subagent transcripts are not sent.
- Tokens live in the plugin's settings (stored as sensitive) or in the connector's `.env`. A connector URL that contains a token gives access to that memory, so keep it private.
- `CLAUDETWIN_MODE=isolated` keeps each account to its own history, plus items saved with `visibility: "shared"`.
- The connector keeps the most recent 500 handoffs.

## Tools

| Tool | What it does |
|---|---|
| `save_handoff` | Save where the work stands: title, summary, next steps, context |
| `get_handoff` | Load the latest handoff, usually from the other account |
| `search_history` | Search handoffs and messages from all your accounts |
| `list_recent` | The most recent handoffs and messages |

Import past sessions from a terminal at any time (`--dry-run` shows what would be sent):

```bash
node plugin/scripts/sync-history.mjs http://localhost:8787 <TOKEN> ~/.claude
```

## Claude plugin directory edition

The plugin directory does not allow plugins that log conversation history, so a handoffs-only edition of ClaudeTwin, [TwinBridge](https://github.com/deadlydiamond/twinbridge), is listed there. It uses this same connector and saves nothing unless you ask.

## Development

```bash
cd connector && npm test          # connector: MCP, REST, import, dedup
claude plugin validate .          # marketplace, manifest and hooks
```

The repository also holds two earlier experiments, a Chrome extension (`extension/`) and an Electron app (`app/`), which are not part of the plugin. Their notes are in [docs/README-roman-urdu.md](docs/README-roman-urdu.md).

## License

MIT, see [LICENSE](LICENSE).

## Author

[Omer Bin Saleem](https://www.omerbinsaleem.com/), one hack a day.
