---
description: "Generate release notes"
---

Create `UPCOMING_CHANGELOG.md` from the structured changelog input below.
If `UPCOMING_CHANGELOG.md` already exists, ignore its current contents completely.
Do not preserve, merge, or reuse text from the existing file.

The input already contains the exact commit range since the last non-draft release.
The commits are already filtered to the release-relevant packages and grouped into
the release sections. Do not fetch GitHub releases, PRs, or build your own commit list.
The input may also include a `## Community Contributors Input` section.

Before writing any entry you keep, inspect the real diff with
`git show --stat --format='' <hash>` or `git show --format='' <hash>` so you can
understand the actual code changes and not just the commit message (they may be misleading).
Do not use `git log` or author metadata when deciding attribution.

Rules:

- Use `.github/RELEASE_NOTES_TEMPLATE.md` as the structural template.
- Write both `## English` and `## 中文` sections in that order. Keep both languages complete and equivalent.
- Within each language, keep release sections in this order:
  `Core`, `TUI`, `Desktop`, `SDK`, `Extensions`
  For Chinese headings use exactly: `核心`, `TUI`, `桌面端`, `SDK`, `扩展`
- Within each release section, keep bug fixes under `#### Bug Fixes` / `#### 修复`
- Keep other notable entries under `#### Improvements` / `#### 改进` when a section has bug fixes too
- Only include sections and subsections that have at least one notable entry
- Keep one bullet per commit you keep
- Skip commits that are entirely internal, CI, tests, refactors, or otherwise not user-facing
- Start each English bullet with a capital letter
- Prefer what changed for users over what code changed internally
- Do not copy raw commit prefixes like `fix:` or `feat:` or trailing PR numbers like `(#123)`
- Keep the same set of bullets and the same order in both languages
- Do not translate code identifiers, file paths, provider/model IDs, or contributor handles
- Community attribution is deterministic: only preserve an existing `(@username)` suffix from the changelog input
- If an input bullet has no `(@username)` suffix, do not add one
- Never add a new `(@username)` suffix from `git show`, commit authors, names, or email addresses
- If no notable entries remain and there is no contributor block, write `No notable changes.` under English and `无重要变更。` under 中文, and leave the language sections otherwise empty
- If no notable entries remain but there is a contributor block, keep the `## English` and `## 中文` headings, omit release sections, and append the contributor block once at the end
- If the input contains `## Community Contributors Input`, append the block below that heading to the end of the final file verbatim
- Do not add, remove, rewrite, or reorder contributor names or commit titles in that block
- Do not derive the thank-you section from the main summary bullets
- Do not include the heading `## Community Contributors Input` in the final file
- Focus on writing the least words to get your point across - users will skim read the changelog, so we should be precise

**Importantly, the changelog is for users (who are at least slightly technical), they may use the TUI, Desktop, SDK, Plugins and so forth. Be thorough in understanding flow on effects may not be immediately apparent. e.g. a package upgrade looks internal but may patch a bug. Or a refactor may also stabilise some race condition that fixes bugs for users. The PR title/body + commit message will give you the authors context, usually containing the outcome not just technical detail**

<changelog_input>

!`bun script/raw-changelog.ts $ARGUMENTS`

</changelog_input>
