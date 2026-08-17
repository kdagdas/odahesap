# Sıradaki tur — Tur 10: sadeleşme ve sayfa düzeni

> Bu dosya yeni bir sohbet penceresine geçerken bağlamı taşımak için yazıldı.
>
> Son durum: **APK v42**, **596 kontrol** geçiyor, `main` çalışır durumda.
> Ayrıntı ve gerekçeler için [PROJE-DOKUMANI.md](PROJE-DOKUMANI.md) §12,
> günlük operasyon için [DEVAM.md](DEVAM.md).

## v33 → v42 arasında ne oldu

Uzun bir arayüz ve doğruluk turu. Sırayla:

**Hatalar (hepsi cihazda ya da testle doğrulandı)**

| Ne | Kök sebep |
|---|---|
| Alt sayfa gezinme çubuğunun altında kalıyordu | Modal penceresini ÖLÇMEK. Dört deneme sürdü; çözüm ölçümü tümden bırakmak — güvenli alan kök sağlayıcıdan okunup sayı olarak veriliyor + `statusBarTranslucent`/`navigationBarTranslucent` |
| Sekmeli ekranlarda ~120px boş kaydırma | Sekme çubuğu `position: absolute` değil; React Navigation ekranı zaten üstünde bitiriyor, `useScrollPad` çubuk yüksekliğini boşuna ekliyordu |
| `roommate` harcamaları hiçbir istatistikte yoktu | `_month_expenses` `target_type` etiketine bakıyordu |
| Anasayfa "sen + Salih" alımını EVE yazıyordu | `/stats` etikette kalmıştı, `/stats/monthly` listeye geçmişti — iki uç aynı olayı farklı sayıyordu |
| Kasa'daki "payın" düz ortalamaydı | `toplam/üye` gösteriliyordu; bakiye `expense_shares` ile hesaplanıyor, ekranda uyuşmazlık görünüyordu |
| **Dönem seçici başkalarının kişisel harcamalarını sızdırıyordu** | `/periods` özeti her harcamayı sayıyordu |
| İstatistik marketleri üçe bölüyordu | `_breakdown` ham adla grupluyordu, `normalize_merchant` çağrılmıyordu |
| Karanlık temada ikonlar/çizgiler kayboluyordu | `colors.dark` bazı yerlerde zemin, bazı yerlerde ön plan |
| Karartma alttan yukarı süzülüyordu | `Modal animationType="slide"` pencerenin tamamını kaydırıyordu |

**Gelenler:** karanlık tema (sistem takipli), tek yüzlü ödeme sayfası,
alacaklının kendi ekranından ödeme bilgisi paylaşması, IBAN mod-97
doğrulaması, çapalı `https` paylaşım bağlantısı + `assetlinks.json`,
bildirim türlerinin ayrılması, vade odaklı Düzenli Ödemeler, Profil'in
sahipliğe göre gruplanması, gün başlıklı harcama listesi, fiş incelemede
açılır satır, üye satırında ⋯ menüsü, alınacaklarda kaydırarak silme,
animasyon paketi, ve **alınacaklar ↔ fiş köprüsü**.

**Yeni test dosyaları:** `aylik-kapsam-test.py` (29), `etiket-bazli-test.py`
(21), `kopru-test.py` (18). Toplam 550 → 596.

## Kararlaştırılan ama YAPILMAYANLAR — Tur 10 buradan başlıyor

Bunlar konuşuldu, maketleri onaylandı, koda girmedi:

1. **Üç boy başlık sistemi.** Başlık yükseklikleri ekrandan ekrana %17–33
   arasında geziniyor; her ekran kendi yüksekliğini uyduruyor. Material 3'ün
   küçük/orta/büyük ayrımı gibi üç boy tanımlanıp her ekran birine atanacak.
   S = yalnızca kimlik · M = kimlik + tek durum/sekme · L = kahraman sayı.
2. **Sekme anahtarının tek yeri.** Alınacaklar'da lacivertte, İstatistik'te
   beyaz yüzeyde — aynı iş, iki yer. Hep lacivertte olacak.
3. **İstatistik penceresi Kasa'nın hapıyla aynı biçime gelsin**, yanında
   dönem aralığı sessizce dursun.
4. **Eğride dönem başı çizgisi.** Ay 1'inde başlıyor ama dönem 3'ünde
   başladıysa ayın ilk iki günü önceki döneme ait — kesikli yeşil çizgi bunu
   yazıyla değil gözle söylüyor.
