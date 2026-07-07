---
slug: omo-agentic-dev-system
status: drafting
intent: clear
review_required: false
pending-action: write .omo/plans/omo-agentic-dev-system.md
approach: Make OMO the canonical agentic dev system for Vaio + future projects. Adopt Claude's workflows/philosophies globally via OMO-native mechanisms (global AGENTS.md invariantes, a procedural skill for ritual+state, a hooks plugin for hard enforcement, strengthened skills with Iron Law framing, two-altitude plan convention). Equilibrium OMO-weighted: OMO structural backbone, superpowers prescriptive framing adopted in-place. NOT a wholesale port of superpowers.
---

# Draft: omo-agentic-dev-system

## Components (topology ledger)
<!-- Locked from b3 research + this turn's confirmations. 5 independent components. -->

| id | outcome (one line) | status | evidence path |
|---|---|---|---|
| C1 | Global OMO conventions (invariantes + session-start ritual + state source of truth + gotchas memory + anti-drift) live in ~/.config/opencode/ | active | b1,b2,b3 — Claude has CLAUDE.md Invariantes + NEXT-STEPS + LEARNINGS; OMO has no equivalent |
| C2 | Hooks adoption: port Claude's 5 hook scripts to OMO via romain325/opencode-hooks-plugin (reads .claude/settings.json format, exit-2 blocks, has tests) | active | b3 websearch + this turn GitHub fetch — plugin confirmed compatible |
| C3 | SDD plan structure: two-altitude plans in .omo/ (high-level + design) + per-project documented registry | active | b3 — Claude uses docs/superpowers/specs/<tema>-{design,plan}.md; OMO scaffold is single-file |
| C4 | Skill strengthening: adopt superpowers Iron Law framing into OMO programming + verification + debugging skills | active | b3 — 6 superpowers skills read, Iron Law framing is the differentiator |
| C5 | Brainstorming→planning flow: ensure ulw-plan handles "not every task needs subagents" + model independence to decide | active | b3 — Claude CLAUDE.md §"Disciplina de skills + subagentes" has explicit default/declare rule |

## Open assumptions (announced defaults)

| assumption | adopted default | rationale | reversible? |
|---|---|---|---|
| Hooks plugin | romain325/opencode-hooks-plugin (npm: `opencode-hooks-api`) | More complete than opencode-claude-hooks, has tests, supports all 4 hook types, same .claude/settings.json format Vaio already uses, exit-2 block contract identical | YES (swap plugin) |
| Hook scripts recreated OMO-native (CONFIRMED) | Recrear 4-5 hooks OMO-nativos apuntando a .omo/state.md + .omo/learnings.md, NO portear verbatim. typecheck+secrets-guard porteados universales. session-start-reconcile + wip-reconcile + spec-after-plan recreados para hablar .omo/. context7-reminder eliminado (redundante con AGENTS.md global context7 block). | Fork 3 resolved: user wants all hooks adapted to the refined OMO framework, not just ported verbatim. | YES |
| Two-altitude plan convention | Wrapper convention in AGENTS.md (scaffold emits single file; second file hand-appended as `<slug>-design.md`) | scaffold-plan.mjs is package-internal, can't modify; wrapper is OMO-native | YES |
| Iron Law framing | Add a short "Iron Law" preamble to OMO's programming + review-work + debugging skills | Prescriptive framing is superpowers' main differentiator; OMO skills are procedural but less "iron" | YES (revert) |
| Model independence in ulw-plan | ulw-plan already lets planner decide subagents vs direct; reinforce in AGENTS.md | OMO's ulw-plan already has this; just make it explicit + always declare | YES |
| State + gotchas location (CONFIRMED) | `.omo/state.md` + `.omo/learnings.md`, git-trackable (verifiqué .gitignore: .omo/ NO está listado), sembrados one-time desde docs/NEXT-STEPS.md + docs/LEARNINGS.md, después divergen. | Fork 2 resolved: portabilidad equivalente a docs/ (ambos en repo, ambos clonables via git), namespace separado evita colisión Claude↔OMO. | YES (migrate later) |

## Findings (cited - path:lines)

