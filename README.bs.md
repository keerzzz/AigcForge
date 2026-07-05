<p align="center">
  <a href="https://aigcfroge.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Aigcfroge logo">
    </picture>
  </a>
</p>
<p align="center">Aigcfroge je open source AI agent za programiranje.</p>
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

### Instalacija

```bash
# YOLO
curl -fsSL https://aigcfroge.ai/install | bash

# Package manageri
npm i -g aigcfroge@latest        # ili bun/pnpm/yarn
scoop install aigcfroge             # Windows
choco install aigcfroge             # Windows
brew install anomalyco/tap/aigcfroge # macOS i Linux (preporučeno, uvijek ažurno)
brew install aigcfroge              # macOS i Linux (zvanična brew formula, rjeđe se ažurira)
sudo pacman -S aigcfroge            # Arch Linux (Stable)
paru -S aigcfroge-bin               # Arch Linux (Latest from AUR)
mise use -g aigcfroge               # Bilo koji OS
nix run nixpkgs#aigcfroge           # ili github:keerzzz/AigcForge za najnoviji dev branch
```

> [!TIP]
> Ukloni verzije starije od 0.1.x prije instalacije.

### Desktop aplikacija (BETA)

Aigcfroge je dostupan i kao desktop aplikacija. Preuzmi je direktno sa [stranice izdanja](https://github.com/keerzzz/AigcForge/releases) ili sa [aigcfroge.ai/download](https://aigcfroge.ai/download).

| Platforma             | Preuzimanje                        |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `aigcfroge-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `aigcfroge-desktop-mac-x64.dmg`     |
| Windows               | `aigcfroge-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, ili AppImage       |

```bash
# macOS (Homebrew)
brew install --cask aigcfroge-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/aigcfroge-desktop
```

#### Instalacijski direktorij

Instalacijska skripta koristi sljedeći redoslijed prioriteta za putanju instalacije:

1. `$AIGCFROGE_INSTALL_DIR` - Prilagođeni instalacijski direktorij
2. `$XDG_BIN_DIR` - Putanja usklađena sa XDG Base Directory specifikacijom
3. `$HOME/bin` - Standardni korisnički bin direktorij (ako postoji ili se može kreirati)
4. `$HOME/.aigcfroge/bin` - Podrazumijevana rezervna lokacija

```bash
# Primjeri
AIGCFROGE_INSTALL_DIR=/usr/local/bin curl -fsSL https://aigcfroge.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://aigcfroge.ai/install | bash
```

### Agenti

Aigcfroge uključuje dva ugrađena agenta između kojih možeš prebacivati tasterom `Tab`.

- **build** - Podrazumijevani agent sa punim pristupom za razvoj
- **plan** - Agent samo za čitanje za analizu i istraživanje koda
  - Podrazumijevano zabranjuje izmjene datoteka
  - Traži dozvolu prije pokretanja bash komandi
  - Idealan za istraživanje nepoznatih codebase-ova ili planiranje izmjena

Uključen je i **general** pod-agent za složene pretrage i višekoračne zadatke.
Koristi se interno i može se pozvati pomoću `@general` u porukama.

Saznaj više o [agentima](https://aigcfroge.ai/docs/agents).

### Dokumentacija

Za više informacija o konfiguraciji Aigcfroge-a, [**pogledaj dokumentaciju**](https://aigcfroge.ai/docs).

### Doprinosi

Ako želiš doprinositi Aigcfroge-u, pročitaj [upute za doprinošenje](./CONTRIBUTING.md) prije slanja pull requesta.

### Gradnja na Aigcfroge-u

Ako radiš na projektu koji je povezan s Aigcfroge-om i koristi "aigcfroge" kao dio naziva, npr. "aigcfroge-dashboard" ili "aigcfroge-mobile", dodaj napomenu u svoj README da projekat nije napravio Aigcfroge tim i da nije povezan s nama.

---

**Pridruži se našoj zajednici** [Discord](https://discord.gg/aigcfroge) | [X.com](https://x.com/aigcfroge)
