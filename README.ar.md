# Omnixa

<p align="center">وكيل برمجة بالذكاء الاصطناعي مفتوح المصدر.</p>

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

### التثبيت

ثبّت ملف CLI مبنيًا محليًا من هذا المستودع:

```bash
./install --binary /absolute/path/to/omnixa
"$HOME/.omnixa/bin/omnixa" --version
```

مجلد التثبيت هو `$HOME/.omnixa/bin`. يتطلب التثبيت عن بُعد والترقية التلقائية إعداد `OMNIXA_UPDATE_URL` صالح.

### تطبيق سطح المكتب

وجهة إصدارات تطبيق سطح المكتب: [keerzzz/AigcForge](https://github.com/keerzzz/AigcForge/releases).

البناء المحلي والحزم من المصدر نفسه: [packages/desktop/README.md](packages/desktop/README.md).

### Agents

يتضمن Omnixa وكيليْن (Agents) مدمجين يمكنك التبديل بينهما باستخدام زر `Tab`.

- **build** - الافتراضي، وكيل بصلاحيات كاملة لاعمال التطوير
- **plan** - وكيل للقراءة فقط للتحليل واستكشاف الكود
  - يرفض تعديل الملفات افتراضيا
  - يطلب الاذن قبل تشغيل اوامر bash
  - مثالي لاستكشاف قواعد كود غير مألوفة او لتخطيط التغييرات

بالاضافة الى ذلك يوجد وكيل فرعي **general** للبحث المعقد والمهام متعددة الخطوات.
يستخدم داخليا ويمكن استدعاؤه بكتابة `@general` في الرسائل.

تعرف على المزيد حول [agents](packages/core/README.md).

### التوثيق

لمزيد من المعلومات حول كيفية ضبط Omnixa، [**راجع التوثيق**](specs/v2/README.md).

### المساهمة

اذا كنت مهتما بالمساهمة في Omnixa، يرجى قراءة [contributing docs](./CONTRIBUTING.md) قبل ارسال pull request.

### البناء فوق Omnixa

اذا كنت تعمل على مشروع مرتبط بـ Omnixa ويستخدم "omnixa" كجزء من اسمه (مثل "omnixa-dashboard" او "omnixa-mobile")، يرجى اضافة ملاحظة في README توضح انه ليس مبنيا بواسطة فريق Omnixa ولا يرتبط بنا بأي شكل.

---

Based on [OpenCode](https://github.com/anomalyco/opencode), under the [MIT license](LICENSE).
