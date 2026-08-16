# Sıradaki tur — Tur 9: faturalandırma sonrası OCR işleri

> Bu dosya yeni bir sohbet penceresine geçerken bağlamı taşımak için yazıldı.
>
> Son durum: **APK v33**, 521 kontrol geçiyor, `main` çalışır durumda.
> Ayrıntı ve gerekçeler için [PROJE-DOKUMANI.md](PROJE-DOKUMANI.md) §12.
>
> **v33'te ne geldi (Tur 9'un arayüz kısmı):** gezinme çubuğu hatası
> (aşağıda 4. madde), her ekranın alt boşluğu, ve alacaklının kendi
> ekranından ödeme bilgisi paylaşması. **Üçü de cihazda doğrulanmalı.**
> OCR maddeleri (1-3) hâlâ açık ve faturalandırma bekliyor.

## Ev sahibinin yapacakları (koddan bağımsız)

Bunlar yapılmadan Tur 9'un çoğu ölçülemez:

1. **Google Cloud'da faturalandırmayı aç.** Gemini API'nin bağlı olduğu
   projeye ödeme yöntemi tanımlanacak. Kodda hiçbir şey değişmiyor, anahtar
   bile aynı. Ücretsiz katman arka arkaya iki fiş taramayı kaldırmıyor
   (ölçüldü: 1. istek 200, 2. istek 429) ve bu artık **testi engelliyor**.
   - **Gemini Pro aboneliği bunu ÇÖZMEZ.** O tüketici ürünü; API kotası
     projeye ait, ayrı bir faturalandırma.
2. **Bütçe uyarısı ve kota tavanı koy.** Ücretsiz katmanda en kötü senaryo
   "kota doldu"ydu; faturalandırma açılınca **en kötü senaryo bir fatura**.

## Tur 9 — kararlaştırılan işler

### 1. Hız sınırlaması (~2 sa) — artık öncelik

Önceden "genele açarken" listesindeydi. **Faturalandırma açılınca öne
alınmalı:** `/ocr/receipt` sınırsız çağrılabiliyor ve artık her çağrı para.
`/households/join` de sınırsız denenebiliyor (davet kodu 6 hane).

### 2. Fiş fotoğrafını küçültme (~1-2 sa + ölçüm)

Bugün fotoğraf **tam çözünürlükte** gönderiliyor, yalnızca JPEG kalitesi
düşürülüyor:

```
takePictureAsync({ base64: true, quality: 0.6 })
```

Modern kamera 3000-4000 piksel çekiyor; fiş bunun dörtte birinde de okunur.
Üç yerde birden maliyet üretiyor: yükleme, Render'ın zayıf işlemcisinde
base64 çözme, ve modelin işleyeceği piksel sayısı.

**Çözüm kod tabanında zaten var:** `src/photo.ts` avatarları `ImageManipulator`
ile küçültüyor. Aynı yaklaşım fişe hiç uygulanmamış.

**Tahminle yapılmayacak, ölçülecek:** aynı fiş 1200 / 1600 / 2000 pikselde
taranıp hem süre hem çıkan kalem sayısı karşılaştırılacak. Çok küçültmek fişi
okunmaz yapar; doğru eşik deneyle bulunur.

### 3. Toplu taramada paralel istek

Fişler şu an **sırayla** gönderiliyor. Ücretli katmanda iki üç tanesi aynı
anda gidebilir — tek fişi hızlandırmaz, üç fişin toplam süresini kısaltır.
Ücretsiz katmanda imkânsızdı (ilk istekten sonra 429).

### 4. Alt sayfa gezinme çubuğunun altında kalıyor — YAZILDI, cihazda doğrulanacak

Dördüncü düzeltme, önceki üçünün **ortak** hatasını kaldırıyor: üçü de modal
penceresini ölçüyordu, ölçüm ise üst üste açılan ikinci sayfada kaybediliyor.

Yapılan (bkz. DEVAM.md → "Alt sayfalar: modalın içini ÖLÇMEYİN"):
1. Modal içindeki `SafeAreaProvider` / `SafeAreaView` **kaldırıldı**; güvenli
   alan kök sağlayıcıdan okunup `BottomSheet`'e sayı olarak veriliyor
