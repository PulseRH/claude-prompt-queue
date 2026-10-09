# claude-prompt-queue

A Claude Code mod that lets you queue prompts in a card grid above the input box and send each one later with a button, so you don't have to write prompts in another app and paste them in.

## Install

```
/plugin marketplace add PulseRH/claude-prompt-queue
/plugin install prompt-queue@pulserh-plugins
/reload-plugins
```

Then type `/queue` to show or hide it.

## What it does

- **Queue** prompts in a 1, 2 or 3 column grid of cards (`▥`), or move it to a side window (`◨`).
- **Per card:** `⇈` to top, `↑` `↓` reorder (the moved card lights up), `✎` edit, `➤` send now, `✕` delete. Buttons appear on hover (`◉` turns that off).
- **Auto-send** (`⚡`): after each finished reply it counts down (3-30 s, visibly) and sends the first queued prompt. Pick how many to send before it switches itself off (1-10 or no limit). Cancel during the countdown stops it.
- **The input expands** to the full row while you are typing in it, and the buttons come back when focus leaves.
- Card color (`◐`), band height (`⤢`), paging (`‹ ›`), tooltips on every button.
- **Each conversation has its own queue**, saved between sessions (keyed by session id). Display settings and auto-send reset each session.

Built for the desktop Code tab; it also validates on the terminal surface.

## Develop

```
claude plugin validate plugins/prompt-queue
claude plugin test plugins/prompt-queue
```

## License

MIT
