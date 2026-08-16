# Sıradaki tur — Tur 9: faturalandırma sonrası OCR işleri

> Bu dosya yeni bir sohbet penceresine geçerken bağlamı taşımak için yazıldı.
>
> Son durum: **APK v35**, 550 kontrol geçiyor, `main` çalışır durumda.
> Ayrıntı ve gerekçeler için [PROJE-DOKUMANI.md](PROJE-DOKUMANI.md) §12.
>
> **Tur 9'un arayüz ve model kısmı bitti (v33→v35).** Ayrıntı aşağıda.
> OCR maddeleri (1-3) hâlâ açık ve faturalandırma bekliyor.
> Test sayısı **550** (yeni: `aylik-kapsam-test.py`).

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

### 4-7. Arayüz ve model işleri — BİTTİ (v35)

Hepsi cihazda doğrulandı ya da testle korunuyor.

| # | İş | Not |
|---|---|---|
| 4 | Gezinme çubuğu hatası | Dördüncü düzeltme tuttu: modalın içi **ölçülmüyor**, güvenli alan kök sağlayıcıdan sayı olarak veriliyor + `statusBarTranslucent`/`navigationBarTranslucent`. Üç düğmede ve jest çubuğunda doğrulandı. |
| 5 | Alacaklı kendi ekranından ödeme bilgisi paylaşıyor | İlk paylaşımdan sonra küçülür, kaybolmaz |
| 6 | Ödeme akışı tek yüz | Tutar + çipler → yollar → kayıt. İkinci yüz ve dönüşteki Alert kalktı |
| 7 | Yatay şeritler → seçici | Kişi, dönem, ay. Oklar komşu için kaldı |

Ayrıca bu turda:

- **İstatistik kapsamı `split_with`'ten çıkıyor.** `roommate` harcamaları
  hiçbir istatistikte görünmüyordu, `custom` ise ev sayılıyordu. Kural:
  *ev bölüşmüyorsa ev harcaması değildir*; kişiselde tutar **payın** kadar.
  `aylik-kapsam-test.py` (29 kontrol, üç kişilik ev) koruyor.
- **IBAN mod-97 doğrulaması** — eski "banka yakalar" kararı değiştirildi.
- **Paylaşım bağlantısı çapalı `https`** — tıklanabilir oldu, IBAN yine
  sunucuya uğramıyor. `assetlinks.json` sunucudan servis ediliyor.
- **Bildirim türleri ayrıldı** (yeni harcama / düzenleme / ödeme) ve
  **ödeme kaydı geri alınınca** artık bildirim gidiyor.
- Sekme çubuğu gezilen ekranlarda kalıyor; bölüşme seçicisi yeniden düzenlendi.

> **Deploy gerekiyor:** `/o` ve `/.well-known/assetlinks.json` uçları `main`'e
> push edilip Render'a çıkmadan paylaşım bağlantısı yarım çalışır.

## Sıradaki: OCR işleri hâlâ faturalandırma bekliyor

Yukarıdaki 1-3 numaralı maddeler (hız sınırlaması, fiş fotoğrafını küçültme,
paralel toplu tarama) **değişmedi ve hâlâ açık.** Üçü de Google Cloud'da
faturalandırma açılmadan ölçülemiyor.

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
