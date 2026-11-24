# Omnixa

<p align="center">L’agente di coding AI open source.</p>

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

### Installazione

Installa un binario CLI compilato localmente da questo repository:

```bash
./install --binary /absolute/path/to/omnixa
"$HOME/.omnixa/bin/omnixa" --version
```

La directory di installazione è `$HOME/.omnixa/bin`. L’installazione remota e gli aggiornamenti automatici della CLI richiedono un `OMNIXA_UPDATE_URL` configurato.

### App Desktop

Destinazione delle versioni desktop: [keerzzz/AigcForge](https://github.com/keerzzz/AigcForge/releases).

Build e pacchettizzazione locale dalla stessa sorgente: [packages/desktop/README.md](packages/desktop/README.md).

### Agenti

Omnixa include due agenti integrati tra cui puoi passare usando il tasto `Tab`.

- **build** – Predefinito, agente con accesso completo per il lavoro di sviluppo
- **plan** – Agente in sola lettura per analisi ed esplorazione del codice
  - Nega le modifiche ai file per impostazione predefinita
  - Chiede il permesso prima di eseguire comandi bash
  - Ideale per esplorare codebase sconosciute o pianificare modifiche

È inoltre incluso un sotto-agente **general** per ricerche complesse e attività multi-step.
Viene utilizzato internamente e può essere invocato usando `@general` nei messaggi.

Scopri di più sugli [agenti](packages/core/README.md).

### Documentazione

Per maggiori informazioni su come configurare Omnixa, [**consulta la nostra documentazione**](specs/v2/README.md).

### Contribuire

Se sei interessato a contribuire a Omnixa, leggi la nostra [guida alla contribuzione](./CONTRIBUTING.md) prima di inviare una pull request.

### Costruire su Omnixa

Se stai lavorando a un progetto correlato a Omnixa e che utilizza “omnixa” come parte del nome (ad esempio “omnixa-dashboard” o “omnixa-mobile”), aggiungi una nota nel tuo README per chiarire che non è sviluppato dal team Omnixa e che non è affiliato in alcun modo con noi.

---

Based on [OpenCode](https://github.com/anomalyco/opencode), under the [MIT license](LICENSE).
