# KaSa — çalışma kuralları

Bu dosya her oturumda okunuyor. Amacı, daha önce **ölçülerek** verilmiş
kararların yeniden tartışılmaması ve bilinen tuzaklara tekrar düşülmemesi.
Ayrıntılı gerekçeler `SIRADAKI-TUR.md` (yol haritası ve tur kararları) ile
`DEVAM.md` (derleme, ortam, öğrenilen tuzaklar) içinde.

**Dil: Türkçe.** Kod yorumları, commit mesajları, belgeler, arayüz metinleri —
hepsi Türkçe. Değişken adları da Türkçe olabilir (`_fiyat_hareketleri`,
`ev_bugun`); mevcut dosyanın hangi dili kullandığına bak ve ona uy.

---

## Ne yapıyoruz

Üç kişilik bir ev için harcama bölüşme uygulaması (Almanya) — Expo/React
Native + FastAPI/MongoDB Atlas. İkinci bir ev daha var: **Alanya ev
(TR/TRY)**, ev sahibi orada ÜYE DEĞİL.

Farklılaştırıcı, bölüşme değil (o emtia): **fişi kalem kalem okumak.** Genel
ad, birim fiyat, market içi fiyat hareketi, alışveriş listesiyle eşleşme.
Rakip taramasında doğrulandı — Almanya'nın dokuz WG uygulamasının hiçbiri
fişin içine girmiyor.

---

## Ortam ve testler

| Ne | Nerede |
|---|---|
| Geliştirme arka ucu | `localhost:8098` · **üretim veritabanı** |
| Test arka ucu | `localhost:8099` · `DB_NAME=odahesap_test` |
| Üretim | https://odahesap-api.onrender.com |
| Ortamı ayağa kaldır | `iex (gc D:\SettleUp\gelistir.ps1 -Raw)` |

```bash
cd backend && ./.venv/Scripts/python.exe ../tests/<ad>-test.py http://localhost:8099
```

- **Testler ASLA üretim veritabanına bağlanmaz.** `DB_NAME=odahesap_test`.
- **OCR ucunu test etmeyin.** `/ocr/receipt` gerçekten modeli çağırır ve
  ücretsiz kotayı yakar — bu bir kez yaşandı, test 7 çağrı harcadı ve
  ölçtüğü şey bizim sınırımız değil sağlayıcının sınırı oldu. Kota mantığı
  ucun ÖNÜNDE ayrı bir fonksiyonda; doğru test yeri orası (`tests/kota-test.py`).
- Sunucu değiştiyse **8099'u yeniden başlat** — `--reload` yok.

**Üretim hangi kodda?** Sağlık ucu söylüyor, tahmin etme:

```bash
curl https://odahesap-api.onrender.com/api/
```

`commit`, `tazelik_gun`, `etki_orani` dönüyor. Yerelde `commit: "yerel"`.

---

## Derleme — iki tuzak, ikisi de SESSİZ

**1. `expo prebuild` atlanırsa `app.json` hiçbir işe yaramaz.** versionCode
`android/app/build.gradle`'dan okunur ve ikon `res/mipmap-*` altındaki
ÜRETİLMİŞ kopyalardan gelir. v47 iki kez yanlış çıktı: bir kez eski numarayla,
bir kez eski logoyla. Gradle uyarmıyor — gördüğü kaynaklar yerinde, sadece
eski.

> `app.json` ya da `assets/images/` değiştiyse **prebuild şart**, sonra
> numarayı ve ikonu **paketin içine bakarak** doğrula.

**2. `gradlew clean` çalıştırmayın** — NDK 27 + CMake 3.22 `-fuse-ld=gold`
hatası. Temizlik gerekiyorsa klasörleri elle silin.

Sıra ve ayrıntı: `DEVAM.md` → "APK KONTROL LİSTESİ". `.env` derlemeden önce
üretime, sonra `localhost:8098`'e döner.

---

## Değişmeyen kurallar

Bunlar ölçümle verilmiş kararlar. Değiştirmeden önce gerekçeyi oku.

**Veri ve dürüstlük**
- **Olgu paylaşılabilir, doğrulanamayan iddia paylaşılamaz.** Fiyat evin
  bütün harcamalarından gelir (kişisel dahil) çünkü "süt 0,95 €" bir olgudur.
  "Son alışveriş" yalnızca kullanıcının Harcamalar'da görebileceği
  kayıtlardan gelir, çünkü o bir iddiadır.
- **Yanlış birleştirmek, birleştirmemekten pahalıdır.** Otomatik ürün
  eşleştirme yok. Bulanık arama yalnızca ARAMADA, en son sırada, ilk harf
  tutmak şartıyla, 5 harften kısa sorgularda kapalı.
- **Boş kalabilme cesareti.** Kayda değer bir şey yoksa satır hiç çizilmez.
  Dolgu metni yazılırsa kullanıcı bir hafta içinde o satırı okumayı bırakır.
