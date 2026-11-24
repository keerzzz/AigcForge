# Omnixa

<p align="center">Der Open-Source KI-Coding-Agent.</p>

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

Installiere eine lokal aus diesem Repository erstellte CLI-Binärdatei:

```bash
./install --binary /absolute/path/to/omnixa
"$HOME/.omnixa/bin/omnixa" --version
```

Das Installationsverzeichnis ist `$HOME/.omnixa/bin`. Remote-Installation und automatische CLI-Updates erfordern eine konfigurierte `OMNIXA_UPDATE_URL`.

### Desktop-App

Ziel für Desktop-Releases: [keerzzz/AigcForge](https://github.com/keerzzz/AigcForge/releases).

Lokaler Build und Paketierung aus derselben Quelle: [packages/desktop/README.md](packages/desktop/README.md).

### Agents

Omnixa enthält zwei eingebaute Agents, zwischen denen du mit der `Tab`-Taste wechseln kannst.

- **build** - Standard-Agent mit vollem Zugriff für Entwicklungsarbeit
- **plan** - Nur-Lese-Agent für Analyse und Code-Exploration
  - Verweigert Datei-Edits standardmäßig
  - Fragt vor dem Ausführen von bash-Befehlen nach
  - Ideal zum Erkunden unbekannter Codebases oder zum Planen von Änderungen

Außerdem ist ein **general**-Subagent für komplexe Suchen und mehrstufige Aufgaben enthalten.
Dieser wird intern genutzt und kann in Nachrichten mit `@general` aufgerufen werden.

Mehr dazu unter [Agents](packages/core/README.md).

### Dokumentation

Mehr Infos zur Konfiguration von Omnixa findest du in unseren [**Docs**](specs/v2/README.md).

### Beitragen

Wenn du zu Omnixa beitragen möchtest, lies bitte unsere [Contributing Docs](./CONTRIBUTING.md), bevor du einen Pull Request einreichst.

### Auf Omnixa aufbauen

Wenn du an einem Projekt arbeitest, das mit Omnixa zusammenhängt und "omnixa" als Teil seines Namens verwendet (z.B. "omnixa-dashboard" oder "omnixa-mobile"), füge bitte einen Hinweis in deine README ein, dass es nicht vom Omnixa-Team gebaut wird und nicht in irgendeiner Weise mit uns verbunden ist.

---

Based on [OpenCode](https://github.com/anomalyco/opencode), under the [MIT license](LICENSE).
