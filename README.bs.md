# Omnixa

<p align="center">Omnixa je open source AI agent za programiranje.</p>

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

### Instalacija

Instalirajte CLI binarni fajl lokalno izgrađen iz ovog repozitorija:

```bash
./install --binary /absolute/path/to/omnixa
"$HOME/.omnixa/bin/omnixa" --version
```

Instalacijski direktorij je `$HOME/.omnixa/bin`. Udaljena instalacija i automatske CLI nadogradnje zahtijevaju konfigurisan `OMNIXA_UPDATE_URL`.

### Desktop aplikacija

Odredište desktop izdanja: [keerzzz/Omnixa](https://github.com/keerzzz/Omnixa/releases).

Lokalna izgradnja i pakovanje iz istog izvora: [packages/desktop/README.md](packages/desktop/README.md).

### Agenti

Omnixa uključuje dva ugrađena agenta između kojih možeš prebacivati tasterom `Tab`.

- **build** - Podrazumijevani agent sa punim pristupom za razvoj
- **plan** - Agent samo za čitanje za analizu i istraživanje koda
  - Podrazumijevano zabranjuje izmjene datoteka
  - Traži dozvolu prije pokretanja bash komandi
  - Idealan za istraživanje nepoznatih codebase-ova ili planiranje izmjena

Uključen je i **general** pod-agent za složene pretrage i višekoračne zadatke.
Koristi se interno i može se pozvati pomoću `@general` u porukama.

Saznaj više o [agentima](packages/core/README.md).

### Dokumentacija

Za više informacija o konfiguraciji Omnixa-a, [**pogledaj dokumentaciju**](specs/v2/README.md).

### Doprinosi

Ako želiš doprinositi Omnixa-u, pročitaj [upute za doprinošenje](./CONTRIBUTING.md) prije slanja pull requesta.

### Gradnja na Omnixa-u

Ako radiš na projektu koji je povezan s Omnixa-om i koristi "omnixa" kao dio naziva, npr. "omnixa-dashboard" ili "omnixa-mobile", dodaj napomenu u svoj README da projekat nije napravio Omnixa tim i da nije povezan s nama.

---

Based on [OpenCode](https://github.com/anomalyco/opencode), under the [MIT license](LICENSE).