- **Ürün gruplama `generic` alanına dayanır**, `product_key`'e değil.
- **"Kez" = alışveriş sayısı**, kalem sayısı değil.
- **`diger` bir kategori değil, kategorinin yokluğudur** — baskın kategori
  oylamasında oy kullanmaz.
- **Fiyat hareketlerinin üç sert kuralı:** aynı market içinde · ayın MEDYANI ·
  `adet` sınıfı DIŞARIDA. Sıralama yüzdeye değil **paraya** göre
  (`(yeni−eski) × bu ayki miktar`).
- **Saat dilimi evin ÜLKESİNDEN** (`ev_bugun`); zaman damgaları UTC kalır.

**Arayüz**
- **Üç açılma biçimi:** alt sayfa = görev · yerinde kart açılımı = açıklama ·
  `AnchorMenu` = seçim. Kasa'daki yerinde açılım menüye çevrilmeyecek.
- **Cümle bilgi verir, kart eylem ister.** Onaylanacak bir şey karttır,
  bilinmesi yeten şey cümledir. Aynı şey iki yerde söylenmez.
- **Lacivert "kim ve ne kadar" der, beyaz "neye dikkat et" der.** Manşet
  lacivertte tek satır; gerisi beyaz alandaki karta düşer. Böylece lacivert
  bir daha büyümez.
- **Renk anlam taşır, süs değildir.** Amber = senden bir şey isteniyor.
  Kiremit = para ters yöne gidiyor. Yeşil = lehine. Gri = yalın bilgi.
  **Sürekli yanıp sönen hiçbir şey yok** — nabız (`PulseDot`) üç kez atıp
  durur ve yalnızca senden bir şey isteyen satırdadır.
- Dokunma hedefleri **Apple 44 pt / Google 48 dp**.
- **Sabit örnek yazmayın.** Yer tutucular evin kendi verisinden gelir
  (market, ev arkadaşı, IBAN ülke biçimi). "REWE, EDEKA" ve "Örn. Kadir"
  Türkiye'deki evde anlamsızdı — hepsi temizlendi.

**Bildirim**
- Düzenleme bildirimi **alana değil sonuca** bakar: toplam ya da kişi başına
  düşen pay kuruşu kuruşuna değişmediyse kimseye bildirim gitmez.

---

## Nasıl çalışıyoruz

- **Ölçmeden iddia etme.** Bu projede "sanırım" ile verilen her karar en az
  bir kez yanlış çıktı. Veri elimizde: `backend/.venv` + Mongo ile sorgula,
  cihazdan ölçü al, ekran görüntüsü çöz. Rakip iddiası için de aynısı geçerli.
- **Yanıldığını açıkça söyle.** Belgelerde ve commit mesajlarında "şöyle
  sanmıştım, ölçünce şu çıktı" cümleleri var; bu üslup korunacak.
- **Madde başına bir commit**, gövdede NEDEN yazılı. Dosyalar iç içe geçtiği
  için ayrılamıyorsa bunu mesajda söyle.
- **Yorumlar NE'yi değil NİÇİN'i anlatır** — özellikle bir kararın neden öteki
  seçenek yerine alındığını. Mevcut dosyaların üslubuna bak.
- **Reddedilen fikirler de gerekçesiyle yazılır.** "Yapmadık" bilgi değil;
  "şu ölçüm yüzünden yapmadık" bilgidir. (Görev dağılımı, yemek planlama,
  aynı ay içi fiyat kıyası — hepsi gerekçeleriyle `SIRADAKI-TUR.md`'de.)
- **Nadir durumu uyar.** Bin kişide bir kişiyi ilgilendiren bir şey
  konuşuluyorsa söyle ve yol haritasına yazmayı öner; yükü şimdiye alma.
- **Rakip taklidi değil çekirdek.** Rakibin her özelliğini yapmak hedef değil;
  o uygulamanın ne için kullanıldığını yapabilmek hedef.

---

## Gizlilik

- **Alanya evinin içeriği paylaşılmaz.** Ev sahibi o evin üyesi değil.
  Yapılandırma alanları (ülke, para birimi) sorulduğunda bakılabilir; harcama,
  üye ve alışveriş içeriği bakılamaz.
- `_visible_filter(user_id)` harcama görünürlüğünün **tek geçidi** — yeni bir
  sorgu yazarken atlanmayacak.
- `D:\SettleUp\yedekler` altındaki yedekler herkesin e-postasını ve harcama
  geçmişini içerir; paylaşılmaz.
- `price_points` koleksiyonunda `household_id`, `user_id`, `expense_id`
  **hiç yazılmıyor** — sonradan silinen değil, hiç var olmayan alanlar. Bu
  kasıtlı ve korunacak.

---

## Sırada ne var

`SIRADAKI-TUR.md` → **Tur 14**. Baş madde: **ödeyen ile ekleyen ayrımı**
(`added_by` bugün iki işi birden yapıyor ve bu yanlış rakam üretiyor).
