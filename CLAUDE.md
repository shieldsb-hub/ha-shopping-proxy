<!-- project-type: code-spoke | family: ha | hub: ha-platform -->
# `ha-shopping-proxy` — Claude instructions

**Type:** `code-spoke` of the **ha** family. Hub: [`ha-platform`](../ha-platform/).

User-level `~/.claude/CLAUDE.md` defaults apply. This file binds the repo to the
family discipline; it deliberately does not restate it.

## Read before acting

The discipline lives in the hub. Read it there; don't duplicate it here.

- [`ha-platform/DOC_STRATEGY.md`](../ha-platform/DOC_STRATEGY.md) — doc types, where each lives, maintenance contracts.
- [`ha-platform/CONVENTIONS.md`](../ha-platform/CONVENTIONS.md) — repo layout, naming, deploy patterns.
- [`ha-platform/PROJECTS.md`](../ha-platform/PROJECTS.md) — what this repo owns and how it relates to siblings.
- [`ha-zwave/STATUS.md`](../ha-zwave/STATUS.md) — **two Z-Wave controllers/meshes** (Yubii HC3 `fibaro` + Pi `zwave_js`) since the HC2 died; the Yubii backup-restore left ghost entities with frozen state. Check which controller owns a device before diagnosing a "misbehaving" Z-Wave entity. The split is **interim** — end state is all nodes centralised on the Yubii (Phase B, `ha-zwave/TODO.md`, as time allows).

This repo's own current state is in [`STATUS.md`](STATUS.md) (when present); its
design and rationale in [`BRIEFING.md`](BRIEFING.md).

## Secrets

Canonical in `ha-platform/secrets/`, symlinked in as `.env` and `.ssh`. Never
read, print, or echo their values; path references are fine.

## Flag inconsistencies — don't paper over them

This stub was added when the family adopted the hub-and-spoke discipline.
Pre-existing docs and conventions in this repo were **not** rewritten to match.
If something here contradicts the hub — a naming rule, a doc of the wrong type,
a fact that should live in one canonical place, a stale or 404 link — surface it
to me rather than silently conforming or duplicating. Preserve the knowledge
that is already here; relocating or retyping it is a decision to make together,
not a silent cleanup.
