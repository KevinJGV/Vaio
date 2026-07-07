# omo-agentic-dev-system - Work Plan

## TL;DR (For humans)

**What you'll get:** OMO becomes your personal agentic dev framework — every project inherits Claude's hard-won discipline (invariantes, session-start ritual, typecheck+secrets hard-enforcement with project-hook dedup, WIP reconciliation, two-altitude plans, Iron Laws) without copying config per repo. Vaio gets a one-time seed of its accumulated state + gotchas into OMO's namespace.

**Why this approach:** Equilibrium, OMO-weighted — OMO's structure (scaffold, approval gate, Metis, agent taxonomy, review-work) is the backbone; Claude's prescriptive framing (Iron Laws, hard-gates) is adopted in-place as global invariantes. Two namespaces coexist (Claude→docs/, OMO→.omo/) so both tools work on Vaio without collision.

**What it will NOT do:** It won't port superpowers wholesale, won't modify oh-my-openagent package internals, won't remove Claude's workflow from Vaio, won't migrate existing docs, won't add new MCPs.

**Effort:** Medium
**Risk:** Low - all changes are config/docs/bash, reversible, no product code touched
**Decisions to sanity-check:** Iron Laws as invariantes (not skill shadows); OMO hooks in ~/.claude/settings.json coexisting with Claude's; .omo/ seed (not migration) from docs/

Your next move: approve this plan, then `/start-work` to execute. Full execution detail follows below.

---

> TL;DR (machine): Medium effort, Low risk. 9 todos in 3 waves. Global OMO invariantes + ritual skill (with YAML frontmatter) + hooks plugin + two-altitude blocking + staleness guard + Vaio project-level seed. All config/docs/bash, no product code.