5. **Kart başlıklarına pencere.** Aynı sayı iki ekranda aynı adla geçiyorsa
   penceresi başlıkta yazar: "Ağustos'taki Katkın", "Kim Kime Borçlu · 3–16
   Ağustos". (Kasa tarafı yapıldı, İstatistik tarafı kaldı.)
6. **Başlıktaki sönük "İstatistikler" hapı kalksın**, giriş "Tümü ›" olsun —
   aynı odaya iki kapı var, ikincisi zayıf olan.
7. **İstatistik'te "Toplam"ın yeşili nötre dönsün** (yeşil = alacak demek).
8. **Anasayfa'da "dikkat isteyenler" şeridi** — yalnızca varsa en üstte.

## Tur 10'un MERKEZİ: Ay ↔ Dönem anahtarı

Yukarıdaki 3-5 belirtiyi hafifletir ama **sebebi kaldırmaz.** Sebep: kullanıcı
hangi pencereye baktığını *seçemiyor*. Ev sahibi bu turda defalarca karıştırdı
ve uygulamayı yazan kişi o — kullanıcının hiç şansı yok.

İstatistik'teki hap gerçek bir anahtar olacak: **`Ay | Dönem`**.

- Sunucu: `_month_expenses` ay sınırı yerine genel bir **aralık** alacak;
  "geçen ay" karşılaştırması "önceki dönem"e dönüşecek
- İstemci: eğrinin x ekseni değişken uzunluk kaldıracak (dönem üç hafta da
  olabilir yedi hafta da)
- Kendi test takımı

**Tahmin: ~1 gün.** Ev sahibi "öbür türlü olmayacak" dedi ve haklı.

## Ödeşme sıklığı + dönem kapatma hatırlatması

Ev ayarlarına **"Ödeşme sıklığı"** geliyor: haftalık / iki haftada bir /
aylık / hatırlatma istemiyorum. Vadesi gelince **iki ayrı bildirim**:

- **Borcu olanlara:** "Dönem kapanmak üzere · Salih'e 40,60 € borcun var"
- **Yöneticiye, ancak herkes ödeştiyse:** "Dönem kapatılabilir"

Tek genel hatırlatma yanlış olurdu: borcu olmayana anlamsız gelir, yöneticiyi
de ödeşilmeden kapatmaya iter (PROJE-DOKUMANI §12'deki endişe). **Hatırlatma
asla kendiliğinden kapatmaz** — düzenli ödemelerdeki kuralın aynısı.

Zamanlanmış işi **kira hatırlatmasıyla paylaşıyor** (GitHub Actions, günlük).
Tahmin: ~3-4 sa, ikisi birlikte.

## Uygulama içinden tema seçimi — iki yol

`StyleSheet.create` modül yüklenirken çalışıp o anki renkleri içine gömüyor;
sonradan `colors`'ı değiştirmek çalışmıyor.

| Yol | Ne | Maliyet |
|---|---|---|
| **A** | Ayarlarda Açık/Koyu/Sistem, *bir sonraki açılışta* geçerli | ~30 dk |
| **B** | Gerçek canlı tema — 22 dosyada 1.234 satır stil bileşen içine | ~1 gün |

**A önerildi.** B'nin kazancı estetik, maliyeti riskli bir refaktör; sistem
teması zaten Android'de tek dokunuş uzakta.

## Köprüde eksik kalan filtre

Fiş tarihi, maddenin listeye yazıldığı tarihten **önceyse** eşleştirme.
Gerekçe: fişler biriktirilip toplu giriliyor; iki hafta önceki krema bu
haftaki ihtiyaç değil. Tek satırlık iş. Otomatik işaretleme olmadığı için
kritik değil ama her yanlış öneri doğru önerilere olan güveni azaltıyor.

## Tur 9'dan kalanlar — hâlâ faturalandırma bekliyor

Hız sınırlaması ve paralel toplu tarama. **Ev sahibi faturalandırmayı
şimdilik açmayacağını söyledi** (17 Ağustos 2026). Fiş küçültme bundan
bağımsız çıktı ve v36'da yapıldı.

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
| 9 | Fiş küçültme; gezinme çubuğu, tek yüzlü ödeme, etiket bazlı istatistik | v33–41 |
| B | Alınacaklar ↔ fiş köprüsü | v42 |

## Sonraki adaylar

- **Alınacaklar–fiyat köprüsü** — genel ürün adı bunu mümkün kıldı: listeye
  "süt" yazınca evin en son kaça aldığı gösterilebilir. Birkaç hafta veri
  birikmesi gerekiyor.
- **Faturalar kartı** zaten hazır, 2-3 aylık düzenli ödeme verisi bekliyor
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
Sonra Tur 10'a başla.
```
