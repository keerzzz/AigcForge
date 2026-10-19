# Agent interaction delivery evidence

Captured on 2026-10-19 after integrating `origin/main` into `agent-ui-tdd`.

- `task-history.png`: E3 browser fixture. Current Task progress is complete; the expanded historical `todowrite` invocation retains its original pending snapshot and exposes no edit controls.
- `assistant-shell.png`: E4 production build with a real isolated backend and SQLite. The browser submits `echo E4_SHELL_RESULT` through canonical admission and displays its output after reload.

The E4 provider is a deterministic loopback fixture. These images do not establish external model, OAuth, or installed desktop compatibility. Raw local commands, exit codes, screenshots, runtime cleanup reports and performance traces are indexed in `/home/keer/.codex/artifacts/agent-ui-tdd-remediation-20261019/`.
