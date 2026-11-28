# Omnixa

<p align="center">El agente de programación con IA de código abierto.</p>

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

### Instalación

Instala un binario CLI compilado localmente desde este repositorio:

```bash
./install --binary /absolute/path/to/omnixa
"$HOME/.omnixa/bin/omnixa" --version
```

El directorio de instalación es `$HOME/.omnixa/bin`. La instalación remota y las actualizaciones automáticas de la CLI requieren configurar `OMNIXA_UPDATE_URL`.

### App de escritorio

Destino de las versiones de escritorio: [keerzzz/Omnixa](https://github.com/keerzzz/Omnixa/releases).

Compilación y empaquetado local desde la misma fuente: [packages/desktop/README.md](packages/desktop/README.md).

### Agentes

Omnixa incluye dos agentes integrados que puedes alternar con la tecla `Tab`.

- **build** - Por defecto, agente con acceso completo para tareas de desarrollo
- **plan** - Agente de solo lectura para análisis y exploración de código
  - Deniega ediciones de archivos por defecto
  - Pide permiso antes de ejecutar comandos bash
  - Ideal para explorar codebases desconocidas o planificar cambios

Además, incluye un subagente **general** para búsquedas complejas y tareas de varios pasos.
Se usa internamente y se puede invocar con `@general` en los mensajes.

Más información sobre [agentes](packages/core/README.md).

### Documentación

Para más información sobre cómo configurar Omnixa, [**ve a nuestra documentación**](specs/v2/README.md).

### Contribuir

Si te interesa contribuir a Omnixa, lee nuestras [docs de contribución](./CONTRIBUTING.md) antes de enviar un pull request.

### Proyectos basados en Omnixa

Si estás trabajando en un proyecto basado en Omnixa y usas "omnixa" como parte del nombre, por ejemplo, "omnixa-dashboard" u "omnixa-mobile", agrega una nota en tu README para aclarar que no está hecho por el equipo de Omnixa y que no está afiliado con nosotros de ninguna manera.

---

Based on [OpenCode](https://github.com/anomalyco/opencode), under the [MIT license](LICENSE).