2. `statusBarTranslucent` + `navigationBarTranslucent` — modal penceresi kök
   pencereyle aynı geometride olsun diye (daha önce denenmemişti)
3. Kasa'daki "Öde → ödeme yolları" tek `BottomSheet`'e indi; önceden iki ayrı
   `Modal` idi ve ikincisi birincisinin kapanma animasyonunun üstüne açılıyordu

Aynı turda **her kaydırma ekranının alt boşluğu** da `useScrollPad()`'e
bağlandı — elle yazılmış `120` / `130` / `spacing.xxl` sabitleri gezinme çubuğu
olan telefonda içeriğin son kısmını çubuğun altında bırakıyordu (istatistik
sayfasında bildirildi).

**Kural DEVAM.md'ye yazıldı:** hiçbir ekran, pencere veya düğme gezinme
çubuğunun altında kalmayacak.

### 6. Ödeme akışı tek yüze indi (v34) — YAZILDI

Gerekçe ve yeni düzen: PROJE-DOKUMANI §12 "Kararlaştırılmış tasarım notları".
Özet: tutar + çipler → yollar → kayıt, tek sayfada, tek koyu düğme. İkinci yüz
ve dönüşteki Alert kalktı; "kısmi öde" ayrı düğme olarak **konmadı**.

**v34'te `SHEET_DEBUG` AÇIK** (`src/ui.tsx`): alt sayfanın tepesinde kırmızı
bir ölçü şeridi var. Gezinme çubuğu hatası dört kez tahminle çözülmeye
çalışıldı, dördü de tutmadı — bu şerit `ins / win / h / y / kb` değerlerini
basıyor ki hangi terimin bozuk olduğu tek ekran görüntüsünde görünsün.
**Hata kapanınca `SHEET_DEBUG = false` yapılıp şerit ve stili silinecek.**

### 7. Yatay şeritler seçiciye çevrilecek — SIRADA

Aynı sorunun üç görünümü: yatay şerit büyüyen listeyi taşımıyor.
- Harcamalar'da kişi süzgeci (çok kişili ev + uzun isim)
- Harcamalar ve Kasa'da dönem çipleri (2 yıl ≈ 24 dönem)
- İstatistik'te ay gezinmesi (ok tuşuyla teker teker; geçen yılın Ocak'ı 19 dokunuş)

Kural: **oklar komşu için, seçici sıçramak için.** Üçü de `SelectRow` +
`BottomSheet` ile çözülecek — yani **`BottomSheet` düzelmeden yapılmamalı**,
yoksa hata üç ekrana daha yayılır.

Ayrıca tartışıldı: kapalı dönem zaten dokunulmaz, Kasa'nın tepesindeki çip
şeridi "Geçmiş dönemler" diye tek satıra inebilir.

### 5. Ödeme bilgisini alacaklı kendi ekranından paylaşıyor — YAZILDI

Kasa'da alacaklının satırında ikinci bir düğme: bilgi girilmemişse formu
açıyor, girilmişse paylaşıyor. İlk paylaşımdan sonra küçük bir metin
bağlantısına iniyor — kaybolmuyor. Gerekçesi PROJE-DOKUMANI §12
"Kararlaştırılmış tasarım notları" altında. Borçludaki "İste" duruyor.

## Biten turlar

| Tur | Ne geldi | Sürüm |
|---|---|---|
| 1+2 | Dönem dondurma, düzenleme geçmişi, birim, aynı fiş uyarısı | v17 |
| 3 | Profil/Ev/Uygulama ayrımı, ülke + para birimi, Aktivite | v18 |
| 4 | `{kişi: tutar}` bölüşme modeli — bkz. §5 | v23 |
| — | Fiyat altyapısı: birim fiyat, paket sınıfı, `price_points` | v24 |
| 5 | Düzenli ödemeler + ödeyen seçici | v24 |
| 6 | Takvim ayı istatistikleri | v24 |
| 7 | İstatistik düzeni, faturalar kartı, çoklu ev altyapısı, cila | v25–27 |
| 8 | Ödeme yolları (IBAN/PayPal, cihazda), genel ürün adı, hızlı bölüşüm | v28–32 |

