# Marka varlıkları

Bu klasör **uygulamaya girmiyor**. İçindekiler yalnızca ikon üretilirken
(`tests/make-icon.py`) kullanılıyor; APK'ya giden şey üretilen PNG'ler.

## Poppins-Bold.ttf

KaSa kelime markasının yazı tipi. SIL Open Font License 1.1 — ticari kullanım,
değiştirme ve yeniden dağıtım serbest, tek şart lisans notunun korunması.
Kaynak: Indian Type Foundry / Jonny Pinhorn, Google Fonts.

Neden burada duruyor: font makinede `AppData` altında kuruluydu ve üretici
oradan okuyordu. Başka bir makinede ikon üretmek imkânsız hâle geliyordu —
"logoyu yeniden üretemiyorsan logon yok" demektir.

Neden uygulamanın `assets/fonts` klasöründe değil: arayüz **Inter** kullanıyor
ve orası `expo-font`'un yüklediği yer. Poppins'i oraya koymak, yüklenmeyen bir
fontu yüklenenlerin arasına karıştırmak olurdu.
