# Sıradaki tur — Tur 4: `{kişi: tutar}` bölüşme modeli

> Bu dosya yeni bir sohbet penceresine geçerken bağlamı taşımak için yazıldı.
> Tur 4 bitince silinebilir ya da Tur 5 için yeniden yazılabilir.
>
> Son durum: **APK v22**, 289 sunucu kontrolü geçiyor, `main` çalışır durumda,
> `v22` etiketli. Ayrıntı için [PROJE-DOKUMANI.md](PROJE-DOKUMANI.md) §12.

## Neden bu tur diğerlerinden farklı

Konuştuğumuz turlar arasında **bakiye motoruna dokunan tek iş** bu. Uygulamanın
en çok testle korunan ve yanlış giderse en sessiz bozulan yeri
`_compute_balances()`. Bu yüzden:

- Önce **yedek**: `cd backend && .venv/Scripts/python.exe ../tests/yedekle.py`
- **Ayrı dalda** çalışılacak (`git checkout -b tur4-bolusme`), `main` her an
  çalışır kalacak
- Birleştirmeden önce 289 kontrolün tamamı **iki kez** çalıştırılacak
- Bitince APK

## Ne yapılacak

### 1. Her harcama kendi katılımcı listesini taşısın

Bugün üç ayrı özel durum var: `household`, `self`, `roommate`. Hedef, hepsini
tek mekanizmaya indirmek:

```
split_with: { user_id: tutar }      # ya da eşit bölüşmede { user_id: ağırlık }
```

- Tüm ev → listede herkes
- Kendim → listede sadece ben
- Bir kişiye → listede sadece o kişi
- **Seçili kişiler** → listede seçilenler  ← yeni
- **Kişiye özel tutarlar** → 350 / 400 / 450  ← yeni

**Göç:** mevcut kayıtlarda bu alan yok. Ya geriye dönük doldurulacak ya da
alan yoksa `target_type`'tan türeten bir yedek yol bırakılacak. Tavsiye:
yedek yol + tek seferlik dolum betiği (`tests/donem-katilimci-doldur.py`
aynı deseni kullanıyor, örnek olarak bakılabilir).

### 2. Kira üç senaryo demek

- **(a) Herkes kendi kirasını ev sahibine öder** → kişisel harcama.
  Bugün de çalışıyor, hiçbir şey gerekmiyor.
- **(b) Kira eşit bölüşülür, bir kişi öder** → normal ev harcaması.
  Bugün de çalışıyor.
- **(c) Farklı tutarlar, bir kişi toplar** → 1200 € ödeyen kişinin yaptığı,
  şu üçünün toplamı: kendi payı (`self`) + A için ödediği (`roommate`) +
  B için ödediği (`roommate`). **Üçü de bugün var.** Yani hesap motoruna
  dokunmadan çıkarılabilir; gereken tek şey bunları tek satır gibi göstermek
  (kayıtlara ortak bir etiket koyup arayüzde gruplamak).

Bu, turun en önemli bulgusu: **`_compute_balances` değişmeyebilir.**

### 3. Kişi seçim penceresi

Yatay çip şeridi çoklu seçime uygun değil. Alttan açılan, çoklu seçim yapılan
bir pencere gerekiyor. `src/ui.tsx` içindeki `SelectRow` deseni örnek alınabilir
(Modal + alt sayfa + kilit/işaret desteği zaten var).

### 4. Evden ayrılma akışı

Bugünkü kural: açık dönemde harcaması olan üye çıkarılamıyor, önce dönem
kapatılmalı. Ama dönem kapatmak **herkesi** etkiliyor — bir kişinin taşınması
yüzünden kalan üçünün defteri kapanıyor.

Doğrusu: ayrılan kişinin **kendi** hesabı kapansın (net bakiyesi hesaplanıp
ödenecek borç olarak dondurulsun), kalanların dönemi hiç bozulmadan devam etsin.
`split_with` geldiğinde bu kendiliğinden kolaylaşıyor: ayrılan kişi sadece
**yeni** harcamaların listesine girmemeye başlar, eski harcamalardaki payı
zaten o harcamanın içinde yazılı olduğu için hiçbir şey yeniden hesaplanmaz.

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
Sonra Tur 4'e başla.
```