## Sonraki adaylar

- **Alınacaklar–fiyat köprüsü** — genel ürün adı bunu mümkün kıldı: listeye
  "süt" yazınca evin en son kaça aldığı gösterilebilir. Birkaç hafta veri
  birikmesi gerekiyor.
- **Faturalar kartı** zaten hazır, 2-3 aylık düzenli ödeme verisi bekliyor
- **Karanlık tema** (~1-2 sa sistem takipli) — renk kararı §12'de
- Arama, avatarlar, CSV/PDF, çevrimdışı kuyruk, dönem hatırlatması

## Genele açma paketi

- E-posta doğrulama, gerçek şifre sıfırlama, hesap ve veri silme
- Rıza katmanı (opt-in), gizlilik metni, saklama süresi
- **Şube adresi + ödeme yöntemi toplama** — açılış APK'sıyla aynı anda;
  fiş fotoğrafları saklanmadığı için sonradan çıkarılamaz
- Tanıtım ekranları (gerçek fiş ekran görüntüleriyle, illüstrasyon değil)
- "Sana ne kazandırdı" rakamları
- Düzenli ödeme hatırlatma bildirimi (GitHub Actions üzerinden)

## Denendi ve BİLEREK geri alındı

Bir sonraki oturum bunları "eksik" sanıp geri getirmesin.

- **Sekme geçiş animasyonu** — kasıyordu; sebep animasyon değil, sekmeye
  basınca aynı anda veri çekilmesiydi
- **Alt sayfa sürükleme jesti** — bir sebep bulunup düzeltildi, ikincisi
  bulunamadı; değeri düşük
- **EPC/Girocode karekodu** — ödeyenin ekranında görünüyor ama ödeyenin kendi
  banka uygulamasıyla okutması gerekiyor; kendi ekranını tarayamaz
- **Bütçe ve hız göstergesi** — ay-ay karşılaştırma aynı soruyu sıfır
  kurulumla cevaplıyor
- **Sabit/değişken oranı kartı** — kira değişmediği için her ay aynı şeyi
  söylüyordu; yerine Faturalar kartı geldi
- **Marketler arası fiyat karşılaştırması** — barkod yok. *Genel ürün adı
  geldikten sonra EMTİA için kısmen mümkün oldu* (havuç, ekmek); markalı
  işlenmiş üründe hâlâ geçerli değil

## Bilinmesi gereken tuzaklar

- **Testleri ayrı veritabanında çalıştırın:** `DB_NAME=odahesap_test`.
  Yapılmazsa üretim kirlenir ve **fiyat kayıtları geri ayıklanamaz** (kimlik
  alanı taşımıyorlar); tek çare `fiyat-doldur.py --sifirla --yaz`.
- **Canlıya karşı OCR testi çalıştırmayın** — kota tüketir.
- **Derleme `frontend/` dizininden yapılır.** `frontend/android` içinden
  `expo prebuild` çalıştırmak sessizce başarısız olur ve eski `versionCode`
  ile APK üretirsiniz (bu yaşandı).
- Derlemeden önce `gradlew.bat --stop` + `app/build/intermediates/lint-cache`
  silinmeli; klasör kilitliyse komut iki kez çalıştırılmalı.
- Her APK'dan sonra izin listesi kontrol edilmeli (beklenen 11 izin).
- Alt sayfalarda `KeyboardAvoidingView` **çalışmıyor** — `BottomSheet` klavye
  yüksekliğini kendi hallediyor.
- Tablette içerik `CONTENT_MAX_WIDTH` (560) ile sınırlı.
- Ayrıntılar: [DEVAM.md](DEVAM.md)

## Yeni sohbete yapıştırılacak metin

```
D:\SettleUp\OdaHesap üzerinde çalışıyoruz. Önce şu üç dosyayı oku:
SIRADAKI-TUR.md, PROJE-DOKUMANI.md, DEVAM.md.
Sonra Tur 9'a başla.
```
