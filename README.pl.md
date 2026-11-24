# Omnixa

<p align="center">Otwartoźródłowy agent kodujący AI.</p>

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

### Instalacja

Zainstaluj plik binarny CLI zbudowany lokalnie z tego repozytorium:

```bash
./install --binary /absolute/path/to/omnixa
"$HOME/.omnixa/bin/omnixa" --version
```

Katalog instalacji to `$HOME/.omnixa/bin`. Instalacja zdalna i automatyczne aktualizacje CLI wymagają skonfigurowanego `OMNIXA_UPDATE_URL`.

### Aplikacja desktopowa

Miejsce publikacji wersji desktopowych: [keerzzz/AigcForge](https://github.com/keerzzz/AigcForge/releases).

Lokalne budowanie i pakowanie z tego samego źródła: [packages/desktop/README.md](packages/desktop/README.md).

### Agents

Omnixa zawiera dwóch wbudowanych agentów, między którymi możesz przełączać się klawiszem `Tab`.

- **build** - Domyślny agent z pełnym dostępem do pracy developerskiej
- **plan** - Agent tylko do odczytu do analizy i eksploracji kodu
  - Domyślnie odmawia edycji plików
  - Pyta o zgodę przed uruchomieniem komend bash
  - Idealny do poznawania nieznanych baz kodu lub planowania zmian

Dodatkowo jest subagent **general** do złożonych wyszukiwań i wieloetapowych zadań.
Jest używany wewnętrznie i można go wywołać w wiadomościach przez `@general`.

Dowiedz się więcej o [agents](packages/core/README.md).

### Dokumentacja

Więcej informacji o konfiguracji Omnixa znajdziesz w [**dokumentacji**](specs/v2/README.md).

### Współtworzenie

Jeśli chcesz współtworzyć Omnixa, przeczytaj [contributing docs](./CONTRIBUTING.md) przed wysłaniem pull requesta.

### Budowanie na Omnixa

Jeśli pracujesz nad projektem związanym z Omnixa i używasz "omnixa" jako części nazwy (na przykład "omnixa-dashboard" lub "omnixa-mobile"), dodaj proszę notatkę do swojego README, aby wyjaśnić, że projekt nie jest tworzony przez zespół Omnixa i nie jest z nami w żaden sposób powiązany.

---

Based on [OpenCode](https://github.com/anomalyco/opencode), under the [MIT license](LICENSE).
