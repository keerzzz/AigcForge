# Omnixa

<p align="center">เอเจนต์การเขียนโค้ดด้วย AI แบบโอเพนซอร์ส</p>

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

### การติดตั้ง

ติดตั้งไบนารี CLI ที่สร้างในเครื่องจากที่เก็บโค้ดนี้:

```bash
./install --binary /absolute/path/to/omnixa
"$HOME/.omnixa/bin/omnixa" --version
```

ไดเรกทอรีติดตั้งคือ `$HOME/.omnixa/bin` การติดตั้งระยะไกลและการอัปเกรด CLI อัตโนมัติต้องกำหนด `OMNIXA_UPDATE_URL` ที่ใช้งานได้

### แอปพลิเคชันเดสก์ท็อป

ปลายทางของรุ่นเดสก์ท็อป: [keerzzz/Omnixa](https://github.com/keerzzz/Omnixa/releases).

การสร้างและแพ็กเกจในเครื่องจากซอร์สเดียวกัน: [packages/desktop/README.md](packages/desktop/README.md).

### เอเจนต์

Omnixa รวมเอเจนต์ในตัวสองตัวที่คุณสามารถสลับได้ด้วยปุ่ม `Tab`

- **build** - เอเจนต์เริ่มต้น มีสิทธิ์เข้าถึงแบบเต็มสำหรับงานพัฒนา
- **plan** - เอเจนต์อ่านอย่างเดียวสำหรับการวิเคราะห์และการสำรวจโค้ด
  - ปฏิเสธการแก้ไขไฟล์โดยค่าเริ่มต้น
  - ขอสิทธิ์ก่อนเรียกใช้คำสั่ง bash
  - เหมาะสำหรับสำรวจโค้ดเบสที่ไม่คุ้นเคยหรือวางแผนการเปลี่ยนแปลง

นอกจากนี้ยังมีเอเจนต์ย่อย **general** สำหรับการค้นหาที่ซับซ้อนและงานหลายขั้นตอน
ใช้ภายในและสามารถเรียกใช้ได้โดยใช้ `@general` ในข้อความ

เรียนรู้เพิ่มเติมเกี่ยวกับ [เอเจนต์](packages/core/README.md)

### เอกสารประกอบ

สำหรับข้อมูลเพิ่มเติมเกี่ยวกับวิธีกำหนดค่า Omnixa [**ไปที่เอกสารของเรา**](specs/v2/README.md)

### การมีส่วนร่วม

หากคุณสนใจที่จะมีส่วนร่วมใน Omnixa โปรดอ่าน [เอกสารการมีส่วนร่วม](./CONTRIBUTING.md) ก่อนส่ง Pull Request

### การสร้างบน Omnixa

หากคุณทำงานในโปรเจกต์ที่เกี่ยวข้องกับ Omnixa และใช้ "omnixa" เป็นส่วนหนึ่งของชื่อ เช่น "omnixa-dashboard" หรือ "omnixa-mobile" โปรดเพิ่มหมายเหตุใน README ของคุณเพื่อชี้แจงว่าไม่ได้สร้างโดยทีม Omnixa และไม่ได้เกี่ยวข้องกับเราในทางใด

---

Based on [OpenCode](https://github.com/anomalyco/opencode), under the [MIT license](LICENSE).
