# Sıradaki tur — Tur 7: cila turu

> Bu dosya yeni bir sohbet penceresine geçerken bağlamı taşımak için yazıldı.
>
> Son durum: **APK v24**, 497 sunucu kontrolü geçiyor, `main` çalışır durumda.
> Ayrıntı için [PROJE-DOKUMANI.md](PROJE-DOKUMANI.md) §12.

## Biten turlar

| Tur | Ne geldi |
|---|---|
| 1+2 (v17) | Dönem dondurma, düzenleme geçmişi, birim alanı, aynı fiş uyarısı |
| 3 (v18) | Profil/Ev/Uygulama ayrımı, ülke + para birimi, Aktivite |
| 4 (v23) | `{kişi: tutar}` bölüşme modeli — bkz. §5 |
| — (v24) | Fiyat altyapısı: birim fiyat, paket sınıfı, anonim `price_points` |
| 5 (v24) | Düzenli ödemeler + ödeyen seçici |
| 6 (v24) | Takvim ayı bazlı istatistikler, sabit/değişken ayrımı |

## Tur 7 — kararlaştırılan içerik

Ekran seti oturdu, sıra cilada. Hepsi konuşuldu ve gerekçeleri var.

### 1. Alt sayfalar elle kaydırılabilsin

`ui.tsx`'te her alt sayfanın tepesinde 36×4'lük bir tutamak var ve **çekilmiyor**.
Tutulup çekilmeyen bir tutamak, hiç tutamak olmamasından kötü: kullanıcı
deniyor, tepki gelmiyor.

Uygulamadaki tüm `Modal` kullanımı `ui.tsx` içinde — ortak bir alt sayfa
bileşeni çıkarılıp jest oraya konursa **her panel tek seferde düzelir**.
`gesture-handler` ve `reanimated` kurulu, Yeni Mimari açık. ~2-3 sa.
Bu bir estetik işi değil, **hata düzeltmesi**.

### 2. Tanıtım ekranları (giriş öncesi)

Bugün yeni katılan biri hiçbir açıklama görmeden e-posta/şifre ekranına
düşüyor. Fişten kalem kalem okuma bu uygulamanın en ayırt edici özelliği ve
hiçbir yerde anlatılmıyor. 3-4 ekran, veri gerektirmiyor. ~3 sa.

**Kural:** animasyon içeriği geciktirmesin, dokunmayı bloklamasın, 250 ms'yi
geçmesin. Uygulamanın hızlı hissettirmesi korunacak en değerli şey.

### 3. "Sana ne kazandırdı" rakamları

Fresh it'in "12 kg gıda kurtardın" karşılığı. Dürüstçe söyleyebileceğimiz
**iki** şey var, ikisi de zaten ölçülü:

- **"34 ayrı ödeme yerine 12 transfer."** `simplify_debts()` bunu her dönem
  zaten hesaplıyor.
- **"47 fiş tarandı, 380 kalem elle yazılmadı."** Kalem sayısı `items[]`'de.

Söylenmeyecekler: "para biriktirdin" (biriktirmedi), kim ne kadar tüketti
(kimin daha müsait olduğunu ölçer, sürtüşme üretir).

Bu rakamlar Tur 6'nın hesaplarıyla aynı kaynaktan geliyor — ayrı yazılırsa
iki ekran farklı sayı gösterir.

## Genele açma paketi (Tur 7'den sonra)

- **Düzenli ödeme hatırlatma bildirimi** ~1,5-2 sa. Render cron ücretli ve
  ikinci ücretsiz servis açılamaz; en ucuz yol mevcut **GitHub Actions**'a
  günlük bir iş eklemek. `last_confirmed` + `skipped` zaten çift bildirimi
  engelliyor. Yeni ortam değişkeni **`render.yaml`'a da yazılmalı**.
- **Şube adresi + ödeme yöntemi toplama.** ⚠️ **Açılıştan ÖNCE açılmalı** —
  fiş fotoğrafları saklanmadığı için bugün çıkarılmayan hiçbir bilgi sonradan
  çıkarılamaz. Ödeme yönteminde yalnızca sınıf (nakit/kart); kart numarası,
  terminal kimliği asla. Ayrıntı: §12 "Fiyat verisi".
- Rıza katmanı (opt-in), gizlilik metni, saklama süresi, veri silme
- E-posta doğrulama, gerçek şifre sıfırlama, hız sınırlama

## Bilinmesi gereken tuzaklar

- **Testleri ayrı veritabanında çalıştırın:** `DB_NAME=odahesap_test`.
  Yapılmazsa üretim kirlenir ve **fiyat kayıtları geri ayıklanamaz** (kimlik
  alanı taşımıyorlar); tek çare `fiyat-doldur.py --sifirla --yaz`.
- Derlemeden önce `gradlew.bat --stop` + `app/build/intermediates/lint-cache`
  silinmeli; yoksa `lintVitalAnalyzeRelease` sebep yazmadan düşüyor.
- Her APK'dan sonra izin listesi kontrol edilmeli (beklenen 11 izin).
- Alt sayfalarda `KeyboardAvoidingView` **çalışmıyor** — `useKeyboardHeight()`
  kullanın. Sebebi `ui.tsx` içinde yazılı.
- Tablette içerik `CONTENT_MAX_WIDTH` ile sınırlı; yeni ekranlar `Sheet` ve
  `ScreenHeader` kullandığı sürece kendiliğinden doğru davranır.
- Ayrıntılar: [DEVAM.md](DEVAM.md)

## Yeni sohbete yapıştırılacak metin

```
D:\SettleUp\OdaHesap üzerinde çalışıyoruz. Önce şu üç dosyayı oku:
SIRADAKI-TUR.md, PROJE-DOKUMANI.md, DEVAM.md.
Sonra Tur 7'ye başla.
```
