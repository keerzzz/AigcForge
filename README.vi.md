# Omnixa

<p align="center">Trợ lý lập trình AI mã nguồn mở.</p>

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

### Cài đặt

Cài đặt tệp nhị phân CLI được biên dịch cục bộ từ kho mã này:

```bash
./install --binary /absolute/path/to/omnixa
"$HOME/.omnixa/bin/omnixa" --version
```

Thư mục cài đặt là `$HOME/.omnixa/bin`. Cài đặt từ xa và tự động nâng cấp CLI cần cấu hình `OMNIXA_UPDATE_URL` hợp lệ.

### Ứng dụng Desktop

Đích phát hành ứng dụng desktop: [keerzzz/Omnixa](https://github.com/keerzzz/Omnixa/releases).

Biên dịch và đóng gói cục bộ từ cùng mã nguồn: [packages/desktop/README.md](packages/desktop/README.md).

### Agents (Đại diện)

Omnixa bao gồm hai agent được tích hợp sẵn mà bạn có thể chuyển đổi bằng phím `Tab`.

- **build** - Agent mặc định, có toàn quyền truy cập cho công việc lập trình
- **plan** - Agent chỉ đọc dùng để phân tích và khám phá mã nguồn
  - Mặc định từ chối việc chỉnh sửa tệp
  - Hỏi quyền trước khi chạy các lệnh bash
  - Lý tưởng để khám phá các codebase lạ hoặc lên kế hoạch thay đổi

Ngoài ra còn có một subagent **general** dùng cho các tìm kiếm phức tạp và tác vụ nhiều bước.
Agent này được sử dụng nội bộ và có thể gọi bằng cách dùng `@general` trong tin nhắn.

Tìm hiểu thêm về [agents](packages/core/README.md).

### Tài liệu

Để biết thêm thông tin về cách cấu hình Omnixa, [**hãy truy cập tài liệu của chúng tôi**](specs/v2/README.md).

### Đóng góp

Nếu bạn muốn đóng góp cho Omnixa, vui lòng đọc [tài liệu hướng dẫn đóng góp](./CONTRIBUTING.md) trước khi gửi pull request.

### Xây dựng trên nền tảng Omnixa

Nếu bạn đang làm việc trên một dự án liên quan đến Omnixa và sử dụng "omnixa" như một phần của tên dự án, ví dụ "omnixa-dashboard" hoặc "omnixa-mobile", vui lòng thêm một ghi chú vào README của bạn để làm rõ rằng dự án đó không được xây dựng bởi đội ngũ Omnixa và không liên kết với chúng tôi dưới bất kỳ hình thức nào.

---

Based on [OpenCode](https://github.com/anomalyco/opencode), under the [MIT license](LICENSE).
