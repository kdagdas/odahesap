# Sıradaki tur — Tur 5: Düzenli ödemeler

> Bu dosya yeni bir sohbet penceresine geçerken bağlamı taşımak için yazıldı.
> Tur 5 bitince silinebilir ya da Tur 6 için yeniden yazılabilir.
>
> Son durum: **APK v23**, 336 sunucu kontrolü geçiyor, `main` çalışır durumda.
> Ayrıntı için [PROJE-DOKUMANI.md](PROJE-DOKUMANI.md) §12.

## Tur 4'ten devralınan zemin

Tur 4 bölüşme modelini değiştirdi ve Tur 5 doğrudan onun üstüne oturuyor:

```
split_mode "equal"  →  split_with = { user_id: ağırlık }
split_mode "exact"  →  split_with = { user_id: tutar }
```

Kira artık **tek kayıt**: `exact` kipinde `{Ali: 350, Bob: 400, Carol: 450}`.
Düzenli ödemeler bu yapıyı olduğu gibi saklayıp her ay tekrar üretecek — yani
"kimin ne kadar ödeyeceği" sorusu çözülmüş durumda, kalan tek soru *ne zaman*.

Bilinmesi gerekenler:

- `split_of()` eski kayıtları `target_type`'tan türetir. **Bu yedek yol
  kaldırılmamalı.**
- Kişiye özel bölüşüm varken tutarı tek başına değiştirmek 400 döner. Düzenli
  ödeme şablonundan üretilen kayıt bu kurala takılmamalı: tutar değişiyorsa
  bölüşüm de birlikte gönderilmeli.
- Bölüşme listesi kayıt anında donar.

## Ne yapılacak

### 1. Takvim tarihli şablon

**Dönem değil takvim.** Dönem 3 hafta da sürebilir 7 hafta da; elektrik hep
ayın 15'inde gelir. Şablon `day_of_month` taşımalı, `period_id` değil.

Alanlar: ad, tutar, `split_mode` + `split_with`, kategori, market, ayın kaçı,
"tutarı sabit mi" (kira sabit, elektrik değişken).

### 2. Vadesi gelince onay — **asla sessizce ekleme**

Yanlış eklenen bir kira, arkadaşlar arasında yanlış borç demek. Vade gelince
üç seçenek: **Onayla / Düzenle / Sonra**.

- Ev gideri: biri onaylar, diğerlerine bildirim gider
- Kişisel: herkes kendisininkini onaylar

"Tutarı sabit" olanlarda bile onay istenmeli; sadece varsayılan tutar dolu
gelir.

### 3. Nerede duracak

Anasayfa'da vadesi gelmiş şablonlar için bir şerit, şablon yönetimi
**Ev ayarları** altında (ortak) + **Profil** altında (kişisel) — Tur 3'te
konan kural: "bu kime ait?" sorusu yeri belirler.

## Tur 4'te bilinçli olarak yapılmayanlar

- **Evden ayrılma akışı değişmedi.** Kişi bazlı bakiye dondurma ("evde değil
  ama borçlu üye") Kasa, üye listesi, bildirimler ve dönem kapatmanın hepsine
  üçüncü bir durum ekliyor — yılda bir olan bir olay için kalıcı karmaşıklık.
  "Dönemi kapat ve çıkar" tek düğmesi de konmadı: dönem kapatmak "bakiyeler
  arşivlendi, bu rakamlar ödendi" demek, kolay basılan bir düğme insanları
  ödeşmeden arşivlemeye iter. Doğru sıra: Kasa'dan ödeş → dönemi kapat → çıkar.
- **Fiş kaleminde "Tutar gir" kapalı.** Kalemin fiyatı zaten belli; üçüncü bir
  tutar sorusu fiş başına on beş kez karşıya çıkardı.

## Bilinmesi gereken tuzaklar

- Derlemeden önce `gradlew.bat --stop` + `app/build/intermediates/lint-cache`
  silinmeli; yoksa `lintVitalAnalyzeRelease` sebep yazmadan düşüyor.
- Her APK'dan sonra izin listesi kontrol edilmeli (beklenen 11 izin).
- `frontend/android/` `.gitignore` içinde; oradaki elle yapılan değişiklikler
  (imzalama, tek mimari) commit'e girmiyor.
- Ayrıntılar: [DEVAM.md](DEVAM.md)

## Yeni sohbete yapıştırılacak metin

```
D:\SettleUp\OdaHesap üzerinde çalışıyoruz. Önce şu üç dosyayı oku:
SIRADAKI-TUR.md, PROJE-DOKUMANI.md, DEVAM.md.
Sonra Tur 5'e başla.
```
