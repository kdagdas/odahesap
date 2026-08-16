# Sıradaki tur — Tur 8: arama

> Bu dosya yeni bir sohbet penceresine geçerken bağlamı taşımak için yazıldı.
>
> Son durum: **APK v27**, 516 kontrol geçiyor, `main` çalışır durumda.
> Ayrıntı ve gerekçeler için [PROJE-DOKUMANI.md](PROJE-DOKUMANI.md) §12.

## Biten turlar

| Tur | Ne geldi | Sürüm |
|---|---|---|
| 1+2 | Dönem dondurma, düzenleme geçmişi, birim alanı, aynı fiş uyarısı | v17 |
| 3 | Profil/Ev/Uygulama ayrımı, ülke + para birimi, Aktivite | v18 |
| 4 | `{kişi: tutar}` bölüşme modeli — bkz. §5 | v23 |
| — | Fiyat altyapısı: birim fiyat, paket sınıfı, anonim `price_points` | v24 |
| 5 | Düzenli ödemeler + ödeyen seçici | v24 |
| 6 | Takvim ayı istatistikleri | v24 |
| 7 | İstatistik yeniden düzeni, faturalar kartı, çoklu ev altyapısı, cila | v25–v27 |

## Tur 8 — arama

Market + ürün + kişi. 41 harcamada gerekmiyor ama Türkiye'deki kullanıcılar
veri girmeye başlayınca ilk sıkışacak yer burası. **Geciktikçe pahalılaşan
işlerden değil** — sadece sırası geldi.

Kapsam: harcama geçmişi ekranında arama kutusu; market adı, kalem adı ve
ekleyen kişiye göre süzme. `price_points` ve `product_key` normalleştirmesi
zaten var, ürün araması onun üstüne oturabilir.

## Sonraki adaylar

- **Ödeme yolları** (~4 sa) — "Öde" ve "Ödedim" ayrı düğmeler, aynı tutar
  sayfasından. IBAN **cihazda** saklanır, sunucuda değil. Ayrıntı: §12
  "Kararlaştırılmış tasarım notları"
- **Karanlık tema** (~1-2 sa, aşağıdaki koşulla) — tasarım kararı §12'de
- **Avatarlar** (~2 sa) — baş harf + hayvan siluetleri
- **CSV / logolu PDF dışa aktarma** (~3 sa)
- **Çevrimdışı kuyruk** (~2 sa)
- **Dönem hatırlatması** — bildirim altyapısıyla birlikte

## Genele açma paketi

Bunlar tek tek değil, **açılış sürümüyle birlikte** yapılmalı.

- **Hız sınırlaması** (~2 sa) — ⚠️ bugün açık bir kapı ama üç kişilik
  kullanımda sorun değil. Davet kodu 6 hane ve `/households/join` sınırsız
  denenebiliyor; `/ocr/receipt` döngüye sokulup Gemini kotası yakılabilir.
  Ücretli sürüm planlandığı için kota koruması zaten gerekecek.
- **Gemini faturalandırması** — ücretsiz katman **arka arkaya iki fiş
  taramayı kaldırmıyor** (ölçüldü, bkz. §11). Genele açmadan önce Google
  Cloud'da faturalandırma açılmalı; fiş başına maliyet kuruşun binde birkaçı.
- **Tanıtım ekranları** (~3 sa) — giriş öncesi 3-4 ekran. **İllüstrasyon
  aramayın:** en ikna edici ekran, gerçek bir fişin ayrıştığı gerçek ekran
  görüntüsüdür. *Kural:* animasyon içeriği geciktirmesin, 250 ms'yi geçmesin.
- **"Sana ne kazandırdı" rakamları** — dürüstçe söylenebilecek iki şey: kaç
  transferden kaça indiğimiz (`simplify_debts()` zaten hesaplıyor) ve kaç
  kalemin elle yazılmadığı (`items[]`). Söylenmeyecekler: "para biriktirdin",
  kim ne kadar tüketti.
