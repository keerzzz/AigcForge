# Omnixa

<p align="center">オープンソースのAIコーディングエージェント。</p>

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

### インストール

このリポジトリからローカルでビルドした CLI バイナリをインストールします：

```bash
./install --binary /absolute/path/to/omnixa
"$HOME/.omnixa/bin/omnixa" --version
```

インストール先は `$HOME/.omnixa/bin` です。リモートインストールと CLI の自動更新には、有効な `OMNIXA_UPDATE_URL` の設定が必要です。

### デスクトップアプリ

デスクトップ版のリリース先: [keerzzz/AigcForge](https://github.com/keerzzz/AigcForge/releases).

同じソースからのローカルビルドとパッケージ作成: [packages/desktop/README.md](packages/desktop/README.md).

### Agents

Omnixa には組み込みの Agent が2つあり、`Tab` キーで切り替えられます。

- **build** - デフォルト。開発向けのフルアクセス Agent
- **plan** - 分析とコード探索向けの読み取り専用 Agent
  - デフォルトでファイル編集を拒否
  - bash コマンド実行前に確認
  - 未知のコードベース探索や変更計画に最適

また、複雑な検索やマルチステップのタスク向けに **general** サブ Agent も含まれています。
内部的に使用されており、メッセージで `@general` と入力して呼び出せます。

[agents](packages/core/README.md) の詳細はこちら。

### ドキュメント

Omnixa の設定については [**ドキュメント**](specs/v2/README.md) を参照してください。

### コントリビュート

Omnixa に貢献したい場合は、Pull Request を送る前に [contributing docs](./CONTRIBUTING.md) を読んでください。

### Omnixa の上に構築する

Omnixa に関連するプロジェクトで、名前に "omnixa"（例: "omnixa-dashboard" や "omnixa-mobile"）を含める場合は、そのプロジェクトが Omnixa チームによって作られたものではなく、いかなる形でも関係がないことを README に明記してください。

---

Based on [OpenCode](https://github.com/anomalyco/opencode), under the [MIT license](LICENSE).
