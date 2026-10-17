---
name: claudetwin
description: Use with the ClaudeTwin connector when the user works across two Claude accounts. Load context at the start of a resumed task, and save a handoff at milestones so the other account can continue.
---

# ClaudeTwin

The user runs two Claude accounts (usually Company and Personal) that share one memory through the **claudetwin** connector. They move between them during the day, for example finishing at home what they started at the office. Your job is to make picking the work up in the other account easy.

## When a session starts or resumes

Call `get_handoff` first, before answering, if any of these are true:
- The message starts with `[ClaudeTwin]` (the app inserted it after a switch).
- The user says continue, resume, wahin se, jahan chora tha, twin, or refers to work you can't see in this chat.

Then call `list_recent` if the handoff is missing, old, or doesn't cover what the user is asking about. Read both, then carry on with the task directly. Don't recap the handoff back to the user beyond one line ("Workflow builder ke edge wiring se continue kar raha hun").

Use `search_history` when the user mentions something from "the other account" or an earlier chat that isn't in the handoff.

## When to save a handoff

Save while the context is fresh, so the other account starts from where this one stopped. Call `save_handoff`:
- After each meaningful milestone in multi-step work (a feature done, a decision made, a draft finished).
- Before a long answer or a large code change in a session that already has several turns.
- Whenever the user says handoff, save, twin, or that they are about to switch.

Don't save for one-off questions, small talk, or a task finished in a single reply.

## Writing a good handoff

Write it for someone who has never seen this chat:
- **title**: the task in a few words.
- **summary**: what was asked, what is done, key decisions and why, anything that failed. Include names, numbers, file paths.
- **next_steps**: concrete actions in order.
- **context**: the code, snippets, or data the next session needs to continue without asking again. Prefer exact text over description.

Keep it under about 800 words. Update by saving a new one; the newest wins.

## Company vs personal

If the connector runs in isolated mode, handoffs stay within the account that saved them. Use `visibility: "shared"` only when the user explicitly wants that item visible in the other account. Never move company code, client data, or credentials into a shared handoff unless the user asks for it.
