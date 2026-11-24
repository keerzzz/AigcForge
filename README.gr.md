# Omnixa

<p align="center">Ο πράκτορας τεχνητής νοημοσύνης ανοικτού κώδικα για προγραμματισμό.</p>

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

### Εγκατάσταση

Εγκαταστήστε ένα CLI binary που δημιουργήθηκε τοπικά από αυτό το αποθετήριο:

```bash
./install --binary /absolute/path/to/omnixa
"$HOME/.omnixa/bin/omnixa" --version
```

Ο κατάλογος εγκατάστασης είναι `$HOME/.omnixa/bin`. Η απομακρυσμένη εγκατάσταση και οι αυτόματες αναβαθμίσεις CLI απαιτούν ρυθμισμένο `OMNIXA_UPDATE_URL`.

### Εφαρμογή Desktop

Προορισμός εκδόσεων Desktop: [keerzzz/AigcForge](https://github.com/keerzzz/AigcForge/releases).

Τοπική δημιουργία και πακετάρισμα από τον ίδιο πηγαίο κώδικα: [packages/desktop/README.md](packages/desktop/README.md).

### Πράκτορες

Το Omnixa περιλαμβάνει δύο ενσωματωμένους πράκτορες μεταξύ των οποίων μπορείτε να εναλλάσσεστε με το πλήκτρο `Tab`.

- **build** - Προεπιλεγμένος πράκτορας με πλήρη πρόσβαση για εργασία πάνω σε κώδικα
- **plan** - Πράκτορας μόνο ανάγνωσης για ανάλυση και εξερεύνηση κώδικα
  - Αρνείται την επεξεργασία αρχείων από προεπιλογή
  - Ζητά άδεια πριν εκτελέσει εντολές bash
  - Ιδανικός για εξερεύνηση άγνωστων αρχείων πηγαίου κώδικα ή σχεδιασμό αλλαγών

Περιλαμβάνεται επίσης ένας **general** υποπράκτορας για σύνθετες αναζητήσεις και πολυβηματικές διεργασίες.
Χρησιμοποιείται εσωτερικά και μπορεί να κληθεί χρησιμοποιώντας `@general` στα μηνύματα.

Μάθετε περισσότερα για τους [πράκτορες](packages/core/README.md).

### Οδηγός Χρήσης

Για περισσότερες πληροφορίες σχετικά με τη ρύθμιση του Omnixa, [**πλοηγήσου στον οδηγό χρήσης μας**](specs/v2/README.md).

### Συνεισφορά

Εάν ενδιαφέρεσαι να συνεισφέρεις στο Omnixa, διαβάστε τα [οδηγό χρήσης συνεισφοράς](./CONTRIBUTING.md) πριν υποβάλεις ένα pull request.

### Δημιουργία πάνω στο Omnixa

Εάν εργάζεσαι σε ένα έργο σχετικό με το Omnixa και χρησιμοποιείτε το "omnixa" ως μέρος του ονόματός του, για παράδειγμα "omnixa-dashboard" ή "omnixa-mobile", πρόσθεσε μια σημείωση στο README σας για να διευκρινίσεις ότι δεν είναι κατασκευασμένο από την ομάδα του Omnixa και δεν έχει καμία σχέση με εμάς.

---

Based on [OpenCode](https://github.com/anomalyco/opencode), under the [MIT license](LICENSE).
