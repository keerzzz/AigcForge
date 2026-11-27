# Omnixa

<p align="center">開源的 AI Coding Agent。</p>

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

### 安裝

從目前檢出的原始碼建構 CLI 後，可安裝本機二進位檔：

```bash
./install --binary /absolute/path/to/omnixa
"$HOME/.omnixa/bin/omnixa" --version
```

安裝目錄為 `$HOME/.omnixa/bin`。遠端安裝與 CLI 自動升級需先設定有效的 `OMNIXA_UPDATE_URL`。

### 桌面應用程式

桌面發行檔的發布目標: [keerzzz/Omnixa](https://github.com/keerzzz/Omnixa/releases).

本機同源建構與打包方式: [packages/desktop/README.md](packages/desktop/README.md).

### Agents

Omnixa 內建了兩種 Agent，您可以使用 `Tab` 鍵快速切換。

- **build** - 預設模式，具備完整權限的 Agent，適用於開發工作。
- **plan** - 唯讀模式，適用於程式碼分析與探索。
  - 預設禁止修改檔案。
  - 執行 bash 指令前會詢問權限。
  - 非常適合用來探索陌生的程式碼庫或規劃變更。

此外，Omnixa 還包含一個 **general** 子 Agent，用於處理複雜搜尋與多步驟任務。此 Agent 供系統內部使用，亦可透過在訊息中輸入 `@general` 來呼叫。

了解更多關於 [Agents](packages/core/README.md) 的資訊。

### 線上文件

關於如何設定 Omnixa 的詳細資訊，請參閱我們的 [**官方文件**](specs/v2/README.md)。

### 參與貢獻

如果您有興趣參與 Omnixa 的開發，請在提交 Pull Request 前先閱讀我們的 [貢獻指南 (Contributing Docs)](./CONTRIBUTING.md)。

### 基於 Omnixa 進行開發

如果您正在開發與 Omnixa 相關的專案，並在名稱中使用了 "omnixa"（例如 "omnixa-dashboard" 或 "omnixa-mobile"），請在您的 README 中加入聲明，說明該專案並非由 Omnixa 團隊開發，且與我們沒有任何隸屬關係。

---

Based on [OpenCode](https://github.com/anomalyco/opencode), under the [MIT license](LICENSE).
