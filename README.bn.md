# Omnixa

<p align="center">ওপেন সোর্স এআই কোডিং এজেন্ট।</p>

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

### ইনস্টলেশন (Installation)

এই রিপোজিটরি থেকে স্থানীয়ভাবে তৈরি CLI বাইনারি ইনস্টল করুন:

```bash
./install --binary /absolute/path/to/omnixa
"$HOME/.omnixa/bin/omnixa" --version
```

ইনস্টলেশনের ডিরেক্টরি হলো `$HOME/.omnixa/bin`। দূরবর্তী ইনস্টলেশন ও স্বয়ংক্রিয় CLI আপগ্রেডের জন্য কার্যকর `OMNIXA_UPDATE_URL` কনফিগার করতে হবে।

### ডেস্কটপ অ্যাপ

ডেস্কটপ রিলিজের গন্তব্য: [keerzzz/Omnixa](https://github.com/keerzzz/Omnixa/releases).

একই সোর্স থেকে স্থানীয় বিল্ড ও প্যাকেজিং: [packages/desktop/README.md](packages/desktop/README.md).

### এজেন্টস (Agents)

Omnixa এ দুটি বিল্ট-ইন এজেন্ট রয়েছে যা আপনি `Tab` কি(key) দিয়ে পরিবর্তন করতে পারবেন।

- **build** - ডিফল্ট, ডেভেলপমেন্টের কাজের জন্য সম্পূর্ণ অ্যাক্সেসযুক্ত এজেন্ট
- **plan** - বিশ্লেষণ এবং কোড এক্সপ্লোরেশনের জন্য রিড-ওনলি এজেন্ট
  - ডিফল্টভাবে ফাইল এডিট করতে দেয় না
  - ব্যাশ কমান্ড চালানোর আগে অনুমতি চায়
  - অপরিচিত কোডবেস এক্সপ্লোর করা বা পরিবর্তনের পরিকল্পনা করার জন্য আদর্শ

এছাড়াও জটিল অনুসন্ধান এবং মাল্টিস্টেপ টাস্কের জন্য একটি **general** সাবএজেন্ট অন্তর্ভুক্ত রয়েছে।
এটি অভ্যন্তরীণভাবে ব্যবহৃত হয় এবং মেসেজে `@general` লিখে ব্যবহার করা যেতে পারে।

এজেন্টদের সম্পর্কে আরও জানুন: [docs](packages/core/README.md)।

### ডকুমেন্টেশন (Documentation)

কিভাবে Omnixa কনফিগার করবেন সে সম্পর্কে আরও তথ্যের জন্য, [**আমাদের ডকস দেখুন**](specs/v2/README.md)।

### অবদান (Contributing)

আপনি যদি Omnixa এ অবদান রাখতে চান, অনুগ্রহ করে একটি পুল রিকোয়েস্ট সাবমিট করার আগে আমাদের [কন্ট্রিবিউটিং ডকস](./CONTRIBUTING.md) পড়ে নিন।

### Omnixa এর উপর বিল্ডিং (Building on Omnixa)

আপনি যদি এমন প্রজেক্টে কাজ করেন যা Omnixa এর সাথে সম্পর্কিত এবং প্রজেক্টের নামের অংশ হিসেবে "omnixa" ব্যবহার করেন, উদাহরণস্বরূপ "omnixa-dashboard" বা "omnixa-mobile", তবে দয়া করে আপনার README তে একটি নোট যোগ করে স্পষ্ট করুন যে এই প্রজেক্টটি Omnixa দল দ্বারা তৈরি হয়নি এবং আমাদের সাথে এর কোনো সরাসরি সম্পর্ক নেই।

---

Based on [OpenCode](https://github.com/anomalyco/opencode), under the [MIT license](LICENSE).
