# progress-bar

A Claude Code mod that draws progress bars above the prompt for long-running work: a model download, a test suite, any script running in the background. You see percent, amount, rate and time left without asking the agent "is it done yet?".

```
model.gguf ██████████████░░░░░░░░░░░░░░░░ 47% 10.8 GB / 22.9 GB · 85 MB/s · 2 min left
test suite ██████████░░░░░░░░░░░░░░░░░░░░ 3 / 9 step · 12 min left
```

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install progress-bar --marketplace piotrmarekc/claude-progress-bar
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install progress-bar --marketplace piotrmarekc/claude-progress-bar
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `piotrmarekc/claude-progress-bar`, then Add plugin.

## How it works

Every 2 seconds the mod reads `~/.claude/progress/*.json`. Each file is one bar, in one of two shapes:

**Files** (downloads): progress is the summed size of the listed files.

```json
{ "label": "model.gguf", "total": 22863084160, "files": ["C:/models/part0", "C:/models/part1"] }
```

**Counter** (scripts): the script rewrites `done` as it goes.

```json
{ "label": "test suite", "done": 3, "total": 9, "unit": "step" }
```

A bar disappears when `done` reaches `total`, when none of the listed files exists, or when the JSON file is deleted. Delete the file when the task ends.

Rate and time left are averaged from the first reading the mod saw. Git Bash paths such as `/c/models/x` are translated to `C:/models/x`.

## Reporting progress from a script

```bash
PF=$HOME/.claude/progress/my-task.json; mkdir -p "$(dirname "$PF")"
trap 'rm -f "$PF"' EXIT
step() { echo "{\"label\": \"my task: $2\", \"done\": $1, \"total\": 5, \"unit\": \"step\"}" > "$PF"; }
step 0 "start"
# ... work ...
step 1 "build"
```

Tip: tell Claude in your `CLAUDE.md` to write a progress file whenever it starts a long download or background job.

## License

MIT