- **Şube adresi + ödeme yöntemi toplama** — açılış sürümüyle **aynı APK'da**
  olmalı; fiş fotoğrafları saklanmadığı için bugün çıkarılmayan bilgi
  sonradan çıkarılamaz. Ödeme yönteminde yalnızca sınıf (nakit/kart).
- Rıza katmanı (opt-in), gizlilik metni, saklama süresi, veri silme
- E-posta doğrulama, gerçek şifre sıfırlama, hesap silme

## Denendi ve BİLEREK geri alındı

Bir sonraki oturum bunları "eksik" sanıp geri getirmesin.

- **Sekme geçiş animasyonu.** Kayan hap yapıldı, kasıyordu ve kaldırıldı.
  Animasyon native tarafta çalışıyordu; takılmanın sebebi sekmeye basınca
  aynı anda veri çekilmesi ve listenin yeniden çizilmesiydi. Düzeltmek için
  veri çekmeyi ertelemek gerekirdi, o da sekmeyi yavaş hissettirirdi.
- **Alt sayfa sürükleme jesti.** Bir gerçek sebep bulunup düzeltildi (sayfayı
  saran `Pressable`, `PanResponder`'ın önüne geçiyordu) ama ikinci bir sebep
  daha var. Cihaz olmadan tur başına yarım saatlik tahmin oyunu; uygulamada
  az panel var ve perdeye dokunmak çalışıyor. **Bırakıldı.**
- **Bütçe ve hız göstergesi.** Ay-ay karşılaştırma aynı soruyu sıfır kurulumla
  cevaplıyor ("meyve & sebze %18 artmış"). Bütçe kullanıcıdan bilmediği bir
  sayı ister. Birkaç ay ay-ay karşılaştırma kullanıldıktan sonra hâlâ hedef
  ihtiyacı varsa eklenir — o zaman ihtiyacı kanıtlanmış olur.
- **Sabit/değişken oranı kartı.** Kira aydan aya değişmediği için kart her ay
  aynı şeyi söylüyordu. Yerine **Faturalar** kartı geldi: değişen düzenli
  giderlerin ay ay seyri. Değişmeyen şablonlar listeden düşüyor.
- **Marketler arası fiyat karşılaştırması.** Barkod (EAN) olmadan ürün farkını
  fiyat farkı sanıyor: süt her markette kendi markası altında. §12'de.

## Bilinmesi gereken tuzaklar

- **Testleri ayrı veritabanında çalıştırın:** `DB_NAME=odahesap_test`.
  Yapılmazsa üretim kirlenir ve **fiyat kayıtları geri ayıklanamaz** (kimlik
  alanı taşımıyorlar); tek çare `fiyat-doldur.py --sifirla --yaz`.
- **Canlıya karşı test = kota tüketimi.** Deploy doğrulaması için OCR testi
  çalıştırmayın; diğer takımlar güvenli.
- Derlemeden önce `gradlew.bat --stop` + `app/build/intermediates/lint-cache`
  silinmeli; klasör kilitliyse komut iki kez çalıştırılmalı.
- Her APK'dan sonra izin listesi kontrol edilmeli (beklenen 11 izin).
- Alt sayfalarda `KeyboardAvoidingView` **çalışmıyor** — `BottomSheet` zaten
  klavye yüksekliğini kendi hallediyor.
- Tablette içerik `CONTENT_MAX_WIDTH` (560) ile sınırlı; yeni ekranlar `Sheet`
  ve `ScreenHeader` kullandığı sürece kendiliğinden doğru davranır.
- Ayrıntılar: [DEVAM.md](DEVAM.md)

## Yeni sohbete yapıştırılacak metin

```
D:\SettleUp\OdaHesap üzerinde çalışıyoruz. Önce şu üç dosyayı oku:
SIRADAKI-TUR.md, PROJE-DOKUMANI.md, DEVAM.md.
Sonra Tur 8'e başla.
```
