# Omnixa

<p align="center">Açık kaynaklı yapay zeka kodlama asistanı.</p>

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

### Kurulum

Bu depodan yerel olarak derlenmiş bir CLI ikili dosyasını kurun:

```bash
./install --binary /absolute/path/to/omnixa
"$HOME/.omnixa/bin/omnixa" --version
```

Kurulum dizini `$HOME/.omnixa/bin` şeklindedir. Uzaktan kurulum ve otomatik CLI yükseltmeleri için geçerli bir `OMNIXA_UPDATE_URL` yapılandırılmalıdır.

### Masaüstü Uygulaması

Masaüstü sürümlerinin yayın hedefi: [keerzzz/Omnixa](https://github.com/keerzzz/Omnixa/releases).

Aynı kaynaktan yerel derleme ve paketleme: [packages/desktop/README.md](packages/desktop/README.md).

### Ajanlar

Omnixa, `Tab` tuşuyla aralarında geçiş yapabileceğiniz iki yerleşik (built-in) ajan içerir.

- **build** - Varsayılan, geliştirme çalışmaları için tam erişimli ajan
- **plan** - Analiz ve kod keşfi için salt okunur ajan
  - Varsayılan olarak dosya düzenlemelerini reddeder
  - Bash komutlarını çalıştırmadan önce izin ister
  - Tanımadığınız kod tabanlarını keşfetmek veya değişiklikleri planlamak için ideal

Ayrıca, karmaşık aramalar ve çok adımlı görevler için bir **genel** alt ajan bulunmaktadır.
Bu dahili olarak kullanılır ve mesajlarda `@general` ile çağrılabilir.

[Ajanlar](packages/core/README.md) hakkında daha fazla bilgi edinin.

### Dokümantasyon

Omnixa'u nasıl yapılandıracağınız hakkında daha fazla bilgi için [**dokümantasyonumuza göz atın**](specs/v2/README.md).

### Katkıda Bulunma

Omnixa'a katkıda bulunmak istiyorsanız, lütfen bir pull request göndermeden önce [katkıda bulunma dokümanlarımızı](./CONTRIBUTING.md) okuyun.

### Omnixa Üzerine Geliştirme

Omnixa ile ilgili bir proje üzerinde çalışıyorsanız ve projenizin adının bir parçası olarak "omnixa" kullanıyorsanız (örneğin, "omnixa-dashboard" veya "omnixa-mobile"), lütfen README dosyanıza projenin Omnixa ekibi tarafından geliştirilmediğini ve bizimle hiçbir şekilde bağlantılı olmadığını belirten bir not ekleyin.

---

Based on [OpenCode](https://github.com/anomalyco/opencode), under the [MIT license](LICENSE).
