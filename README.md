# progress-bar

A Claude Code mod that draws progress bars above the prompt for long-running work: a model download, a test suite, any script running in the background. You see percent, amount, rate and time left without asking the agent "is it done yet?".

```
model.gguf ██████████████░░░░░░░░░░░░░░░░ 47% 10.8 GB / 22.9 GB · 85 MB/s · 2 min left
test suite ██████████░░░░░░░░░░░░░░░░░░░░ 3 / 9 step · 12 min left
● Research coding models · running · 4 min 12 s · 23 tool calls
✓ Write final report · done · 6 min 40 s · 41 tool calls
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

Add `"pid"` (the writer's process id; on Windows the Windows PID) and the bar also disappears once that process is gone, so a killed script does not leave a stale bar. The mod checks it with `tasklist` on Windows and `ps -p` elsewhere; if the check itself fails, the bar stays.

## Language

Bar text is English by default. Switch it at any time with:

```
/progress-bar pl
/progress-bar en
```

The choice is remembered across sessions. The `language` option in the plugin's settings sets the starting value.

Rate and time left are averaged from the first reading the mod saw. Git Bash paths such as `/c/models/x` are translated to `C:/models/x`.

## Subagents and teammates

Below the bars, every subagent or teammate the session runs gets a row: its description, state (running, waiting, done, failed), time since the mod first saw it and the number of tool calls it has made. Agents report no percentage, so the call count is the progress signal. A finished agent stays for 10 seconds with ✓ or ✗, then disappears. Agents that were already finished when the mod loaded are not shown.

## Reporting progress from a script

```bash
PF=$HOME/.claude/progress/my-task.json; mkdir -p "$(dirname "$PF")"
trap 'rm -f "$PF"' EXIT
PID=$(cat /proc/$$/winpid 2>/dev/null || echo $$)   # Git Bash on Windows: the Windows PID
step() { echo "{\"label\": \"my task: $2\", \"done\": $1, \"total\": 5, \"unit\": \"step\", \"pid\": $PID}" > "$PF"; }
step 0 "start"
# ... work ...
step 1 "build"
```

Tip: tell Claude in your `CLAUDE.md` to write a progress file whenever it starts a long download or background job.

## License

MIT
