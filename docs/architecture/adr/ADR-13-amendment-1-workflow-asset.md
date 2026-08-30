# ADR-13 Amendment 1: Workflow Asset Definition Ownership

> **Status:** Approved
> **Date:** 2026-07-27
> **Amends:** [ADR-13: Chat Work Mode Boundary](../ADR-13-chat-work-mode-boundary.md)

## Amendment

### §5a — Workflow Definition Ownership

Workflow **definitions** belong to Chat mode. The workflow asset is the 6th asset type
(`AssetKindId`) alongside prompt, skill, mcp, command, and agent, governed by the same
definition lifecycle:

- Creation, storage, browsing, and versioning happen within Chat mode's asset management
  framework.
- Workflow YAML files reside in `.aigcfroge/workflows/`, parallel to the other 5 asset
  directories.

### §5b — Workflow Execution Ownership

Workflow **execution** belongs to Work mode, deferred to the Work PRD phase. The execution
engine reads workflow definitions from the same `.aigcfroge/workflows/` directory but is
otherwise independent of Chat's asset layer.

File-system-level decoupling ensures:

- Chat writes `.yaml` definitions; Work reads them at execution time.
- No runtime dependency between the two modes for the definition path.
- Work mode can implement its own execution semantics (step scheduling, state persistence,
  error handling) without modifying Chat's asset pipeline.

### Affected Sections

This amendment modifies ADR-13 §5 ("冻结中的议题") by lifting the freeze on workflow
definition ownership. All other clauses of ADR-13 remain in full effect.

---

_Amendment approved alongside M5 Workflow Asset implementation plan._
