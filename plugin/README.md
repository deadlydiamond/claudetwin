# ClaudeTwin plugin

One memory for your two Claude accounts (work and personal). The plugin connects Claude Code to a **ClaudeTwin connector that you run yourself**, adds a `/twin` panel, and installs three hooks. Setup and the connector are described in the [repository README](https://github.com/deadlydiamond/claudetwin#readme).

This page says exactly what the plugin reads, what it sends and where, what it runs, and what it types into your chat. Nothing else is read, sent or run.

## Where data goes

There is one destination: **the connector URL you enter in the plugin's settings** (`connector_url`). It is your own server, for example `http://localhost:8787` or a host you deploy. The plugin has no built-in server address, no analytics and no third-party endpoints.

If `connector_url` or `account_token` is empty, the plugin falls back to the connector's own `.env` file on this machine (the optional `env_file` setting, default `~/Projects/claudetwin/connector/.env`). It reads `PORT`, `CLAUDETWIN_WORK_TOKEN` and `CLAUDETWIN_PERSONAL_TOKEN`, and uses `http://localhost:<PORT>`.

Every request carries this account's token as `Authorization: Bearer <token>`.

## What the `/twin` panel (hooks/register.tsx) does

### Network requests

All of them are `GET`s to your connector, read only:

| Request | Why |
|---|---|
| `GET {connector_url}/api/whoami` | Which account this token belongs to |
| `GET {connector_url}/api/handoff` | The latest handoff, shown in the panel |
| `GET {connector_url}/api/history?limit=200` | Recent prompts and replies from both accounts |
| `GET {connector_url}/api/history?limit=30&q=<your search>` | When you type in the panel's search box |
| `GET {connector_url}/api/stats` | How many items the memory holds |

### Local files it reads

- `~/.claude.json` (work profile) and `~/.claude-personal/.claude.json` (personal profile). Only `oauthAccount.emailAddress` and `oauthAccount.organizationType` are read, to show whether each account is signed in and on which plan. **These values are shown in the panel only and are never sent anywhere.**
- The connector `.env` described above, only when the settings are empty.
- File existence checks: where the `claude` and `node` binaries are, and whether `~/.claude/projects` exists.

### Commands it runs

There are exactly three, all with fixed arguments, and all start only when you press a button in the panel:

1. **Log in** (only when you press *Log in* for an account that is signed out):
   `/usr/bin/env CLAUDE_CONFIG_DIR=$HOME/.claude-personal claude auth login` for the personal profile, or `/usr/bin/env -u CLAUDE_CONFIG_DIR claude auth login` for the work profile. This is Claude Code's own sign-in. The plugin reads the command's output only to show the sign-in link it prints.
2. **Sync history** (on first run, then to catch up):
   `node <plugin>/scripts/sync-history.mjs <connector_url> <token> <profile_dir>`. See *Sync* below for what it sends.
3. **Switch to Company / Personal** (only when you press *Switch to ...*, after the sync check):
   `/usr/bin/osascript -e 'tell application "Terminal" to do script "claude-personal"' -e 'tell application "Terminal" to activate'` (or `claude-work`). It opens the other account's Claude Code in a new Terminal window. The command name is one of those two fixed values; nothing from the connector is placed in it.

The plugin does not run any other command, shell, agent or tool. It does not run anything it receives from the connector.

### Prompts it submits

Two buttons type a fixed sentence into your current chat. Nothing from the connector or your files is added to them:

- **Continue here**: "Continue the latest ClaudeTwin handoff: load it with claudetwin get_handoff (and list_recent if useful), then carry on with the next steps."
- **Save handoff**: "Save a ClaudeTwin handoff now with claudetwin save_handoff: what was asked, what is done, key decisions, and concrete next steps, written for someone with no access to this chat."

Claude then uses the plugin's MCP tools (below) to read or save the handoff.

## Hooks (hooks/hooks.json)

| Hook | Script | Sends to your connector |
|---|---|---|
| `SessionStart` | `scripts/session-start.mjs` | Nothing. It reads `GET /api/handoff` and `GET /api/history?limit=12` and adds them to Claude's context |
| `UserPromptSubmit` | `scripts/log-turn.mjs prompt` | `POST /api/log` with the prompt you typed, the session id, and the session title (or the project folder name when there is none) |
| `Stop` | `scripts/log-turn.mjs reply` | `POST /api/log` with Claude's last text reply from that turn |

Tool calls, tool results and file contents are not logged. Only the text you type and Claude's final text reply.

## Sync (scripts/sync-history.mjs)

It reads your past Claude Code transcripts in `<profile>/projects/*.jsonl` and sends `POST {connector_url}/api/import` in batches. It sends each turn's typed prompt and Claude's final text reply, with the session id, project folder name and time, which is the same as the live hooks. It keeps a list of already-sent files in `<profile>/claudetwin-sync.json`, so later runs send only new sessions. Run it with `--dry-run` to see what it would send without sending.

## MCP server (.mcp.json)

`{connector_url}/mcp/{account_token}` (HTTP), with the tools `save_handoff`, `get_handoff`, `search_history` and `list_recent`. They run on your connector, not on this machine.

## Turning it off

Disable the plugin. Or leave `connector_url` and `account_token` empty: the hooks then send nothing, and the panel makes no request unless a connector `.env` file exists at `env_file`. To delete what was stored, delete the connector's data folder on your server.

## Before syncing a work account

Your work account's policies still apply. Check them before you send work history to a connector outside your company.
