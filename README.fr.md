# Omnixa

<p align="center">L'agent de codage IA open source.</p>

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

Installez un binaire CLI compilé localement à partir de ce dépôt :

```bash
./install --binary /absolute/path/to/omnixa
"$HOME/.omnixa/bin/omnixa" --version
```

Le répertoire d’installation est `$HOME/.omnixa/bin`. L’installation à distance et les mises à jour automatiques de la CLI nécessitent un `OMNIXA_UPDATE_URL` configuré.

### Application de bureau

Destination des versions de bureau: [keerzzz/Omnixa](https://github.com/keerzzz/Omnixa/releases).

Compilation et empaquetage local depuis la même source: [packages/desktop/README.md](packages/desktop/README.md).

### Agents

Omnixa inclut deux agents intégrés que vous pouvez basculer avec la touche `Tab`.

- **build** - Par défaut, agent avec accès complet pour le travail de développement
- **plan** - Agent en lecture seule pour l'analyse et l'exploration du code
  - Refuse les modifications de fichiers par défaut
  - Demande l'autorisation avant d'exécuter des commandes bash
  - Idéal pour explorer une base de code inconnue ou planifier des changements

Un sous-agent **general** est aussi inclus pour les recherches complexes et les tâches en plusieurs étapes.
Il est utilisé en interne et peut être invoqué via `@general` dans les messages.

En savoir plus sur les [agents](packages/core/README.md).

### Documentation

Pour plus d'informations sur la configuration d'Omnixa, [**consultez notre documentation**](specs/v2/README.md).

### Contribuer

Si vous souhaitez contribuer à Omnixa, lisez nos [docs de contribution](./CONTRIBUTING.md) avant de soumettre une pull request.

### Construire avec Omnixa

Si vous travaillez sur un projet lié à Omnixa et que vous utilisez "omnixa" dans le nom du projet (par exemple, "omnixa-dashboard" ou "omnixa-mobile"), ajoutez une note dans votre README pour préciser qu'il n'est pas construit par l'équipe Omnixa et qu'il n'est pas affilié à nous.

---

Based on [OpenCode](https://github.com/anomalyco/opencode), under the [MIT license](LICENSE).
