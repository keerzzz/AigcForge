# Omnixa

<p align="center">AI-агент для програмування з відкритим кодом.</p>

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

### Встановлення

Установіть CLI-бінарник, зібраний локально з цього репозиторію:

```bash
./install --binary /absolute/path/to/omnixa
"$HOME/.omnixa/bin/omnixa" --version
```

Каталог установлення — `$HOME/.omnixa/bin`. Віддалене встановлення та автоматичне оновлення CLI потребують налаштованого `OMNIXA_UPDATE_URL`.

### Десктопний застосунок

Місце публікації десктопних випусків: [keerzzz/Omnixa](https://github.com/keerzzz/Omnixa/releases).

Локальне збирання й пакування з того самого джерела: [packages/desktop/README.md](packages/desktop/README.md).

### Агенти

Omnixa містить два вбудовані агенти, між якими можна перемикатися клавішею `Tab`.

- **build** - Агент за замовчуванням із повним доступом для завдань розробки
- **plan** - Агент лише для читання для аналізу та дослідження коду
  - За замовчуванням забороняє редагування файлів
  - Запитує дозвіл перед запуском bash-команд
  - Ідеально підходить для дослідження незнайомих кодових баз або планування змін

Також доступний допоміжний агент **general** для складного пошуку та багатокрокових завдань.
Він використовується всередині системи й може бути викликаний у повідомленнях через `@general`.

Дізнайтеся більше про [agents](packages/core/README.md).

### Документація

Щоб дізнатися більше про налаштування Omnixa, [**перейдіть до нашої документації**](specs/v2/README.md).

### Внесок

Якщо ви хочете зробити внесок в Omnixa, будь ласка, прочитайте нашу [документацію для контриб'юторів](./CONTRIBUTING.md) перед надсиланням pull request.

### Проєкти на базі Omnixa

Якщо ви працюєте над проєктом, пов'язаним з Omnixa, і використовуєте "omnixa" у назві, наприклад "omnixa-dashboard" або "omnixa-mobile", додайте примітку до свого README.
Уточніть, що цей проєкт не створений командою Omnixa і жодним чином не афілійований із нами.

---

Based on [OpenCode](https://github.com/anomalyco/opencode), under the [MIT license](LICENSE).
