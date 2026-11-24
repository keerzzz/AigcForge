# Omnixa

<p align="center">O agente de programação com IA de código aberto.</p>

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

### Instalação

Instale um binário CLI compilado localmente a partir deste repositório:

```bash
./install --binary /absolute/path/to/omnixa
"$HOME/.omnixa/bin/omnixa" --version
```

O diretório de instalação é `$HOME/.omnixa/bin`. A instalação remota e as atualizações automáticas da CLI exigem um `OMNIXA_UPDATE_URL` configurado.

### App desktop

Destino das versões desktop: [keerzzz/AigcForge](https://github.com/keerzzz/AigcForge/releases).

Compilação e empacotamento local da mesma fonte: [packages/desktop/README.md](packages/desktop/README.md).

### Agents

O Omnixa inclui dois agents integrados, que você pode alternar com a tecla `Tab`.

- **build** - Padrão, agent com acesso total para trabalho de desenvolvimento
- **plan** - Agent somente leitura para análise e exploração de código
  - Nega edições de arquivos por padrão
  - Pede permissão antes de executar comandos bash
  - Ideal para explorar codebases desconhecidas ou planejar mudanças

Também há um subagent **general** para buscas complexas e tarefas em várias etapas.
Ele é usado internamente e pode ser invocado com `@general` nas mensagens.

Saiba mais sobre [agents](packages/core/README.md).

### Documentação

Para mais informações sobre como configurar o Omnixa, [**veja nossa documentação**](specs/v2/README.md).

### Contribuir

Se você tem interesse em contribuir com o Omnixa, leia os [contributing docs](./CONTRIBUTING.md) antes de enviar um pull request.

### Construindo com Omnixa

Se você estiver trabalhando em um projeto relacionado ao Omnixa e estiver usando "omnixa" como parte do nome (por exemplo, "omnixa-dashboard" ou "omnixa-mobile"), adicione uma nota no README para deixar claro que não foi construído pela equipe do Omnixa e não é afiliado a nós de nenhuma forma.

---

Based on [OpenCode](https://github.com/anomalyco/opencode), under the [MIT license](LICENSE).
