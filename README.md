<p align="center">
  <a href="https://aigcfroge.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Aigcfroge logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent.</p>
<p align="center">
  <a href="https://aigcfroge.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/aigcfroge"><img alt="npm" src="https://img.shields.io/npm/v/aigcfroge?style=flat-square" /></a>
  <a href="https://github.com/keerzzz/AigcForge/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/keerzzz/AigcForge/publish.yml?style=flat-square&branch=dev" /></a>
</p>

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

[![Aigcfroge Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://aigcfroge.ai)

---

### Installation

```bash
# YOLO
curl -fsSL https://aigcfroge.ai/install | bash

# Package managers
npm i -g aigcfroge@latest        # or bun/pnpm/yarn
scoop install aigcfroge             # Windows
choco install aigcfroge             # Windows
brew install anomalyco/tap/aigcfroge # macOS and Linux (recommended, always up to date)
brew install aigcfroge              # macOS and Linux (official brew formula, updated less)
sudo pacman -S aigcfroge            # Arch Linux (Stable)
paru -S aigcfroge-bin               # Arch Linux (Latest from AUR)
mise use -g aigcfroge               # Any OS
nix run nixpkgs#aigcfroge           # or github:keerzzz/AigcForge for latest dev branch
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (BETA)

Aigcfroge is also available as a desktop application. Download directly from the [releases page](https://github.com/keerzzz/AigcForge/releases) or [aigcfroge.ai/download](https://aigcfroge.ai/download).

| Platform              | Download                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `aigcfroge-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `aigcfroge-desktop-mac-x64.dmg`     |
| Windows               | `aigcfroge-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, or `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask aigcfroge-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/aigcfroge-desktop
```

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$AIGCFROGE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.aigcfroge/bin` - Default fallback

```bash
# Examples
AIGCFROGE_INSTALL_DIR=/usr/local/bin curl -fsSL https://aigcfroge.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://aigcfroge.ai/install | bash
```

### Agents

Aigcfroge includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://aigcfroge.ai/docs/agents).

### Documentation

For more info on how to configure Aigcfroge, [**head over to our docs**](https://aigcfroge.ai/docs).

### Contributing

If you're interested in contributing to Aigcfroge, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on Aigcfroge

If you are working on a project that's related to Aigcfroge and is using "aigcfroge" as part of its name, for example "aigcfroge-dashboard" or "aigcfroge-mobile", please add a note to your README to clarify that it is not built by the Aigcfroge team and is not affiliated with us in any way.

---

**Join our community** [Discord](https://discord.gg/aigcfroge) | [X.com](https://x.com/aigcfroge)
