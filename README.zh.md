# Omnixa

<p align="center">开源的 AI Coding Agent。</p>

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

### 安装

从当前检出的源码构建 CLI 后，可安装本地二进制：

```bash
./install --binary /absolute/path/to/omnixa
"$HOME/.omnixa/bin/omnixa" --version
```

安装目录为 `$HOME/.omnixa/bin`。远端安装和 CLI 自动升级需先配置有效的 `OMNIXA_UPDATE_URL`。

### 桌面应用程序

桌面发行资产的发布目标: [keerzzz/AigcForge](https://github.com/keerzzz/AigcForge/releases).

本地同源构建与打包方式: [packages/desktop/README.md](packages/desktop/README.md).

### Agents

Omnixa 内置两种 Agent，可用 `Tab` 键快速切换：

- **build** - 默认模式，具备完整权限，适合开发工作
- **plan** - 只读模式，适合代码分析与探索
  - 默认拒绝修改文件
  - 运行 bash 命令前会询问
  - 便于探索未知代码库或规划改动

另外还包含一个 **general** 子 Agent，用于复杂搜索和多步任务，内部使用，也可在消息中输入 `@general` 调用。

了解更多 [Agents](packages/core/README.md) 相关信息。

### 文档

更多配置说明请查看我们的 [**官方文档**](specs/v2/README.md)。

### 参与贡献

如有兴趣贡献代码，请在提交 PR 前阅读 [贡献指南 (Contributing Docs)](./CONTRIBUTING.md)。

### 基于 Omnixa 进行开发

如果你在项目名中使用了 “omnixa”（如 “omnixa-dashboard” 或 “omnixa-mobile”），请在 README 里注明该项目不是 Omnixa 团队官方开发，且不存在隶属关系。

---

Based on [OpenCode](https://github.com/anomalyco/opencode), under the [MIT license](LICENSE).
