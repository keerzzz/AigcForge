# Omnixa

<p align="center">Открытый AI-агент для программирования.</p>

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

### Установка

Установите CLI-бинарник, собранный локально из этого репозитория:

```bash
./install --binary /absolute/path/to/omnixa
"$HOME/.omnixa/bin/omnixa" --version
```

Каталог установки — `$HOME/.omnixa/bin`. Удалённая установка и автоматическое обновление CLI требуют настроенного `OMNIXA_UPDATE_URL`.

### Десктопное приложение

Место публикации десктопных выпусков: [keerzzz/AigcForge](https://github.com/keerzzz/AigcForge/releases).

Локальная сборка и упаковка из того же исходного кода: [packages/desktop/README.md](packages/desktop/README.md).

### Agents

В Omnixa есть два встроенных агента, между которыми можно переключаться клавишей `Tab`.

- **build** - По умолчанию, агент с полным доступом для разработки
- **plan** - Агент только для чтения для анализа и изучения кода
  - По умолчанию запрещает редактирование файлов
  - Запрашивает разрешение перед выполнением bash-команд
  - Идеален для изучения незнакомых кодовых баз или планирования изменений

Также включен сабагент **general** для сложных поисков и многошаговых задач.
Он используется внутренне и может быть вызван в сообщениях через `@general`.

Подробнее об [agents](packages/core/README.md).

### Документация

Больше информации о том, как настроить Omnixa: [**наши docs**](specs/v2/README.md).

### Вклад

Если вы хотите внести вклад в Omnixa, прочитайте [contributing docs](./CONTRIBUTING.md) перед тем, как отправлять pull request.

### Разработка на базе Omnixa

Если вы делаете проект, связанный с Omnixa, и используете "omnixa" как часть имени (например, "omnixa-dashboard" или "omnixa-mobile"), добавьте примечание в README, чтобы уточнить, что проект не создан командой Omnixa и не аффилирован с нами.

---

Based on [OpenCode](https://github.com/anomalyco/opencode), under the [MIT license](LICENSE).