## Scope
### Must have
- Global `~/.config/opencode/AGENTS.md`: Invariantes block (Claude's 10 universalized + Iron Laws #11-13: no production code without failing test first; no completion claims without fresh verification evidence; no fixes without root cause first). Numbered as "1. " through "13. " (not "(1)").
- Global `~/.config/opencode/skills/omo-ritual/SKILL.md`: session-start ritual skill WITH YAML frontmatter (`---\nname: omo-ritual\ndescription: ...\nmetadata: {author, version, argument-hint}\n---`) — required for oh-my-openagent skill discovery. Content: read .omo/state.md → .omo/learnings.md → git status/log → read feature's .omo/plans/<slug>.md AND .omo/plans/<slug>-design.md (BOTH files, always — two-altitude rule); WIP reconciliation gate before pivot; anti-drift rule; staleness check (if docs/NEXT-STEPS.md mtime > .omo/state.md mtime, warn to reconcile).
- Global `~/.config/opencode/opencode.json`: add `opencode-hooks-api` to plugins array.
- Global `~/.claude/settings.json`: OMO-native hooks config (SessionStart→omo-session-start.sh [auto-fires in plugin], PostToolUse Edit|Write .ts→typecheck.sh [with project-hook dedup guard], PreToolUse Bash git*→secrets-guard.sh [with project-hook dedup guard], UserPromptSubmit→omo-wip-reconcile.sh [slash /hook-prompt only, not auto-fired], PreToolUse start-work→omo-two-altitude-guard.sh [blocking: exit 2 if -design.md missing]). Hooks idempotent + tolerant of missing files (exit 0 if .omo/state.md doesn't exist). Hook scripts handle BOTH stdin and arg input (`INPUT="${1:-}"; [ -z "$INPUT" ] && INPUT="$(cat)"`).
- Global `~/.config/opencode/hooks/`: 6 OMO-native hook scripts (typecheck.sh, secrets-guard.sh, omo-session-start.sh, omo-wip-reconcile.sh, omo-plan-after-exit.sh, omo-two-altitude-guard.sh). All `#!/usr/bin/env bash` with `set -uo pipefail` (no -e, catches unset vars, matches Vaio convention), exit 0 on missing files, exit 2 only on real violations. Project root detection: use $CLAUDE_PROJECT_DIR if set, else walk up from edited file path (from JSON) until package.json found, else cwd.
- Global `~/.config/opencode/AGENTS.md`: two-altitude plan convention documented (after scaffold, hand-append .omo/plans/<slug>-design.md). Subagent-declaration rule (always declare subagents-vs-direct + why).
- Vaio `AGENTS.md` (edit existing 9-line delegator): replace with Vaio-tuned ritual (point to .omo/state.md + .omo/learnings.md + docs/SPEC.md; explicit Read CLAUDE.md instruction to load Invariantes despite DCP exclude).
- Vaio `.omo/state.md`: seeded one-time from docs/NEXT-STEPS.md. After seed, diverges.
- Vaio `.omo/learnings.md`: seeded one-time from docs/LEARNINGS.md. After seed, diverges.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- NO wholesale port of superpowers skills. No docs/superpowers/specs/ in OMO projects. No second plan dir.
- NO modification to oh-my-openagent package internals (scaffold-plan.mjs, skills under ~/.cache/opencode/packages/, oh-my-openagent.json).
- NO removal of Claude Code's workflow in Vaio (Claude uses docs/, OMO uses .omo/, both coexist).
- NO per-project opencode.json in Vaio (global config + project AGENTS.md is enough).
- NO migration of existing Vaio docs (NEXT-STEPS.md, LEARNINGS.md, SPEC.md, superpowers/specs/) — they stay for Claude; OMO uses .omo/ equivalents in parallel. Only one-time seed copy.
- NO new MCP servers. NO new plugins except opencode-hooks-api.
- NO Iron Law preambles inside package-internal skills (programming/review-work/debugging are under ~/.cache/opencode/packages/). Iron Laws live in global AGENTS.md as invariantes.
- NO context7-reminder hook (redundant with AGENTS.md global context7 block already injected every session).
- NO .opencode/AGENTS.md in Vaio (profile ocx.jsonc excludes **/.opencode/** from context). Edit existing Vaio/AGENTS.md directly.
- NO omo-ritual skill WITHOUT YAML frontmatter (required for discovery).
- NO global typecheck.sh/secrets-guard.sh that runs when a project-level hook exists (dedup guard: defer to project hook).

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: none (no product code). Verification = dry-run + structural checks + file existence + content assertions.
- Evidence: .omo/evidence/task-<N>-omo-agentic-dev-system.<ext> (shell transcript or file diff)
- Each todo's QA: run a verification command (cat/grep/node -c/bash -n) and assert the output matches expected. Happy path = file exists + content correct. Failure path = run against missing input, assert exit 0 (tolerant) or exit 2 (blocker) as appropriate.
- **Plugin restart**: after T3 installs opencode-hooks-api, a new OMO session must be started for the plugin to load. F3 manual QA requires this restart.

## Execution strategy
### Parallel execution waves

**Wave 1 (6 parallel todos):** Foundation — all independent, no cross-dependencies.
- T1: Global AGENTS.md invariantes (C1+C4 merged)
- T2: omo-ritual skill (C1+C3 read rule + staleness)
- T3: Install opencode-hooks-api plugin (C2 prerequisite)
- T7: Edit Vaio/AGENTS.md (C5)
- T8: Seed .omo/state.md from docs/NEXT-STEPS.md (C5)
- T9: Seed .omo/learnings.md from docs/LEARNINGS.md (C5)

**Wave 2 (2 parallel todos):** Depends on Wave 1 outputs.
- T4: Create 6 OMO-native hook scripts (needs T3 plugin installed)
- T6: Document two-altitude + subagent-declaration in global AGENTS.md (needs T1 + T2 for path references)

**Wave 3 (1 todo):** Depends on Wave 2.
- T5: Create ~/.claude/settings.json with OMO hooks config (needs T3 plugin + T4 scripts)

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| T1 | — | T6 | T2, T3, T7, T8, T9 |
| T2 | — | T6 | T1, T3, T7, T8, T9 |
| T3 | — | T4, T5 | T1, T2, T7, T8, T9 |
| T4 | T3 | T5 | T6 (T1+T2 done) |
| T5 | T3, T4 | — | — (Wave 3, alone) |
| T6 | T1, T2 | — | T4 |
| T7 | — | — | T1, T2, T3, T8, T9 |
| T8 | — | — | T1, T2, T3, T7, T9 |
| T9 | — | — | T1, T2, T3, T7, T8 |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->

- [x] 1. Add Invariantes block to global AGENTS.md
  What to do / Must NOT do: Edit `~/.config/opencode/AGENTS.md` (currently 12 lines, context7 block only). ADD below the existing context7 block a new section `## Invariantes (north-star overrides)` with 13 numbered items using "N. " format (NOT "(N)"): 1. agent always responds — degrade, never 500/empty; 2. system prompt = role+policy, NEVER user's personal facts (facts live in memory, enter only via search); 3. organic growth > static prompt; 4. ports/adapters-lite (core/ pure no I/O, ports/ interfaces, adapters/ I/O); 5. secrets never in git/logs; 6. respond in user's locale; 7. evidence before done (typecheck/lint/test/run — never "should work"); 8. model TRIGGERS, system manages DATA (no LLM relaying ids/structured data); 9. minimize tool CHAINING (self-contained tools, not atomic ones the model orchestrates); 10. FEW extensible intent-tools (grow by params, not new tools); 11. IRON LAW TDD: no production code without a failing test first — write code before test? delete it; 12. IRON LAW VERIFICATION: no completion claims without fresh verification evidence — IDENTIFY command → RUN → READ output → VERIFY confirms claim → ONLY THEN claim; 13. IRON LAW DEBUGGING: no fixes without root cause investigation first — read errors, reproduce, check recent changes, gather evidence, THEN hypothesize, THEN fix, THEN verify. Must NOT modify the existing context7 block. Must NOT add project-specific content (these are universal). Must NOT use "(N)" notation — use "N. " (matches acceptance grep).
  Parallelization: Wave 1 | Blocked by: — | Blocks: T6
  References (executor has NO interview context - be exhaustive): 
  - File to edit: `/home/vin/.config/opencode/AGENTS.md` (12 lines, read it first)
  - Source for Invariantes #1-10: Claude's CLAUDE.md Invariantes (compressed block b1)
  - Source for Iron Laws #11-13: superpowers TDD/verification/debugging SKILL.md files (compressed block b3)
  - Existing context7 block in AGENTS.md: lines 1-12 (preserve verbatim, append after). NOTE: context7 block has 4 numbered Steps items (1-4) — the acceptance grep must scope to the Invariantes section ONLY, not the whole file.
  Acceptance criteria (agent-executable): `awk '/^## Invariantes/,0' /home/vin/.config/opencode/AGENTS.md | grep -c '^[0-9]\+\. '` returns 13; `grep -i 'iron law' /home/vin/.config/opencode/AGENTS.md` returns 3 matches; context7 block still present (`grep 'resolve-library-id' /home/vin/.config/opencode/AGENTS.md` returns ≥1).
  QA scenarios (name the exact tool + invocation): 
  - happy: `bash -c 'count=$(awk "/^## Invariantes/,0" /home/vin/.config/opencode/AGENTS.md | grep -c "^[0-9]\+\. "); [ "$count" = "13" ] && echo OK || echo "FAIL: $count items"'` → expect "OK"
  - failure: `grep 'context7' /home/vin/.config/opencode/AGENTS.md | wc -l` → expect ≥1 (context7 block preserved)
  Evidence: .omo/evidence/task-1-omo-agentic-dev-system.txt (grep output transcript)
  Commit: N | (global config, not in Vaio repo — no commit)

- [x] 2. Create omo-ritual skill
  What to do / Must NOT do: Create `/home/vin/.config/opencode/skills/omo-ritual/SKILL.md`. MUST start with YAML frontmatter (required for oh-my-openagent discovery — existing skills explore/code-research/feature-research all have it):
  ```
  ---
  name: omo-ritual
  description: Session-start ritual for OMO projects — read state, gotchas, git status, reconcile WIP before pivoting, anti-drift, two-altitude plan reads. Load at session start or when planning/starting work.
  metadata:
    author: vin
    version: 0.1.0
    argument-hint: ""
  ---
  ```
  Content sections: (a) WHEN — load at session start OR when planning/starting work on any project. (b) RITUAL — read in order: .omo/state.md (live state) → .omo/learnings.md (gotchas, relevant sections only) → `git status` + `git log --oneline -5` + current branch → if touching a feature, read .omo/plans/<slug>.md AND .omo/plans/<slug>-design.md (BOTH files, always — two-altitude rule). (c) WIP RECONCILIATION GATE — before pivoting, grep .omo/state.md for open WIP (`- [ ]` pending, `- [~]` partial, `- [?]` done-pending-verification). If >0, surface + reconcile BEFORE new work. (d) ANTI-DRIFT RULE — if .omo/state.md or .omo/learnings.md contradicts code/git, CODE WINS → reconcile .omo/ first. (e) TWO-ALTITUDE READ RULE — ALWAYS read BOTH .omo/plans/<slug>.md AND .omo/plans/<slug>-design.md. Never read only one. (f) STALENESS CHECK — if docs/NEXT-STEPS.md exists in project AND its mtime > .omo/state.md mtime, warn: "docs/NEXT-STEPS.md is newer than .omo/state.md — reconcile before proceeding (Claude may have updated state)." (g) TERMINAL — proceed to ulw-plan or start-work. Must NOT hardcode project paths. Must NOT duplicate invariantes (those live in AGENTS.md). Must NOT omit frontmatter (discovery fails without it).
  Parallelization: Wave 1 | Blocked by: — | Blocks: T6
  References (executor has NO interview context - be exhaustive):
  - Dir: `/home/vin/.config/opencode/skills/omo-ritual/`
  - File: `/home/vin/.config/opencode/skills/omo-ritual/SKILL.md`
  - Frontmatter format reference: `/home/vin/.config/opencode/skills/explore/SKILL.md` (READ FIRST — copy frontmatter structure: name, description, metadata.author/version/argument-hint)
  - Claude's ritual source: CLAUDE.md §"Workflow óptimo por sesión" (compressed block b1)
  - WIP state syntax: `- [ ]` pending, `- [~]` partial, `- [?]` done pending verification, `- [x]` verified → Historial
  - Two-altitude rule: this plan C3
  - Staleness check source: Oracle O-M5 fix
  Acceptance criteria (agent-executable): `test -f /home/vin/.config/opencode/skills/omo-ritual/SKILL.md && echo EXISTS`; `head -8 /home/vin/.config/opencode/skills/omo-ritual/SKILL.md | grep -q '^name: omo-ritual'` (frontmatter present); `grep -i 'two-altitude\|slug.*-design' /home/vin/.config/opencode/skills/omo-ritual/SKILL.md` returns ≥1; `grep -i 'wip.*reconcil\|anti-drift\|stale' /home/vin/.config/opencode/skills/omo-ritual/SKILL.md` returns ≥2.
  QA scenarios (name the exact tool + invocation):
  - happy: `bash -c 'f=/home/vin/.config/opencode/skills/omo-ritual/SKILL.md; [ -f "$f" ] && head -8 "$f" | grep -q "^name: omo-ritual" && grep -qi "two-altitude\|slug.*-design" "$f" && grep -qi "wip" "$f" && echo OK || echo FAIL'` → expect "OK"
  - failure: `bash -c 'f=/home/vin/.config/opencode/skills/omo-ritual/SKILL.md; [ ! -f "$f" ] && echo "MISSING" || (head -8 "$f" | grep -q "^name:" || echo "NO FRONTMATTER")'` → before creation "MISSING"; without frontmatter "NO FRONTMATTER"
  Evidence: .omo/evidence/task-2-omo-agentic-dev-system.txt (grep output)
  Commit: N | (global config, not in Vaio repo)

- [x] 3. Install opencode-hooks-api plugin
  What to do / Must NOT do: Edit `/home/vin/.config/opencode/opencode.json`. In the `plugins` array (currently `["@tarquiden/opencode-dcp@latest", "oh-my-openagent@latest", "@nick-vi/opencode-type-inject"]`), ADD `"opencode-hooks-api"`. Preserve all other fields verbatim. Must NOT remove existing plugins. Must NOT change plugin order (append to end). Must NOT modify provider or MCP sections. NOTE: after this edit, a NEW OMO session must be started for the plugin to load — the current session will not pick it up.
  Parallelization: Wave 1 | Blocked by: — | Blocks: T4, T5
  References (executor has NO interview context - be exhaustive):
  - File to edit: `/home/vin/.config/opencode/opencode.json` (46 lines, read first)
  - Current plugins array: `["@tarquiden/opencode-dcp@latest", "oh-my-openagent@latest", "@nick-vi/opencode-type-inject"]`
  - Plugin npm name: `opencode-hooks-api`
  - Plugin requires session restart to load (not hot-reloaded)
  Acceptance criteria (agent-executable): `grep 'opencode-hooks-api' /home/vin/.config/opencode/opencode.json` returns 1 match; `node -e "JSON.parse(require('fs').readFileSync('/home/vin/.config/opencode/opencode.json','utf8')); console.log('VALID')"` prints "VALID".
  QA scenarios (name the exact tool + invocation):
  - happy: `bash -c 'grep -q "opencode-hooks-api" /home/vin/.config/opencode/opencode.json && node -e "JSON.parse(require(\"fs\").readFileSync(\"/home/vin/.config/opencode/opencode.json\",\"utf8\"))" && echo OK || echo FAIL'` → expect "OK"
  - failure: `node -e "JSON.parse(require('fs').readFileSync('/home/vin/.config/opencode/opencode.json','utf8'))" 2>&1 || echo "INVALID JSON"` → if JSON broken, "INVALID JSON"
  Evidence: .omo/evidence/task-3-omo-agentic-dev-system.txt (grep + node validation)
  Commit: N | (global config, not in Vaio repo)

- [x] 4. Create 6 OMO-native hook scripts
  What to do / Must NOT do: Create directory `/home/vin/.config/opencode/hooks/` and 6 bash scripts inside it. ALL scripts: `#!/usr/bin/env bash`, `set -uo pipefail` (no -e — we handle errors manually for tolerance; -u catches unset vars; pipefail catches pipe failures — matches Vaio's existing typecheck.sh convention), exit 0 on missing files (tolerant), exit 2 only on real violations. Input handling for ALL scripts: `INPUT="${1:-}"; [ -z "$INPUT" ] && INPUT="$(cat)"` (handles both arg and stdin — prevents hangs). Parse JSON with `jq` if available, else `python3 -c "import json,sys; ..."` fallback. Project root detection: `ROOT="${CLAUDE_PROJECT_DIR:-}"; if [ -z "$ROOT" ]; then D="$(dirname "$FILE_PATH" 2>/dev/null || echo "$PWD")"; while [ "$D" != "/" ] && [ ! -f "$D/package.json" ]; do D="$(dirname "$D")"; done; ROOT="${D:-$PWD}"; fi`. Scripts:
  (a) `typecheck.sh` — DEDUP GUARD: `if [ -f "$ROOT/.claude/hooks/typecheck.sh" ]; then exit 0; fi` (defer to project hook if it exists — prevents concurrent tsc corrupting tsbuildinfo). Extract edited file path from JSON. If path does NOT end in `.ts` or `.tsx`, exit 0. If `node_modules/` not present in ROOT, exit 0. Run `cd "$ROOT" && pnpm typecheck 2>/dev/null || npx tsc --noEmit 2>&1`. If exit code ≠ 0, print errors to stderr, exit 2. Else exit 0.
  (b) `secrets-guard.sh` — DEDUP GUARD: `if [ -f "$ROOT/.claude/hooks/secrets-guard.sh" ]; then exit 0; fi`. Extract bash command from JSON. If command does NOT match `git add` or `git commit`, exit 0. Check if `.env` (not `.env.example`) in command OR staged files (`cd "$ROOT" && git diff --cached --name-only 2>/dev/null`). If yes, print "BLOCKED: .env in git operation" to stderr, exit 2. Else exit 0.
  (c) `omo-session-start.sh` — auto-fires (SessionStart in plugin). Check `$ROOT/.omo/state.md` exists. If not, exit 0. STALENESS CHECK: if `$ROOT/docs/NEXT-STEPS.md` exists AND `stat -c %Y docs/NEXT-STEPS.md` > `stat -c %Y .omo/state.md`, append staleness warning to additionalContext. WIP GATE (moved here from wip-reconcile — SessionStart auto-fires, UserPromptSubmit does not): grep `.omo/state.md` for `- [ ]` or `- [~]` or `- [?]`. If count > 0, append WIP warning. Output `{"additionalContext": "RITUAL: read .omo/state.md + .omo/learnings.md + git status, then load omo-ritual skill. <WIP warning if any> <staleness warning if any>"}`. Exit 0. Must NOT fail if .omo/ missing.
  (d) `omo-wip-reconcile.sh` — NOT auto-fired in OMO (UserPromptSubmit = /hook-prompt slash only). Repurposed as manual re-check script for `/hook-prompt` slash command. Same WIP grep logic as (c). Advisory only (exit 0 always).
  (e) `omo-plan-after-exit.sh` — PostToolUse. Filter: if tool name != "Write" OR path doesn't match `.omo/plans/`, exit 0. Output reminder for two-altitude. Exit 0.
  (f) `omo-two-altitude-guard.sh` — PreToolUse, matcher on start-work. BLOCKING: if invoked when a plan exists in `.omo/plans/<slug>.md` but `.omo/plans/<slug>-design.md` does NOT exist, print "BLOCKED: two-altitude plan incomplete — create .omo/plans/<slug>-design.md before starting work" to stderr, exit 2. Extract slug from the plan path in tool input. Exit 0 if no plan referenced or design.md exists.
  Must NOT use `set -e` (breaks tolerance). Must NOT hardcode project paths. Must NOT exit 2 on advisory hooks (only typecheck + secrets-guard + two-altitude-guard block). Must handle both stdin and arg input.
  Parallelization: Wave 2 | Blocked by: T3 (plugin must be installed first) | Blocks: T5
  References (executor has NO interview context - be exhaustive):
  - Dir: `/home/vin/.config/opencode/hooks/`
  - Source for typecheck.sh + secrets-guard.sh: Vaio's `.claude/hooks/typecheck.sh` + `.claude/hooks/secrets-guard.sh` (READ FIRST for logic, adapt for generic project + add dedup guard)
  - Hook input JSON format (concrete): plugin passes JSON to the hook process. For PreToolUse/PostToolUse: `{"tool_name":"Edit","tool_input":{"filePath":"...","oldString":"...","newString":"..."}}`. For UserPromptSubmit: `{"prompt":"user text"}`. For SessionStart: `{}` or no input. Scripts handle both arg (`"$1"`) and stdin (`cat`) via the INPUT pattern above.
  - additionalContext output: `{"additionalContext": "..."}` to stdout (Claude Code convention, plugin supports it)
  - Exit codes: 0 = allow/pass, 2 = block (PreToolUse/PostToolUse), other = non-blocking error
  - Dedup guard source: Oracle O-B1 fix (concurrent tsc corrupts tsbuildinfo)
  - WIP gate move source: Oracle O-B3 fix (UserPromptSubmit doesn't auto-fire in OMO)
  - Two-altitude blocking source: Oracle O-M4 fix
  - Staleness source: Oracle O-M5 fix
  Acceptance criteria (agent-executable): `ls /home/vin/.config/opencode/hooks/{typecheck,secrets-guard,omo-session-start,omo-wip-reconcile,omo-plan-after-exit,omo-two-altitude-guard}.sh | wc -l` returns 6; `bash -n /home/vin/.config/opencode/hooks/*.sh` exits 0; each script starts with `#!/usr/bin/env bash`; `grep -l 'set -uo pipefail' /home/vin/.config/opencode/hooks/*.sh | wc -l` returns 6; `grep -l 'CLAUDE_PROJECT_DIR\|package.json' /home/vin/.config/opencode/hooks/typecheck.sh` returns 1 (root detection).
  QA scenarios (name the exact tool + invocation):
  - happy: `bash -c 'cd /home/vin/.config/opencode/hooks && ls *.sh | wc -l | grep -q "^6$" && bash -n typecheck.sh && bash -n secrets-guard.sh && bash -n omo-session-start.sh && bash -n omo-wip-reconcile.sh && bash -n omo-plan-after-exit.sh && bash -n omo-two-altitude-guard.sh && echo OK || echo FAIL'` → expect "OK"
  - failure (tolerance): `bash -c 'cd /tmp && echo "" | bash /home/vin/.config/opencode/hooks/omo-session-start.sh; [ $? -eq 0 ] && echo "TOLERANT OK" || echo "FAIL: should exit 0 on missing .omo/state.md"'` → expect "TOLERANT OK"
  - failure (dedup guard): `bash -c 'mkdir -p /tmp/test-dedup/.claude/hooks && touch /tmp/test-dedup/.claude/hooks/typecheck.sh && cd /tmp/test-dedup && echo "" | CLAUDE_PROJECT_DIR=/tmp/test-dedup bash /home/vin/.config/opencode/hooks/typecheck.sh; [ $? -eq 0 ] && echo "DEDUP OK" || echo "FAIL: should defer to project hook"'` → expect "DEDUP OK"
  Evidence: .omo/evidence/task-4-omo-agentic-dev-system.txt (ls + bash -n + tolerance + dedup test)
  Commit: N | (global config, not in Vaio repo)

- [x] 5. Create ~/.claude/settings.json with OMO hooks config
  What to do / Must NOT do: Create OR edit `/home/vin/.claude/settings.json` (global, read by plugin with highest merge priority). MERGE hooks key using `jq` (safe merge — preserves existing keys, appends per-event-type). If file exists with morph-compact directive, preserve it. First verify morph-compact doesn't clobber hooks on update (check morph-compact config — if it writes settings.json wholesale, use a separate hooks config file or accept the risk). Hook config:
  ```json
  {
    "hooks": {
      "SessionStart": [{"matcher": "*", "hooks": [{"type": "command", "command": "bash ~/.config/opencode/hooks/omo-session-start.sh"}]}],
      "PostToolUse": [
        {"matcher": "Edit|Write|MultiEdit", "hooks": [{"type": "command", "command": "bash ~/.config/opencode/hooks/typecheck.sh"}]},
        {"matcher": "Write", "hooks": [{"type": "command", "command": "bash ~/.config/opencode/hooks/omo-plan-after-exit.sh"}]}
      ],
      "PreToolUse": [
        {"matcher": "Bash", "hooks": [{"type": "command", "command": "bash ~/.config/opencode/hooks/secrets-guard.sh"}]},
        {"matcher": "start-work", "hooks": [{"type": "command", "command": "bash ~/.config/opencode/hooks/omo-two-altitude-guard.sh"}]}
      ],
      "UserPromptSubmit": [{"matcher": "*", "hooks": [{"type": "command", "command": "bash ~/.config/opencode/hooks/omo-wip-reconcile.sh"}]}]
    }
  }
  ```
  Merge strategy: `jq '.hooks = (.hooks // {}) | .hooks.SessionStart = ((.hooks.SessionStart // []) + $newSession) | ...'` — per-event-type append (don't overwrite existing event arrays). Must NOT overwrite existing settings. Must NOT add context7-reminder hook. Note: UserPromptSubmit won't auto-fire in OMO (plugin exposes /hook-prompt slash only) — omo-wip-reconcile.sh is manual re-check there; SessionStart auto-fires and carries the WIP gate. Note: PostToolUse Write matcher for omo-plan-after-exit is broad — script filters by .omo/plans/ path (exits 0 otherwise).
  Parallelization: Wave 3 | Blocked by: T3, T4 (plugin + scripts must exist) | Blocks: —
  References (executor has NO interview context - be exhaustive):
  - File: `/home/vin/.claude/settings.json` (read first — has morph-compact block)
  - Plugin merge order: ~/.claude/settings.json → .claude/settings.json → .claude/settings.local.json (later wins)
  - morph-compact interaction: verify morph-compact plugin doesn't rewrite settings.json wholesale (check its source/instructions). If it does, document the risk + use jq merge every time.
  - Hook format: Claude Code hooks docs (matcher + hooks[{type, command}])
  - Plugin auto-fire events: SessionStart, PostToolUse, PostToolUseFailure, PreToolUse auto-fire. UserPromptSubmit = /hook-prompt slash only.
  - Coexistence: Claude Code reads ~/.claude/settings.json too. typecheck+secrets-guard dedup to project hooks (harmless). omo-session-start exits 0 if .omo/ missing. omo-plan-after-exit filters by .omo/plans/. omo-two-altitude-guard checks .omo/plans/ (harmless in Claude).
  Acceptance criteria (agent-executable): `node -e "const s=JSON.parse(require('fs').readFileSync('/home/vin/.claude/settings.json','utf8')); console.log(s.hooks ? 'HAS_HOOKS' : 'NO_HOOKS')"` prints "HAS_HOOKS"; `node -e "const s=JSON.parse(require('fs').readFileSync('/home/vin/.claude/settings.json','utf8')); console.log(Object.keys(s.hooks).sort().join(','))"` prints "PostToolUse,PreToolUse,SessionStart,UserPromptSubmit".
  QA scenarios (name the exact tool + invocation):
  - happy: `bash -c 'node -e "const s=JSON.parse(require(\"fs\").readFileSync(\"/home/vin/.claude/settings.json\",\"utf8\")); if(s.hooks && s.hooks.SessionStart && s.hooks.PostToolUse && s.hooks.PreToolUse) { console.log(\"OK\") } else { console.log(\"FAIL\") }"'` → expect "OK"
  - failure: `node -e "JSON.parse(require('fs').readFileSync('/home/vin/.claude/settings.json','utf8'))" 2>&1 || echo "INVALID"` → if broken, "INVALID"
  Evidence: .omo/evidence/task-5-omo-agentic-dev-system.txt (node validation + jq merge transcript)
  Commit: N | (global config, not in Vaio repo)

- [x] 6. Document two-altitude + subagent-declaration in global AGENTS.md
  What to do / Must NOT do: Edit `/home/vin/.config/opencode/AGENTS.md` (after T1 added Invariantes). ADD below Invariantes a new section `## Plan + execution conventions` with: (a) TWO-ALTITUDE PLANS — after ulw-plan scaffold emits `.omo/plans/<slug>.md`, if approved, hand-append `.omo/plans/<slug>-design.md` (technical: data structures, interfaces, error paths, edge cases). When touching a feature with an existing plan, ALWAYS read BOTH. The two-altitude-guard hook BLOCKS start-work if -design.md missing. (b) SUBAGENT DECLARATION — before starting any task, explicitly declare subagents (parallel/independent) vs direct (sequential/coupled/small) + why. Default: large/uncertain → subagents, small/coupled → direct. Skipping = violation. Must NOT duplicate omo-ritual content. Must NOT reference Vaio-specific paths.
  Parallelization: Wave 2 | Blocked by: T1, T2 | Blocks: —
  References (executor has NO interview context - be exhaustive):
  - File: `/home/vin/.config/opencode/AGENTS.md` (after T1 — has context7 block + Invariantes)
  - Two-altitude source: this plan C3 + Oracle O-M4 fix (blocking enforcement)
  - Subagent-declaration source: Claude CLAUDE.md §"Disciplina de skills + subagentes" (compressed block b1)
  - omo-ritual skill: created in T2
  - Acceptance grep scoping: context7 block has 4 numbered items; scope to Invariantes section with awk (same as T1 fix)
  Acceptance criteria (agent-executable): `grep -i 'two-altitude' /home/vin/.config/opencode/AGENTS.md` returns ≥1; `grep -i 'subagent.*declar\|declar.*subagent' /home/vin/.config/opencode/AGENTS.md` returns ≥1; `awk '/^## Invariantes/,0' /home/vin/.config/opencode/AGENTS.md | grep -c '^[0-9]\+\. '` returns 13 (Invariantes preserved, not duplicated).
  QA scenarios (name the exact tool + invocation):
  - happy: `bash -c 'grep -qi "two-altitude" /home/vin/.config/opencode/AGENTS.md && grep -qi "subagent.*declar" /home/vin/.config/opencode/AGENTS.md && echo OK || echo FAIL'` → expect "OK"
  - failure: `bash -c 'count=$(awk "/^## Invariantes/,0" /home/vin/.config/opencode/AGENTS.md | grep -c "^[0-9]\+\. "); [ "$count" = "13" ] && echo "INVARIANTS OK" || echo "FAIL: $count (duplicated?)"'` → expect "INVARIANTS OK"
  Evidence: .omo/evidence/task-6-omo-agentic-dev-system.txt (grep output)
  Commit: N | (global config, not in Vaio repo)

- [x] 7. Edit Vaio/AGENTS.md with Vaio-tuned ritual
  What to do / Must NOT do: Edit `/home/vin/Documents/Vaio/AGENTS.md` (currently 9 lines, delegates to CLAUDE.md + docs/SPEC.md). Replace with a richer AGENTS.md that: (a) Still delegates to CLAUDE.md + docs/SPEC.md (preserve this). (b) ADDS: `## OMO workflow (when using OpenCode/OMO)` section with: ritual rules pointing to `.omo/state.md` (live state) + `.omo/learnings.md` (gotchas) + `docs/SPEC.md` (foundational design, shared with Claude). (c) ADDS: explicit instruction `Read CLAUDE.md at session start` (works despite DCP excluding **/CLAUDE.md from auto-context — explicit Read tool calls bypass the exclude). (d) ADDS: "Claude uses docs/NEXT-STEPS.md + docs/LEARNINGS.md; OMO uses .omo/state.md + .omo/learnings.md. Both are git-tracked. Do NOT cross-write (each tool writes its own namespace)." (e) ADDS: "If .omo/state.md or .omo/learnings.md don't exist yet, load omo-ritual skill for the session-start procedure." Must NOT remove the delegation to CLAUDE.md. Must NOT add OMO-specific content to CLAUDE.md (Claude owns that file). Must NOT create .opencode/AGENTS.md (excluded by profile ocx.jsonc).
  Parallelization: Wave 1 | Blocked by: — | Blocks: —
  References (executor has NO interview context - be exhaustive):
  - File to edit: `/home/vin/Documents/Vaio/AGENTS.md` (9 lines — read first)
  - Current content: delegates to CLAUDE.md + docs/SPEC.md
  - DCP exclude list: `~/.config/opencode/profiles/default/ocx.jsonc` excludes `**/CLAUDE.md` from auto-context — but explicit `Read` tool calls bypass this (verified: the exclude only affects auto-context-include, not tool-directed reads)
  - .omo/state.md + .omo/learnings.md paths: relative to project root (Vaio)
  - omo-ritual skill: created in T2 at `~/.config/opencode/skills/omo-ritual/SKILL.md`
  Acceptance criteria (agent-executable): `grep -i 'omo.*state\|\.omo/state' /home/vin/Documents/Vaio/AGENTS.md` returns ≥1; `grep -i 'read.*claude.md\|Read.*CLAUDE' /home/vin/Documents/Vaio/AGENTS.md` returns ≥1; `grep 'CLAUDE.md' /home/vin/Documents/Vaio/AGENTS.md` returns ≥1 (delegation preserved).
  QA scenarios (name the exact tool + invocation):
  - happy: `bash -c 'grep -qi "\.omo/state" /home/vin/Documents/Vaio/AGENTS.md && grep -qi "CLAUDE.md" /home/vin/Documents/Vaio/AGENTS.md && echo OK || echo FAIL'` → expect "OK"
  - failure: `wc -l /home/vin/Documents/Vaio/AGENTS.md` → expect >9 (expanded from 9-line delegator)
  Evidence: .omo/evidence/task-7-omo-agentic-dev-system.txt (grep + wc output)
  Commit: Y | chore(agents): add OMO workflow section to AGENTS.md

- [x] 8. Seed .omo/state.md from docs/NEXT-STEPS.md
  What to do / Must NOT do: Copy `/home/vin/Documents/Vaio/docs/NEXT-STEPS.md` to `/home/vin/Documents/Vaio/.omo/state.md`. This is a ONE-TIME seed. After this, the files diverge (OMO writes .omo/state.md, Claude writes docs/NEXT-STEPS.md). At the TOP of .omo/state.md, add a header comment: `<!-- OMO state source of truth. Seeded one-time from docs/NEXT-STEPS.md on $(date +%Y-%m-%d). Diverges after this point. -->`. Must NOT modify docs/NEXT-STEPS.md (Claude owns it). Must NOT filter content (full copy — ESTADO ACTUAL + WIP list + Historial).
  Parallelization: Wave 1 | Blocked by: — | Blocks: —
  References (executor has NO interview context - be exhaustive):
  - Source: `/home/vin/Documents/Vaio/docs/NEXT-STEPS.md` (481+ lines — ESTADO ACTUAL date block + 🚧 WIP list with `[ ]/[~]/[?]/[x]` states + Historial cronológico)
  - Target: `/home/vin/Documents/Vaio/.omo/state.md`
  - .omo/ dir already exists (scaffold created it)
  - .gitignore does NOT list .omo/ (verified — git-trackable)
  Acceptance criteria (agent-executable): `test -f /home/vin/Documents/Vaio/.omo/state.md && echo EXISTS`; `wc -l /home/vin/Documents/Vaio/.omo/state.md` returns ≥480 (close to source line count); `head -1 /home/vin/Documents/Vaio/.omo/state.md` contains "OMO state" or "Seeded".
  QA scenarios (name the exact tool + invocation):
  - happy: `bash -c 'f=/home/vin/Documents/Vaio/.omo/state.md; [ -f "$f" ] && [ $(wc -l < "$f") -gt 400 ] && head -1 "$f" | grep -qi "omo\|seed" && echo OK || echo FAIL'` → expect "OK"
  - failure: `diff <(grep -c '^\- \[' /home/vin/Documents/Vaio/docs/NEXT-STEPS.md) <(grep -c '^\- \[' /home/vin/Documents/Vaio/.omo/state.md)` → expect identical WIP item counts (full copy)
  Evidence: .omo/evidence/task-8-omo-agentic-dev-system.txt (wc + head + diff output)
  Commit: Y | chore(omo): seed .omo/state.md from docs/NEXT-STEPS.md

- [x] 9. Seed .omo/learnings.md from docs/LEARNINGS.md
  What to do / Must NOT do: Copy `/home/vin/Documents/Vaio/docs/LEARNINGS.md` to `/home/vin/Documents/Vaio/.omo/learnings.md`. ONE-TIME seed. At TOP add: `<!-- OMO gotchas memory. Seeded one-time from docs/LEARNINGS.md on $(date +%Y-%m-%d). Diverges after this point. -->`. Must NOT modify docs/LEARNINGS.md. Must NOT filter content (full 524+ line copy).
  Parallelization: Wave 1 | Blocked by: — | Blocks: —
  References (executor has NO interview context - be exhaustive):
  - Source: `/home/vin/Documents/Vaio/docs/LEARNINGS.md` (524+ lines, dense one-line learnings grouped by topic)
  - Target: `/home/vin/Documents/Vaio/.omo/learnings.md`
  - .omo/ dir already exists
  Acceptance criteria (agent-executable): `test -f /home/vin/Documents/Vaio/.omo/learnings.md && echo EXISTS`; `wc -l /home/vin/Documents/Vaio/.omo/learnings.md` returns ≥500.
  QA scenarios (name the exact tool + invocation):
  - happy: `bash -c 'f=/home/vin/Documents/Vaio/.omo/learnings.md; [ -f "$f" ] && [ $(wc -l < "$f") -gt 500 ] && echo OK || echo FAIL'` → expect "OK"
  - failure: `diff /home/vin/Documents/Vaio/docs/LEARNINGS.md /home/vin/Documents/Vaio/.omo/learnings.md | head -5` → expect only the header comment line as diff (rest identical)
  Evidence: .omo/evidence/task-9-omo-agentic-dev-system.txt (wc + diff output)
  Commit: Y | chore(omo): seed .omo/learnings.md from docs/LEARNINGS.md

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
> NOTE: F3 requires a NEW OMO session (plugin + hooks load on session start, not hot-reloaded).
- [x] F1. Plan compliance audit
  Verify every todo's acceptance criteria passes. Run all 9 acceptance commands in sequence (using awk-scoped grep for T1/T6). Collect output. APPROVE only if all 9 pass. Evidence: .omo/evidence/F1-plan-compliance.txt
- [x] F2. Code quality review
  Review all created/edited files for: bash scripts follow best practices (quoted vars, `set -uo pipefail`, explicit exits, no set -e in tolerant scripts, both stdin+arg input handling, project root detection); JSON is valid (jq merge used); markdown well-structured; no hardcoded project paths in global files; YAML frontmatter on omo-ritual. APPROVE only if zero issues. Evidence: .omo/evidence/F2-code-quality.txt
- [x] F3. Real manual QA
  Start a NEW OMO session in Vaio (plugin requires restart). Verify: (a) global AGENTS.md Invariantes injected (visible in system prompt sources); (b) omo-ritual skill discoverable (appears in skill list — frontmatter present); (c) hooks plugin loaded (no error on session start); (d) .omo/state.md + .omo/learnings.md exist + readable; (e) Vaio/AGENTS.md has OMO workflow section; (f) typecheck dedup guard works (if .claude/hooks/typecheck.sh exists, global hook defers). APPROVE only if all 6 checks pass. Evidence: .omo/evidence/F3-manual-qa.txt
- [x] F4. Scope fidelity
  Verify no Must-NOT-have was violated: no superpowers wholesale port, no package-internal edits, no Claude workflow removal, no docs/ migration, no new MCPs, no context7-reminder hook, no .opencode/AGENTS.md in Vaio, no Iron Law preambles inside package-internal skills, no omo-ritual without frontmatter, no global typecheck without dedup guard. APPROVE only if zero violations. Evidence: .omo/evidence/F4-scope-fidelity.txt

## Commit strategy
- Vaio repo commits: T7 (AGENTS.md), T8 (.omo/state.md), T9 (.omo/learnings.md). Three atomic commits, all `chore` type.
- Global config (T1-T6): NOT in Vaio repo. No commits. These are machine-local config changes (tracked separately or not at all — user's choice).
- Commit messages: `chore(agents): add OMO workflow section to AGENTS.md`, `chore(omo): seed .omo/state.md from docs/NEXT-STEPS.md`, `chore(omo): seed .omo/learnings.md from docs/LEARNINGS.md`.
- Do NOT commit .omo/run-continuation/ (ephemeral session state — add to .gitignore if it clutters).

## Success criteria
- Global AGENTS.md has 13 Invariantes + two-altitude + subagent-declaration conventions.
- omo-ritual skill exists with YAML frontmatter, discoverable, covers session-start ritual + WIP gate (in SessionStart, not UserPromptSubmit) + anti-drift + two-altitude read rule + staleness check.
- opencode-hooks-api plugin installed; 6 OMO-native hook scripts created (typecheck+secrets-guard with project-hook dedup, omo-session-start with WIP gate + staleness, omo-wip-reconcile as manual /hook-prompt, omo-plan-after-exit, omo-two-altitude-guard blocking); ~/.claude/settings.json configures them via jq merge; scripts idempotent + tolerant + handle both stdin+arg.
- Vaio/AGENTS.md expanded with OMO workflow section (points to .omo/, instructs Read CLAUDE.md).
- .omo/state.md + .omo/learnings.md seeded one-time from docs/ (git-trackable, portable).
- Claude's workflow in Vaio untouched (docs/ stays, .claude/ stays).
- Zero package-internal modifications. Zero new MCPs. Zero wholesale superpowers port. Zero concurrent tsc risk (dedup guard).