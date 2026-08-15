# Sıradaki tur — Tur 7: alt sayfa jesti

> Bu dosya yeni bir sohbet penceresine geçerken bağlamı taşımak için yazıldı.
>
> Son durum: **APK v25**, 497 sunucu kontrolü geçiyor, `main` çalışır durumda.
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

## Tur 7 — tek madde kaldı

Cila turunun üç maddesinden ikisi **genele açmaya ertelendi** (aşağıda).
Geriye kalan tek iş bir hata düzeltmesi:

### Alt sayfalar elle kaydırılabilsin

`ui.tsx`'te her alt sayfanın tepesinde 36×4'lük bir tutamak var ve **çekilmiyor**.
Tutulup çekilmeyen bir tutamak, hiç tutamak olmamasından kötü: kullanıcı
deniyor, tepki gelmiyor.

Uygulamadaki tüm `Modal` kullanımı `ui.tsx` içinde — ortak bir alt sayfa
bileşeni çıkarılıp jest oraya konursa **her panel tek seferde düzelir**.
`gesture-handler` ve `reanimated` kurulu, Yeni Mimari açık. ~2-3 sa.
Bu bir estetik işi değil, **hata düzeltmesi**.

## Genele açma paketi (Tur 7'den sonra)

- **Tanıtım ekranları** (giriş öncesi, 3-4 ekran, ~3 sa). Bugün yeni katılan
  biri hiçbir açıklama görmeden şifre ekranına düşüyor; fişten kalem kalem
  okuma en ayırt edici özelliğimiz ve hiçbir yerde anlatılmıyor.
  **İllüstrasyon aramayın:** en ikna edici ekran, gerçek bir Alman fişinin
  ayrıştığı gerçek ekran görüntüsüdür. Anlatmaktan çok göstermek.
  *Kural:* animasyon içeriği geciktirmesin, dokunmayı bloklamasın, 250 ms'yi
  geçmesin — uygulamanın hızlı hissettirmesi korunacak en değerli şey.
- **"Sana ne kazandırdı" rakamları.** Dürüstçe söylenebilecek iki şey:
  kaç transferden kaça indiğimiz (`simplify_debts()` zaten hesaplıyor) ve
  kaç kalemin elle yazılmadığı (`items[]`). Söylenmeyecekler: "para
  biriktirdin" (biriktirmedi), kim ne kadar tüketti (kimin daha müsait
  olduğunu ölçer, sürtüşme üretir). Tur 6'nın hesaplarıyla aynı kaynaktan
  gelmeli, yoksa iki ekran farklı sayı gösterir.

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
