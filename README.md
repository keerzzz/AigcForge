# Omnixa

<p align="center">The open source AI coding agent.</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

---

### Installation

Install a locally built CLI binary from this checkout:

```bash
./install --binary /absolute/path/to/omnixa
"$HOME/.omnixa/bin/omnixa" --version
```

The installation directory is `$HOME/.omnixa/bin`. Remote installation and automatic CLI upgrades require a configured `OMNIXA_UPDATE_URL`.

### Desktop App

Desktop release destination: [keerzzz/AigcForge](https://github.com/keerzzz/AigcForge/releases).

Same-source local build and packaging: [packages/desktop/README.md](packages/desktop/README.md).

### Agents

Omnixa includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](packages/core/README.md).

### Documentation

For more info on how to configure Omnixa, [**head over to our docs**](specs/v2/README.md).

### Contributing

If you're interested in contributing to Omnixa, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on Omnixa

If you are working on a project that's related to Omnixa and is using "omnixa" as part of its name, for example "omnixa-dashboard" or "omnixa-mobile", please add a note to your README to clarify that it is not built by the Omnixa team and is not affiliated with us in any way.

---

Based on [OpenCode](https://github.com/anomalyco/opencode), under the [MIT license](LICENSE).
