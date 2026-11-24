# Omnixa

<p align="center">AI-kodeagent med åpen kildekode.</p>

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

### Installasjon

Installer en CLI-binærfil bygget lokalt fra dette repositoryet:

```bash
./install --binary /absolute/path/to/omnixa
"$HOME/.omnixa/bin/omnixa" --version
```

Installasjonsmappen er `$HOME/.omnixa/bin`. Fjerninstallasjon og automatiske CLI-oppgraderinger krever en konfigurert `OMNIXA_UPDATE_URL`.

### Desktop-app

Mål for desktoputgivelser: [keerzzz/AigcForge](https://github.com/keerzzz/AigcForge/releases).

Lokal bygging og pakking fra samme kilde: [packages/desktop/README.md](packages/desktop/README.md).

### Agents

Omnixa har to innebygde agents du kan bytte mellom med `Tab`-tasten.

- **build** - Standard, agent med full tilgang for utviklingsarbeid
- **plan** - Skrivebeskyttet agent for analyse og kodeutforsking
  - Nekter filendringer som standard
  - Spør om tillatelse før bash-kommandoer
  - Ideell for å utforske ukjente kodebaser eller planlegge endringer

Det finnes også en **general**-subagent for komplekse søk og flertrinnsoppgaver.
Den brukes internt og kan kalles via `@general` i meldinger.

Les mer om [agents](packages/core/README.md).

### Dokumentasjon

For mer info om hvordan du konfigurerer Omnixa, [**se dokumentasjonen**](specs/v2/README.md).

### Bidra

Hvis du vil bidra til Omnixa, les [contributing docs](./CONTRIBUTING.md) før du sender en pull request.

### Bygge på Omnixa

Hvis du jobber med et prosjekt som er relatert til Omnixa og bruker "omnixa" som en del av navnet; for eksempel "omnixa-dashboard" eller "omnixa-mobile", legg inn en merknad i README som presiserer at det ikke er bygget av Omnixa-teamet og ikke er tilknyttet oss på noen måte.

---

Based on [OpenCode](https://github.com/anomalyco/opencode), under the [MIT license](LICENSE).
