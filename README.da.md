# Omnixa

<p align="center">Den open source AI-kodeagent.</p>

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

Installer en CLI-binærfil bygget lokalt fra dette repository:

```bash
./install --binary /absolute/path/to/omnixa
"$HOME/.omnixa/bin/omnixa" --version
```

Installationsmappen er `$HOME/.omnixa/bin`. Fjerninstallation og automatiske CLI-opgraderinger kræver en konfigureret `OMNIXA_UPDATE_URL`.

### Desktop-app

Destination for desktopudgivelser: [keerzzz/Omnixa](https://github.com/keerzzz/Omnixa/releases).

Lokal bygning og pakning fra samme kilde: [packages/desktop/README.md](packages/desktop/README.md).

### Agents

Omnixa har to indbyggede agents, som du kan skifte mellem med `Tab`-tasten.

- **build** - Standard, agent med fuld adgang til udviklingsarbejde
- **plan** - Skrivebeskyttet agent til analyse og kodeudforskning
  - Afviser filredigering som standard
  - Spørger om tilladelse før bash-kommandoer
  - Ideel til at udforske ukendte kodebaser eller planlægge ændringer

Derudover findes der en **general**-subagent til komplekse søgninger og flertrinsopgaver.
Den bruges internt og kan kaldes via `@general` i beskeder.

Læs mere om [agents](packages/core/README.md).

### Dokumentation

For mere info om konfiguration af Omnixa, [**se vores docs**](specs/v2/README.md).

### Bidrag

Hvis du vil bidrage til Omnixa, så læs vores [contributing docs](./CONTRIBUTING.md) før du sender en pull request.

### Bygget på Omnixa

Hvis du arbejder på et projekt der er relateret til Omnixa og bruger "omnixa" som en del af navnet; f.eks. "omnixa-dashboard" eller "omnixa-mobile", så tilføj en note i din README, der tydeliggør at projektet ikke er bygget af Omnixa-teamet og ikke er tilknyttet os på nogen måde.

---

Based on [OpenCode](https://github.com/anomalyco/opencode), under the [MIT license](LICENSE).