- Claude's CLAUDE.md 10 Invariantes (b1): #1 agent always responds; #2 system prompt = VOZ+rol+policy NEVER Kevin's facts; #3 organic growth; #4 ports/adapters-lite; #5 secrets never in git/logs; #6 respond in user's locale; #7 evidence before done; #8 model TRIGGERS system manages DATA; #9 minimize tool CHAINING; #10 FEW extensible intent-tools.
- Claude's hooks (b1): PostToolUse(Edit|Write|MultiEdit)→typecheck.sh blocks exit 2; PostToolUse(ExitPlanMode)→spec-after-plan.sh; UserPromptSubmit→context7-reminder.sh + wip-reconcile.sh; SessionStart→session-start-reconcile.sh; PreToolUse(Bash git)→secrets-guard.sh.
- Claude's docs (b1): NEXT-STEPS.md (live state, WIP `[ ]/[~]/[?]/[x]` + Historial), LEARNINGS.md (524+ lines gotchas), SPEC.md (foundational), superpowers/specs/ (per-feature design+plan).
- OMO setup (b2): ~/.config/opencode/ has opencode.json (ollama-cloud provider, morph + context7 MCPs, oh-my-openagent + DCP + type-inject plugins), oh-my-openagent.json (11 agents + 8 categories), AGENTS.md (context7 block), profile excludes **/CLAUDE.md. No project .opencode/ or .omo/ in Vaio. No project hooks.
- Superpowers skills (b3): brainstorming (HARD-GATE, design→writing-plans), writing-plans (bite-sized TDD steps, no placeholders), subagent-driven-development (fresh subagent per task, two-stage review, continuous execution), test-driven-development (Iron Law: no production code without failing test first), verification-before-completion (Iron Law: no completion claims without fresh verification evidence), systematic-debugging (Iron Law: no fixes without root cause first).
- OMO equivalents (b3): ulw-plan (explore→approval gate→scaffold→Metis→todos), programming (routes to TDD refs, less prescriptive), review-work (5 parallel subagents, more comprehensive), debugging (hypothesis-driven ≥3 hypotheses, Oracle escalation), start-work (Boulder state, evidence ledger, worktree discipline), agent taxonomy (11 named + 8 categories).
- Verdict (b3): OMO superior in STRUCTURE (scaffold, Metis, approval gate, compaction-safe, agent taxonomy, review depth, dual high-accuracy review). Superpowers superior in PRESCRIPTIVE FRAMING (Iron Laws, HARD-GATES, "violating letter = violating spirit").
- romain325/opencode-hooks-plugin (this turn, GitHub fetch): npm `opencode-hooks-api`, reads .claude/settings.json (same format), all 4 hook types (command/http/prompt/agent), auto-fires PreToolUse/PostToolUse/PostToolUseFailure/SessionStart/SessionEnd/Stop, exposes UserPromptSubmit/Notification/PreCompact as slash commands, exit-2 blocks, `disableAllHooks: true`, merge order ~/.claude → .claude → .claude.local, has test suite (config/events/executor/matcher). 3 stars, 5 commits, WTFPL.
- scaffold-plan.mjs (this turn, read): single-file plan, package-internal (can't modify), writes only .md under .omo/, compaction-safe. PLAN_SECTION_HEADERS = TL;DR/Scope/Verification strategy/Execution strategy/Todos/Final verification wave/Commit strategy/Success criteria.

## Decisions (with rationale)

1. EQUILIBRIUM OMO-weighted, NOT wholesale port. Rationale: porting superpowers wholesale creates two plan dirs, two approval gates, two execution flows — direct conflict. OMO is structurally superior; adopt superpowers' prescriptive framing in-place.
2. Hooks via romain325/opencode-hooks-plugin (npm `opencode-hooks-api`). Rationale: more complete, has tests, same format Vaio already uses, exit-2 block contract identical.
3. Hooks RECREATED OMO-nativos, NO porteados verbatim. Rationale: user wants all hooks adapted to the refined OMO framework (apuntando a .omo/, hablando el idioma de OMO). typecheck+secrets-guard porteados verbatim (universales, no dependen de docs/). session-start-reconcile, wip-reconcile, spec-after-plan recreados para .omo/state.md + .omo/learnings.md + two-altitude plans. context7-reminder eliminado (redundante con AGENTS.md global context7 block).
4. Two-altitude plans as wrapper convention. Rationale: scaffold-plan.mjs is package-internal; can't modify. Convention: after scaffold, hand-append `<slug>-design.md` for technical low-level. Reinforce in AGENTS.md.
5. Iron Law framing added to OMO skills. Rationale: the cognitive anchor ("violating letter = violating spirit") prevents rationalization; genuinely valuable, not just stylistic.
6. State + gotchas in .omo/state.md + .omo/learnings.md, sembrados desde docs/. Rationale: git-trackable (verifiqué .gitignore: .omo/ no está), portabilidad equivalente a docs/, namespace separado evita colisión con Claude's workflow en Vaio. Sembrar one-time desde NEXT-STEPS.md + LEARNINGS.md, después divergen.
7. Global + Vaio project-level. Rationale: global ~/.config/opencode/AGENTS.md (invariantes universales), Vaio .opencode/AGENTS.md (ritual Vaio-tuned + un-exclude CLAUDE.md + sembrar .omo/state.md + .omo/learnings.md). Proyectos futuros solo usan global.
8. Split conventions: invariantes in AGENTS.md (always-on), ritual+state in skill (on-demand). Rationale: AGENTS.md stays lean, invariantes always injected, procedural ritual loaded when planning/starting.

## Scope IN

- Global ~/.config/opencode/AGENTS.md: add Invariantes block (adapted from Claude's 10, universalized for any agent project: always respond/degrade; organic growth; ports/adapters-lite; secrets never in git/logs; respond in user's locale; evidence before done; model TRIGGERS system manages DATA; minimize tool CHAINING; FEW extensible intent-tools).
- Global ~/.config/opencode/skills/: create new skill "omo-ritual" (session-start ritual: read .omo/state.md → .omo/learnings.md → git status/log → read feature's .omo/plans/<slug>-design.md if touching a feature; WIP reconciliation gate before pivot; anti-drift rule: code wins, reconcile .omo/ first).
- Global ~/.config/opencode/: install opencode-hooks-api plugin in opencode.json. Create OMO-native hook scripts (command type) under ~/.config/opencode/hooks/:
  - typecheck.sh (PostToolUse Edit|Write, exit 2 block on .ts, universal)
  - secrets-guard.sh (PreToolUse Bash git*, blocks .env in git add/commit, universal)
  - omo-session-start.sh (SessionStart, injects ritual reminder pointing to .omo/state.md)
  - omo-wip-reconcile.sh (UserPromptSubmit or slash /hook-prompt, greps .omo/state.md for open WIP `[ ]/[~]`, warns before pivot)
  - omo-plan-after-exit.sh (PostToolUse or slash, reminds two-altitude plan: scaffold emits .omo/plans/<slug>.md, hand-append <slug>-design.md)
  - context7-reminder ELIMINATED (redundant with AGENTS.md global context7 block already injected every session)
- Two-altitude plan convention: document in global AGENTS.md + reinforce in omo-ritual skill; after scaffold, hand-append <slug>-design.md.
- Skill strengthening: add Iron Law preambles to OMO's programming + review-work + debugging skills (the editable user-side skill files, NOT the package-internal oh-my-openagent ones — verify which are user-editable).
- Vaio project-level: create .opencode/ directory in Vaio with:
  - .opencode/AGENTS.md encoding Vaio-tuned ritual (point to .omo/state.md + .omo/learnings.md + docs/SPEC.md, un-exclude CLAUDE.md so OMO can read Invariantes)
  - .omo/state.md seeded one-time from docs/NEXT-STEPS.md (ESTADO ACTUAL + WIP list + Historial)
  - .omo/learnings.md seeded one-time from docs/LEARNINGS.md
  - .opencode/hooks.json or reuse .claude/settings.json (plugin reads both) with Vaio-specific hook overrides if needed
- ulw-plan reinforcement: in global AGENTS.md, add rule "declare subagents-vs-direct choice explicitly + why" (already in skill, make it always-on).

## Scope OUT (Must NOT have)

- NO wholesale port of superpowers skills. No docs/superpowers/specs/ in OMO projects. No second plan dir.
- NO modification to oh-my-openagent package internals (scaffold-plan.mjs stays as-is). Iron Law preambles go ONLY in user-editable skill files (verify which).
- NO removal of Claude Code's workflow in Vaio (Claude can still be used; OMO coexists, uses .omo/ for its own state; Claude uses docs/).
- NO per-project opencode.json in Vaio (global config + project AGENTS.md is enough).
- NO migration of existing Vaio docs (NEXT-STEPS.md, LEARNINGS.md, SPEC.md, superpowers/specs/) — they stay for Claude; OMO uses .omo/ equivalents in parallel. Only one-time seed copy.
- NO new MCP servers. NO new plugins except opencode-hooks-api.
- NO Iron Law for skills that don't warrant it (ast-grep, lsp-setup, coding-agent-sessions, init-deep — utility skills stay procedural).
- NO context7-reminder hook (redundant with AGENTS.md global context7 block).

## Open questions (genuine forks — RESOLVED)

All 5 forks resolved by user:
- Fork 1: Equilibrium OMO-weighted ✓
- Fork 2: .omo/state.md + .omo/learnings.md, sembrados desde docs/ ✓ (git-trackable verified)
- Fork 3: Recrear todos los hooks OMO-nativos ✓ (typecheck+secrets verbatim universales, los demás recreados para .omo/, context7-reminder eliminado)
- Fork 4: Global + Vaio project-level override ✓
- Fork 5: Split — invariantes in AGENTS.md, ritual+state in skill ✓

## Approval gate
status: review-complete
<!-- All 5 forks resolved. Metis gaps addressed. High-accuracy review (Momus + Oracle) completed. 14 fixes applied (5 blockers, 5 majors, 4 minors). Plan ready for execution. Awaiting user /start-work. -->

### High-accuracy review receipts
- Momus (bg_3486117d): APPROVE_WITH_CHANGES — 2 blockers, 3 majors, 4 minors. All addressed.
- Oracle (bg_33b042ad): APPROVE_WITH_CHANGES — 3 blockers, 4 majors, 2 minors. All addressed.
- Combined deduplicated fix list (14 items): B1 scoped grep (awk), B2 3 waves, B3 dedup guard (typecheck+secrets), B4 YAML frontmatter (omo-ritual), B5 WIP gate into SessionStart, M6 JSON format+both paths, M7 project root detection, M8 per-event jq merge, M9 two-altitude blocking hook, M10 staleness mtime warning, m11 "1. " format, m12 restart note, m13 set -uo pipefail, m14 morph-compact verify.
- All fixes applied to .omo/plans/omo-agentic-dev-system.md.
