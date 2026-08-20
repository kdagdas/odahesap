# Sıradaki tur — Tur 12

> Bu dosya yeni bir sohbet penceresine geçerken bağlamı taşımak için yazıldı.
>
> Son durum: **APK v44 (sürüm 1.2.0)**, `main` canlıya deploy edildi.
> **Tur 10 (para çekirdeği) ve Tur 11 (analiz sayfası) bitti.**
> Uygulamanın bugünkü hâli için [PROJE-DOKUMANI.md](PROJE-DOKUMANI.md),
> günlük operasyon için [DEVAM.md](DEVAM.md).
>
> Aşağıdaki KARAR başlıkları Tur 10/11'in gerekçeleridir ve **hâlâ
> geçerlidir** — bir sonraki oturum bunları yeniden tartışmasın diye duruyor.

---

## Bu tur nasıl bu hâle geldi

Tur 10 "sadeleşme ve sayfa düzeni" olarak planlanmıştı ve merkezinde
**Ay ↔ Dönem anahtarı** vardı: kullanıcı hangi pencereye baktığını seçemiyordu,
biz de ona bir anahtar verecektik.

Konuşma sırasında ev sahibi otomatik dönem kapatma + devreden borç önerdi.
Onu incelerken asıl kusur çıktı: **dönem aynı anda üç iş birden yapıyor** —
harcamanın kabı, raporlamanın penceresi ve ödeşmenin birimi. Karışıklığın
sebebi buydu; anahtar o karışıklığın üstüne konacak bir yamaydı.

Ev sahibi otomatik kapatmadan da vazgeçti ve gerekçeleri doğruydu: aylık sabit
giderler (kira) bir aydan kısa dönemlerde bir döneme düşüp diğerine düşmüyor
ve istatistikleri bozuyor · haftalık ödeşen ev yine aylık istatistik istiyor ·
bir ay sonra girilen fiş hangi haftaya yazılacak sorusu cevapsız kalıyor.

Sonuç: **anahtar yapılmayacak, çünkü sebebi ortadan kalkıyor.**

---

## KARAR 1 — Dönem para hesabından çıkıyor

### Bugün ne oluyor

`POST /periods/close` bakiyeleri `final_balances` olarak arşivliyor ve yeni
dönemi **sıfırdan** başlatıyor. Bildirim birebir şunu diyor:
*"Dönemi kapattı, yeni dönem başladı. Bakiyeler sıfırlandı."*

Yani biri ödeşmeden dönem kapanırsa **borç canlı ekrandan siliniyor.** Kayıt
arşivde duruyor ama kimse bir daha bakmıyor. Sessiz bir kayıp.

### Yeni model — ve onu uygulamanın ŞAŞIRTICI DERECEDE ucuz yolu

Gerçek veriye bakarken çıktı (18 Ağustos 2026): `_compute_balances()`'ı
yeniden yazmaya gerek yok.

> **Açık dönem zaten "ödeşilmemiş her şey" demektir** — yeter ki dönem
> *yalnızca ödeşildiğinde* kapansın.

Yani mekanizma duruyor, kapanma koşulu değişiyor:

- **"Dönemi kapat" düğmesi kalkar**, yerine **"Ödeştik"** gelir. Fark
  kritik: eskisi bakiyeleri **siliyordu**, yenisi önerilen transferleri
  **gerçek ödeme kaydı olarak yazıyor.** Aynı insan jesti ("nakit ödeştik,
  bitti"), dürüst defter.
- **Dönem yalnızca bakiye sıfıra değince, kendiliğinden kapanır.** Kapanınca
  kaybolacak bir borç kalmaz — asıl hatanın kökü buydu.

> **Neden "Ödeştik" şart oldu.** Önce yalnızca otomatik kapanma planlanmıştı:
> herkes kendi ödemesini işaretler, bakiye sıfırlanır, dönem kapanır. Ama
> ödeme kaydını yalnızca *tarafları* girebiliyor, yani kapanma herkesin tek
> tek uygulamayı açmasına bağlı kalıyordu. Yedek ölçüldü: `settlements`
> koleksiyonunda **sıfır kayıt** — bu evde bugüne kadar hiç ödeme
> işaretlenmemiş. Yani o kapanma hiçbir zaman gerçekleşmezdi. Düğme bir
> *insan mutabakatıydı* ve onu kaldırmak gerçek bir kayıptı.
- Ödeşilmezse dönem **açık kalır** ve aylarca sürebilir. Kasa o tek açık
  dönemi gösterir, "önceki aylardan devir" satırı da o uzun dönemin içindeki
  harcamaların **tarihlerinden** çıkar.
- İstatistik dönemi zaten hiç kullanmıyor; takvim ayına geçer.

Üç kazancı var:

**Göç yok.** Bugün kapalı olan dönemler kapalı (ödeşilmiş) kalır, açık olan
açık kalır. Hiçbir harcamanın dönemi değişmez. *(Ölçüldü: ev `hh_2ca8b3e81`,
kapalı `per_a235730a` 19 harcama / 231,48 € test verisi; açık `per_a1fb4085`
27 harcama / 496,55 € gerçek ve ödeşilmemiş. İkincisine hiçbir şey olmuyor.)*

**Geriye uyumluluk bedava.** `_compute_balances(household_id, period_id)`
imzası aynı; `/balances` ve `/periods` aynı biçimde cevap veriyor. Eski APK'lar
(v42) çalışmaya devam ediyor.

**Geri dönüş tek satır.** Beğenilmezse kapatma düğmesi geri konur; veri hiç
ayrışmadığı için başka hiçbir şey gerekmez.

Kapalı dönemin dokunulmazlığı da kendiliğinden doğru anlama gelir:
**kapalı = ödeşilmiş**, ve ödeşmiş geçmiş değişmemeli.
- Eşik **bir kuruş** (`|net| < 0,01`). Çizgi yalnızca **gerçekten silinen bir
  borç varsa** çizilir — yeni kurulmuş, hiç harcama girilmemiş bir evde
  "Ev ödeşti" yazmak saçma olurdu.
- Dokunulmazlık kuralı tekleşir: **ödeşme çizgisinden öncesi değişmez.**
  Bugünkü "kapalı dönem" kontrollerinin hepsi tek bir tarih karşılaştırmasına
  iner.

### Göç

Bugüne kadar kapatılmış dönemlerdeki ödenmemiş bakiyeler **ödenmiş sayılır.**
Devir yalnızca bundan sonrası için işler. Aksi hâlde insanların aylar önce
unuttuğu, muhtemelen elden ödeştiği borçlar bir sabah ekranda belirir.

### Dokunulacak yerler

`_compute_balances()` · `period_participants()` · `/balances` · `/periods`
(→ ödeşme geçmişi) · `POST /settlements` (bugün "Aktif dönem bulunamadı" diye
400 dönüyor, o kontrol kalkacak) · `DELETE /settlements/{id}` (kapalı dönem
kontrolü yerine ödeşme çizgisi) · `e2e` · `admin` · `donem-dondurma` ·
`remove-member` · `settle-edit` test takımları.

---

## KARAR 2 — Görüntülemenin her yerinde takvim ayı

Uygulamada iki bağımsız cetvel var ve **birbirlerine hiç bakmıyorlar:**

| Cetvel | Birim | Nerede |
|---|---|---|
| Görüntüleme | takvim ayı, her zaman | Anasayfa, İstatistik, harcamalar, üye dökümü |
| Ödeşme | ne zaman denk gelirse | Kasa |

Bugün Anasayfa dönem bazlı, İstatistik ay bazlı, Kasa dönem bazlı sayı
gösteriyor — aynı olay üç ekranda üç farklı rakam. Aylık geçişten sonra
**Anasayfa ve İstatistik birebir aynı sayıyı** gösterir.

### Kira sorunu kendiliğinden çözülüyor

Dönem 35 günse kira 35'e, 25 günse 25'e bölünüyor ve evin "günlük hızı" kimse
davranışını değiştirmediği hâlde oynuyordu. Pencere hep takvim ayı olunca kira
her pencerede **tam bir kez** düşer: `1200 ÷ 31 = 38,7` · `1200 ÷ 30 = 40,0`.
Fark yok.

Bu yüzden **"sabit giderleri istatistikten ayırma" fikri gereksiz.** O fikir
dönem uzunluğu değişken olduğu için gerekiyordu.

### Ay sınırı bir OLAY değil, bir OKUMA

Ayın sonunda hiçbir şey olmaz: kapanmaz, kilitlenmez, bildirim gitmez, vade
doğmaz. Ay sınırı yalnızca şu cümleyi kurabilmek için kullanılır:
*"Önceki aylardan 18,00 €"* — yani **31 Temmuz sonundaki bakiyen.**

Bunun bir yan faydası: **geç girilen fiş sorunu tamamen kaybolur.** 20 Temmuz
tarihli bir fiş bugün girilirse Temmuz sonu bakiyesi yeniden hesaplanır,
"önceki aylardan" satırı büyür, kalan borç aynı miktarda artar. Kilitlenmiş
bir şey olmadığı için düzeltilecek bir şey de yok.

**Geç fiş kendi gerçek tarihine yazılır.** İstatistik güncellenir (Temmuz'un
resmi *daha doğru* hale gelir), borç bugüne düşer, ödeşilmiş para değişmez.
Bugün bundan korkmanın sebebi para ile istatistiğin birbirine kaynamış
olmasıydı; kaynağı sökünce korku da gidiyor.

Bildirim tek satır: *"Salih 20 Temmuz tarihli bir fiş ekledi · ödeştiğiniz
tarihten önce · 12,40 € bakiyene eklendi."*

---

## KARAR 3 — Kasa'nın yeni yapısı

### Ekstre bloğu (koyu başlıkta)

```
Önceki aylardan          18,00
Ağustos payın            62,60
Ödediklerin             -40,00
------------------------------
Kalan borcun             48,20 €
```

**Devir bir dağıtım değil, bir enstantane:** `31 Temmuz sonundaki bakiyen`.
Bu yüzden **FIFO gerekmiyor** — ödediğin 40 €'nun "hangi ayın borcu" olduğunu
bilmeye gerek yok, zaman dilimi hesabı kendi kapatıyor.

**Ekstre bloğunda devir tek satırdır** ("Önceki aylardan" = bütün geçmiş
ayların toplamı). Ay ay ayrıntı ekstre bloğunda değil, **borç dökümü
sayfasında** yaşar (aşağıda).

**Devir KİŞİ bazında dökülmez.** Sebep maliyet değil doğruluk: sadeleştirme
her seferinde kimin kime ödeyeceğini yeniden hesapladığı için "Temmuz'dan
Salih'e 18 €" diye bir şey yoktur — Ağustos'un harcamaları girince o borç
Ayşe'ye ödenecek hale gelebilir.

**Ama AY bazında dökülür ve bu kurgu değil, kesin aritmetiktir:** her ayın
satırı *o ay bakiyenin ne kadar değiştiği*. Toplamları borcu verir, FIFO
gerekmez. Dil buna göre kurulur — "Haziran'dan kalan 48 €" kurgudur (hangi
euro'nun kaldığı bilinemez), **"Haziran'da 48 € borçlandın"** olgudur.

Blok **kendiliğinden dönüyor:** alacaklıda etiketler "önceki aylardan ·
ödediklerin · senin payın · ev sana borçlu" olur. Aynı dört satır, ayrı bir
tasarım gerekmiyor. Ev kaç kişilik olursa olsun blok dört satır kalır.

### İnce köprü

Bugünkü köprü ~140 piksel; yenisi **~64.** Tek satır: avatar · isim · aradaki
çizgi · avatar · isim, tutar çizginin altında, düğme sağda hap olarak. İki
avatar ve çizgi duruyor çünkü yönü onlar söylüyor.

- **En büyük borç koyu düğme, diğerleri çerçeveli.** Sıra değil miktar
  belirler — önce büyüğü kapatmak istersin.
- **Alacak tarafında koyu düğme yok.** Orada yapılacak bir iş değil,
  onaylanacak bir şey var.
- **Satır anlatır, düğme öder.** Düğme dışında her yere dokunmak "bu borç
  nereden geliyor" sayfasını açar.
- İkiden fazla köprü olursa (beş kişilik ev) liste düzenine iner.

### Kartlar

| Kart | Ne zaman |
|---|---|
| Borçların | senin ödeyeceğin en az bir transfer varsa |
| Alacakların | sana ödenecek en az bir transfer varsa |
| Evdeki diğer ödemeler | seni ilgilendirmeyen transfer varsa · katlanmış |
| Ödeme Geçmişi | en az bir ödeme varsa · son 2, gerisi "Tümü ›" |

**Sadeleştirme açıkken ilk iki kart aynı anda dolu olamaz** —
`simplify_debts()` her kişiye tek net verir, kişi ya borçludur ya alacaklı.

**"Ödeme bilgini paylaş" kartın dibinde tek satır.** Bugün her borçlunun
satırında ayrı ayrı duruyor, oysa paylaşılan IBAN hepsinde aynı.

### Borç dökümü (satıra dokununca) — AY AY

Üç ay ödeşilmemişse üç ay da görünür. Bulunduğun ay açık gelir, geçmiş aylar
tek satıra kapanır:

```
Salih'e 40,60 € nereden geliyor
3 aydır ödeşilmedi

Haziran                       +48,00  >
Temmuz                        -30,00  >
Ağustos                       +22,60  v
    Ev alışverişlerindeki payın 62,60  >
    Kemal'in senin için aldıkları 8,40 >
    14 Ağu · Salih'e ödedin    -40,00  >
    2 Ağu · Kemal senin için ödedi -8,40 >
-------------------------------------
  Ödenecek                     40,60
```

- **Değişimi sıfır olan ay hiç çizilmez.**
- Bir ayda ödediğin borçlandığından fazlaysa satır **yeşil ve eksi** çıkar.
- **Ara ödemeler kendi ayının içinde**, kendi satırları olarak durur — senin
  yaptıkların da, bir başkasının senin yerine ödedikleri de.

Bir aya dokununca o ayın içi açılır: fişler (sağda iki sayı — *senin payın*
büyük, fişin tamamı küçük), düzenli ödemeler, ve o ayki ödemeler. Bir fişe
dokununca **kalemlere** iner. Borcun en dibinde havuç var; **hiçbir rakip bu
katı gösteremez.**

Gizlilik sorunu yok: zaten bölüşme listesinde olduğun harcamalar.

### Ödeme geçmişi

Gün başlıklı, yön ikonlu. Alt satır *"52,40 borçtan · kalan 12,40"* der. Bir
ödemeye dokununca: tutar, o anki borç, bu ödeme, kalan, "bu borç nereden
geliyordu ›" ve **geri al** (yalnızca taraflar).

Ödeşme anı listede yeşil bir çizgi olarak durur: *"16 Ağustos · Ev ödeşti"*.

### Ödeşme akışı DEĞİŞMİYOR

Bugünkü davranış doğru ve kalıyor: **iki taraftan biri kaydeder** (üçüncü kişi
403 alır), **kayıt anında düşer, onay adımı yok**, karşı tarafa bildirim
gider, **iki taraftan biri geri alabilir** ve geri alma da bildirim üretir.

Onay adımı bilerek yok: ikili bir gerçek yaratırdı ("ödedim ama onaylamadı"
durumunda bakiye kaç?), alacaklıyı borçlunun hakemi yapardı, ve para zaten
gerçek dünyada hareket etmişti. **Defter izin istemez.** Yanlışsa geri alınır —
düzeltme, kapı bekçiliğinden ucuzdur.

### Sadeleştirme AÇIK kalıyor, ayar konmuyor

Splitwise'da bu bir grup ayarı ve varsayılan açık; forumunda "kapatılabilsin"
talepleri var, kurucusu da algoritmanın *"kimse daha önce borçlu olmadığı
birine borçlu hale gelmez"* kuralını tutmadığını kabul etmiş.

Bizde **ayar konmayacak.** Gerekçeler:

- Ayar, kullanıcıya anlamadığı bir soruyu sormaktır
- Splitwise'ın somut hatası bizde de olurdu: ayar ödemeler yapıldıktan sonra
  değiştirilirse ödeşmiş insanlar yeniden borçlu çıkıyor
- **Döküm, ayarın çözdüğü asıl sorunu ayar olmadan çözüyor.** İnsanı rahatsız
  eden rakam değil, anlamamak: "ben Kemal'e ödeme yapmıyor muyum?"

Üç kişilik evde sadeleştirmenin kazancı zaten en fazla **bir transfer**
(3 ikili ilişki → 2 transfer). Altı kişilik evde 15 → 5, orada gerçekten
değerli. Ev büyürse ayar yeniden gündeme gelir; o zaman varsayılan açık ve
**ödeşme başladıktan sonra kilitli** olmalı.

---

## KARAR 4 — Anasayfa

```
EV
Bizim Ev                                    (zil)

AĞUSTOS'TA EV HARCAMASI
1.240,50 €
^ %12 · geçen ayın 16'sında 1.108 €

+-- Nereye Gitti --------------------+
|  halka + 4 kategori                |
|  --------------------------------  |
|  SANA DÜŞEN 413,50  KİŞİSEL 96,20  |
|  --------------------------------  |
|  Tüm istatistikler               > |
+------------------------------------+
```

### "Senin payın" → "Sana düşen"

Uygulamada sana ait **üç ayrı sayı** dolaşıyor ve "pay" kelimesi bunu
öğretmiyordu:

| Sayı | Ne demek | Nerede |
|---|---|---|
| **Ödediğin** | senin cebinden çıkan | Kasa |
| **Sana düşen** | ev harcamalarından payına düşen, kim ödemiş olursa olsun | Anasayfa, İstatistik |
| **Kişiselin** | kendine aldıkların | Anasayfa, İstatistik |

"Ödediğin − sana düşen = bakiyen" ilişkisi uygulamanın omurgası.

### Trend bir hap değil bir SATIR

Ana rakamın hemen altında, sola dayalı, **karşılaştırılan tutar yazılı.**
"geçen ayın 16'sında 1.108 €" yazınca kimse "%12 neyin yüzdesi" diye sormuyor
— gözüyle doğruluyor. Öznesini komşuluktan alıyor.

**Bugünkü hesap ay ortasında yanlış:** `change_pct` bu ayın *şu ana kadarki*
toplamını geçen ayın *tam* toplamıyla karşılaştırıyor, yani ayın 5'inde bakan
herkes "%80 azalış" görüyor. Doğrusu **aynı güne kadar** karşılaştırmak;
`prev_cumulative` zaten üretiliyor.

Kural merdiveni:

1. Geçen ayın aynı gününe kadarki toplam anlamlı mı → **yüzde**
2. %200'ü aşarsa → **"2,5 katı"** dili (yüzde büyüdükçe okunmaz oluyor)
3. Karşılaştırılacak geçmiş yoksa → **satır hiç çizilmez.** Dolgu metni yok,
   uydurma yok. Yeni evde başlık bir tık kısa olur, o kadar.

### "Günde ortalama" kalkıyor, yerine "Kişisel"

O sayının varlık sebebi dönemlerin farklı uzunlukta olmasıydı — üç haftalık
dönemle yedi haftalıkı ancak günlük hıza indirerek karşılaştırabiliyorduk.
Aylar zaten eşit. **Kişisel** ise kaydediliyor ama Anasayfa'da hiç
görünmüyordu.

**Kişisel sıfırsa o sütun çizilmez**, "Sana düşen" tek başına kalır — Kasa'da
sıfır sütunu gizleme kuralının aynısı.

### "Kişi başı" kalkıyor

Düz ortalama (`toplam / üye sayısı`) kişiye özel bölüşmede yanlış çıkıyor.
Kasa'da aynı hata bir kez düzeltilmişti; Anasayfa'da duruyordu.

### İstatistiğe iki kapı, ikisi de merakın oluştuğu yerde

1. **Trend satırı tıklanabilir** — "↑ %12" okuyanın aklından geçen soru
   "neden?" ve cevabı eğride
2. **Kart dibinde "Tüm istatistikler ›"** — dokuz kategorinin kalanı,
   marketler, faturalar için

Başlıktaki sönük "İstatistikler" hapı **tamamen kalkıyor** — aynı odaya iki
kapı vardı, zayıf olan gitti.

Kapı **koyu düğme değil, alt satır.** Uygulamanın kuralı "sayfada tek koyu
düğme" ve Anasayfa'nın birincil eylemi ortadaki fiş tarama.

### Dikkat şeridi

Kavisin hemen altında, **yalnızca varsa.** İçerik: bekleyen katılma isteği
(yöneticiye) ve — ileride yapılırsa — ödeşme hatırlatması.

**Vadesi gelen düzenli ödemeler GİRMEZ:** kendi kartı hemen altında duruyor,
ikisi birden olursa aynı iş iki kez yazılmış olur.

---

## KARAR 5 — İstatistik bir ANALİZ sayfası (Tur 11)

### Teşhis

Sayfa bugün Anasayfa'da az önce görülen halkayla açılıyor: aynı halka, aynı
kategoriler. İnsan girip "ha, aynısı" deyip çıkıyor. Sorun kapının küçüklüğü
değil, **odanın içinde yeni bir şey olmaması.**

**Halka kalıyor.** ("Değişim göstersin, halka çıksın" önerisi denendi ve ev
sahibi haklı olarak reddetti: burası yalnızca karşılaştırma sayfası değil,
*neyi nereye ne kadar harcadık* sayfası.) Fark **derinlik**: Anasayfa dört
kategori, analiz sayfası dokuzunu farklarıyla ve **içine girilebilir** hâliyle.

### Sayfa sırası

**Ay Boyunca** (eğri) → **Nereye Gitti** (halka + 9 kategori + farklar,
dilimler dokunulabilir) → **Son 6 Ay** → **En Çok Aldıklarımız** →
**Zamlananlar** → **Faturalar** → **Marketler** → **Kim Ne Kadar Ödedi**

Eğri başa alınıyor ki ilk ekranda Anasayfa'da olmayan bir şey görünsün.
Kolayca ters çevrilebilir bir karar; cihazda bakıp karar verilecek.

### Yeni kartlar

**En Çok Aldıklarımız — ürün bazlı aylık toplam.** `Süt · 14 lt · 3 markette ·
17,20 €`. Tur 8'in **genel ürün adı** işi sayesinde `MILSANI`, `MILBONA` ve
`JA!` tek satırda toplanıyor. Karşılaştırmaya ihtiyacı yok, **ilk aydan
itibaren dolu geliyor**, ve rakiplerin hiçbiri üretemez.

**Kategoriye gir.** Halkanın dilimine veya satıra dokununca: 6 aylık seyir +
"ne alındı" (kalem bazlı) + "nereden" (market bazlı).

**Markete gir.** Toplam, fiş sayısı, ortalama fiş, hangi kategoriler, hangi
fişler.

**Son 6 Ay.** Tek bakışta genel gidiş. Bu ay koyu, gerisi gri, altında 6 ay
ortalaması.

**Zamlananlar / Ucuzlayanlar.** Aynı market içinde aynı ürünün ay-ay birim
fiyatı. Ucuzlayanlar da listede — yalnızca zam göstermek insanı sürekli kötü
haberle karşılar.

- **Kaynak `price_points` DEĞİL.** O koleksiyon bilerek kimlik alanı
  taşımıyor, yani "bu evin fiyat geçmişi" oradan çıkarılamaz. Kaynak
  `POST /price-memory`'nin kullandığı yol: evin kendi `expenses` kayıtları,
  `source: "receipt"`, `normalize_merchant` + `product_key` + `pack_type`.
- **Ayın son fiyatı değil ayın MEDYANI** karşılaştırılır — kampanyalı bir
  hafta "ucuzladı" deyip ertesi ay "zamlandı" demesin.
- **%8 eşiği** — altındaki oynamalar yuvarlama ve kampanya gürültüsü.
- Bu ev üç farklı marketten çoğunlukla market markası alıyor; kart aylarca
  boş kalabilir. **Veri yoksa satır üretmez, sorun değil.**

### "Toplam"ın yeşili nötre dönüyor

Yeşil bu uygulamada "alacak" demek; senin toplam çıkışın alacak değil.

---

## TASARIM İLKESİ — kademeli açılım

> *"İnsanlar görmek istediği zaman görsün. Kimisi sadece son duruma bakar:
> benim borcum ne kadar. Yirmi fişi birden göstermek hem ekranı büyütüyor hem
> de ilgilenmeyene gereksiz bilgi veriyor."* — ev sahibi, 18 Ağustos 2026

Bu **tüm ekranlar için** geçerli bir kural, yalnızca borç dökümü için değil:

- Her ekran **tek bir cevapla** açılır (borcun ne kadar · ev ne harcadı)
- Ayrıntı **dokunuşla** gelir, kendiliğinden değil
- Her kat bir soruyu cevaplar ve bir sonrakini mümkün kılar:
  **bakiye → ay → hareket türü → fişler → kalemler**
- İlgilenmeyen kişi ilk katta durur ve ekranı kalabalık görmez

Uygulandığı yerler: borç dökümü (ay satırı → hareketler → fişler → kalemler) ·
Anasayfa'nın "Tüm istatistikler" kapısı · ödeme geçmişinin son 3'te durması ·
Kasa'da seni ilgilendirmeyen borçların tek satıra inmesi.

Karşıtı olan tasarım hatası: *bir ekranda her şeyi göstermek*. Bu turun
başındaki şikâyet — aynı sayının üç ekranda üç kez görünmesi — aynı hatanın
başka bir yüzüydü.

---

## Elenenler ve NEDEN elendikleri

Bir sonraki oturum bunları "eksik" sanıp geri getirmesin.

| Ne | Neden elendi |
|---|---|
| **Ay ↔ Dönem anahtarı** | Dönem hesaptan çıkınca iki pencere tek pencereye indi; anahtarın kıyaslayacağı bir şey kalmadı |
| **Otomatik dönem kapatma** | Aylık sabit giderler kısa dönemlerde bir döneme düşüp diğerine düşmüyor; geç girilen fiş sorunu büyüyor; kullanıcı kısıtlanıyor |
| **Eğride dönem başı çizgisi** | Dönem ekranlardan çıktı |
| **Kart başlıklarına pencere yazma** | Her yer "Ağustos" oldu, ayırt edilecek bir şey kalmadı |
| **Devreden borcun ay ay yaşlandırılması** | Sadeleştirme kimin kime ödeyeceğini yeniden hesapladığı için "Temmuz'dan X'e" bir kurgu olurdu |
| **Ödemenin dönemlere FIFO dağıtımı** | Devir bir enstantane olarak tanımlanınca gereksizleşti |
| **Sabit giderleri istatistikten ayırma** | Aylık pencere gürültüyü zaten öldürdü |
| **Sadeleştirme kapatma ayarı** | Anlaşılmayan bir soru + Splitwise'ın somut hatası (ödeme sonrası değiştirilirse ödeşmişler yeniden borçlu çıkıyor) |
| **Ödemeye onay adımı** | İkili gerçek yaratır, alacaklıyı hakem yapar; para zaten hareket etmiş |
| **Halkayı İstatistik'ten çıkarma** | Burası yalnızca karşılaştırma değil analiz sayfası — "neyi nereye ne kadar" da burada |
| **Ekstre disiplini (vade, gecikme dili)** | Ev arkadaşları arasındaki borç bankayla olan borç değil; "45 gündür ödenmedi" gereksiz sürtüşme üretir |

Önceki turlardan gelen elenmişler de geçerliliğini koruyor: sekme geçiş
animasyonu, EPC karekodu, bütçe ve hız göstergesi, sabit/değişken oranı kartı,
marketler arası fiyat karşılaştırması, kişi başına tüketim karşılaştırması.

> **DÜZELTME (19 Ağustos 2026):** bu listede "alt sayfa sürükleme jesti" de
> yazıyordu ama **yanlıştı** — jest `ui.tsx` → `SheetBody` içinde
> `PanResponder` olarak duruyor ve çalışıyor. Elenen şey jest değil, jesti
> *sayfanın içeriğinden* başlatmaktı: içerikten sürüklemek sayfanın içindeki
> listelerin kendi kaydırmasıyla kavga ediyor. Jest tutamağa bağlı kaldı.
> Belgedeki bu satır bir sonraki oturumun çalışan bir kodu sökmesine yol
> açabilirdi.

---

## Tur 10 — BİTTİ (19 Ağustos 2026, APK v43 · sürüm 1.1.0)

### Biten

Üç boy başlık · sekme anahtarı lacivert başlıkta · **dönemin para hesabından
çıkması** · ödeşme çizgisi · **"Ödeştik" düğmesi** · üyelik günlüğü
(`member_log`) + ayrılma bildirimi · aylık geçiş (`/stats/monthly`) · trend'in
ay ortası düzeltmesi · Anasayfa'nın yeni düzeni · Kasa'nın ekstre bloğu ·
köprü düzeltmeleri · ödeme geçmişi (`all_periods`) · borç dökümü ·
ekstrenin kalemlenmesi · tip ölçüleri (34→27, 21→19).

### KARAR — döküm ayrı sayfa değil, Kasa + Harcamalar

Son konuşmada borç dökümü sayfasının **gereksiz** olduğu ortaya çıktı. Ev
sahibinin itirazı: *"ev alışverişindeki paya tıklayınca beni harcamalar
sayfasına atıp sadece ev için aldıklarımızı gösterebilir. Bu şekilde hangi
ürünlerin olduğunu, ne zaman satın alındığını zaten görüyorum."* Doğru —
ayrı bir fiş listesi çizmek aynı işi iki yerde yapmak.

Yeni yapı **iki ekran**:

1. **Kasa** — ekstre satırına dokununca açılım **kavisin ALTINDA**, beyaz
   alanda bir kartta. Lacivertin içinde değil: satırlar 12 punto, orada altı
   satır daha açmak okunmaz bir yığın yapar; ayrıca lacivert alan bu turda
   "L boy" olarak tanımlandı ve içeriğe göre uzayınca üç boy sistemi
   anlamını yitirir. Dokunulan satır lacivertte **vurgulu** kalıyor, yoksa
   yukarısı ile aşağısı arasındaki bağ kopuyor.
2. **Harcamalar** — hareket satırına dokununca süzgeçli olarak açılıyor.
   Süzgeç hapı **başlıkta ve kaldırılabilir**: görünmezse insan "Sana düşen
   98,32"yi ayın tamamı sanır.

`app/(tabs)/borc-dokumu.tsx` **silinecek.** "Önceki aylardan" satırına
dokununca ay listesi aynı kartta açılır, her ay da kendi hareketlerine.

### Kalanlar — HEPSİ BİTTİ (19 Ağustos 2026)

Aşağıdaki 13 maddenin tamamı koda girdi. Madde başına ayrı commit; `main`
çalışır durumda, `tsc --noEmit` temiz.

1. ✓ **Ekstre satırları tıklanabilir**, açılım kavisin altında beyaz kartta;
   dokunulan satır lacivertte vurgulu, oku açıkken aşağı dönüyor
2. ✓ **Hareket satırı → Harcamalar**, süzgeçli (`?akis=…&ay=…`)
3. ✓ **Süzgeç SUNUCUYA taşındı.** "Senin için alınanlar 3 €" boş açılması bu
   yüzden çözüldü — gizlilik değil, eksik veriydi (Tur 4 öncesi kayıtlarda
   `split_with` yok, `split_of()` yedek yolu yalnızca sunucuda çalışıyor).
4. ✓ Harcamalar başlığında süzgeç hapı — **seçilebilir**, yalnızca
   kaldırılabilir değil (aşağıdaki cihaz turuna bakın)
5. ✓ `borc-dokumu.tsx` silindi + rota kaydı kaldırıldı
6. ✓ **Geri Kasa'ya** — `useGeriDon` geldiği yeri `?geri=` ile taşıyor
7. ✓ **Sekmeye dokununca en üstten** — `useBasaSar`, animasyonsuz
8. ✓ Ayrılan üye rozeti + borç tutarlı ayrılma onayı + bildirimde tutar
9. ✓ Anasayfa dikkat şeridi (yalnızca varsa, yalnızca yöneticiye)
10. ✓ İstatistik'te "Toplam"ın yeşili nötre
11. ✓ Köprüde tarih filtresi (fiş maddeden eskiyse eşleşme yok)
12. ✓ `member-detail` ay bazlı + kapısı Anasayfa'da + "Kişisel" doğru sayı
13. ✓ `.env` üretime döndü, sürüm **1.1.0 / versionCode 43**, APK derlendi

### CİHAZ TURU — asıl hatalar burada çıktı (19 Ağustos 2026)

Testlerin **hiçbiri** aşağıdakileri yakalamadı; hepsi ev sahibinin
telefonunda ortaya çıktı. Bu, "her turun sonunda APK" kuralının kanıtı.

**1. Kasa→Harcamalar süzgeci hiç çalışmıyordu.** Harcamalar bir sekme ekranı;
oraya "atlamak" ekranı yeniden kurmuyor, zaten kurulu ekrana yeni parametre
veriyor. `useState` yalnızca ilk kuruluşta okuduğu için, o sekmeye bir kez
uğramış biri Kasa'dan bir satıra dokunduğunda **hiçbir şey değişmiyordu.**
Çözüm `useEffect` ile parametre senkronu.

**2. Süzgeç ekseni yeniden kuruldu — alıcıdan BAĞIMSIZ.** Ev sahibinin
modeli daha temizdi: kategoriyi *bölüşme listesi* belirlesin, kimin ödediği
değil. Böylece iki eksen çarpılabiliyor:

| Kimin için | Tanım |
|---|---|
| **Eve alınanlar** | liste evin tamamı, kim almış olursa olsun |
| **Sana alınanlar** | seni İÇEREN alt küme, alan başkası (sen+Kemal de) |
| **Başkası için aldıkların** | alan sen, listede senden başkası da var |
| **Kendine aldıkların** | yalnızca sen |

`akis=ev` + `member_id=kemal` = "Kemal'in eve aldıkları". *"Senin ödediğin"*
diye ayrı bir seçenek YOK: kişi süzgecinde kendini seçmek zaten onu veriyor.

**3. Ekstre etiketi YALAN SÖYLÜYORDU.** *"Ev alışverişlerindeki payın
107,32"* satırı, ev harcaması **olmayan** ikili bir alışverişteki payı
(2,99) da içine katıyordu. Ev sahibi o sayıyı üçle çarpıp evin toplamını
bulmaya çalıştı ve yanlış rakama vardı. Gerçek veride ölçüldü:
`107,32 = 104,33 (gerçek ev payı) + 2,99`; evin toplamı 312,99, doğru
çarpan `104,33 × 3`.

`akis_paylari()` artık `kime_kategori()`'yi çağırıyor ve satırlar dört
kategoriyle **birebir**: `ev_pay`+`ev_odedigin` · `bana_pay` ·
`baskasi_pay`+`baskasi_odedigin` · (kendim hiçbiri). Her satır dokunulduğunda
Harcamalar'da tam o kümeyi açıyor. Toplamlar korunuyor.

> **×3 genel olarak YANLIŞ.** Bu evde tutmasının sebebi bütün ev
> harcamalarının tesadüfen eşit üçe bölünmüş olması. Kira 350/400/450
> bölündüğünde `payın × 3` evin toplamını asla vermez. Doğru yol her zaman
> süzgecin başlığındaki **iki sayıya** bakmak: fişin tamamı ve senin payın.

**4. Ödeşme çizgisi (ev sahibi önerdi).** Aylık pencerede bir ayın içinde
ödeşilmiş ve ödeşilmemiş harcamalar yan yana düşüyor. Liste artık
*"15 Temmuz · buraya kadar ödeşildi"* çizgisi çiziyor. **Soluklaştırma yok** —
çizginin bir kez söylediğini her satırda tekrar ederdi ve ayın çoğu satırı
ödeşilmiş olduğu için ekranın büyüğü "kapalı" görünürdü. (Bankacılıkta da
BEKLEYEN işlem işaretlenir, gerçekleşmiş olan değil.) Çizgi tarihe çizildiği
ama ödeşilmişlik döneme bağlı olduğu için, geç girilen fiş çizginin altında
kalıp **"ödeşilmedi"** işareti alıyor — çizgi böylece yalan söylemiyor.

**5. Ay seçici Temmuz'u gizliyordu.** Yalnızca `created_at`'e dayanıyordu;
geriye tarihli fiş ondan önceye düşebiliyor. Sunucu `first_expense_month`
döndürüyor, seçici **iki sınırın erkenine** iniyor.

**6. Başlıktaki "Süzülen toplam 417,18" kafa karıştırıyordu** — ev
harcamasını, kişiseli, başkası için alınanı bir torbaya atıyordu. Artık
süzgeçsizken tek sayı (kaç kayıt), süzgeçliyken o filtrenin toplamı **ve**
senin payın.

**7. Kişi süzgecinde isim tekrarı + avatar.** "Kemal" başlığının altında yine
"Kemal" yazıyordu. Alt satır kalktı, her kişi kendi avatarını taşıyor.
"Herkes" ikonla kaldı — üç avatarın yığını dar hapta yazıyla çakışıyordu.

**8. "ev" artık DONMUŞ bilgiden okunuyor** (`target_type`), bugünkü üye
listesinden değil — biri evden ayrıldığında geçmişteki bütün ev harcamaları
"ev değil" olacaktı.

Ayrıca: `member-detail`'de "Kişisel" yazan sayı `roommate_total` okuyordu,
oysa `roommate` *bir başkası için alınan* demek. Sunucu üçünü ayrı döndürüyor.
Ve proje ilk kez `tsc --noEmit` altında tamamen temiz.

### Cihaz denemesinden gelen ek düzeltmeler (19 Ağustos)

- **Ödeşme çizgisi.** Harcamalar'da bir ayın içinde ödeşilmiş/ödeşilmemiş
  kayıtlar yan yana düşüyordu. "15 Temmuz · buraya kadar ödeşildi" çizgisi
  kapanış tarihinden geliyor. Soluklaştırma yok (çizgi bir kez söylüyor);
  geç girilen fiş çizginin altında kalıp "ödeşilmedi" işareti alıyor.
- **Ay seçici evle sınırlı.** `sonAylar` evin `created_at`'inde duruyor.
- **Kişi süzgecinde isim tekrarı kalktı** (hint = tam ad idi).
- **İstatistik başa sarıyor.**

> **6 ve 7 gezinme davranışı** ve `expo-router`'ın sekme yığınıyla ilgili;
> beklenmedik bir şey çıkarsa cihazda denemek gerekiyor.

### Geliştirme ortamı (bu oturumda kuruldu)

- `D:\SettleUp\ortam.ps1` — `iex (gc D:\SettleUp\ortam.ps1 -Raw)`
- Telefon → bilgisayar: `adb reverse tcp:8098` · yerel sunucu **üretim
  veritabanıyla** (`DB_NAME=odahesap_db`, port 8098)
- Test sunucusu ayrı: `DB_NAME=odahesap_test`, port 8099
- **`frontend/.env` şu an `http://localhost:8098` gösteriyor.** Üretim adresi
  `.env.yedek-tur10` içinde ve **APK'dan önce geri konmalı**

---

## Tur 10 planı — para çekirdeği

Madde başına ayrı commit, turun sonunda tek APK (v43).

1. **Üç boy başlık sistemi.** `ScreenHeader`'a `size` prop'u. Boy yükseklik
   değil **içerik** kuralı: **S** = yalnızca kimlik (Ayarlar, Ev ayarları,
   Düzenle, Bildirimler, Ödeme bilgilerim) · **M** = kimlik + tek şerit
   (Alınacaklar, Harcamalar, Aktivite, Düzenli, Profil) · **L** = kahraman
   sayı (Anasayfa, Kasa, İstatistik, üye dökümü).
2. **Sekme anahtarı tek yerde.** İstatistik'teki Ev|Kişisel beyaz yüzeyden
   lacivert başlığa (`onDark`) taşınıyor — Alınacaklar'daki gibi.
3. **Dönem para hesabından çıkıyor.** Sunucu: `_compute_balances()`,
   `period_participants()`, `/balances`, `/settlements`. Göç: geçmiş kapalı
   dönemler ödenmiş sayılır.
4. **Ödeşme çizgisi.** Bakiye sıfıra değince otomatik kayıt + bildirim. Dönem
   kapatma düğmesi kalkıyor.
5. **Aylık geçiş.** `/stats` dönem yerine ay; `/periods` özeti ödeşme
   geçmişine dönüşüyor; `member-detail` ay bazlı.
6. **Kasa'nın yeni yüzü.** Ekstre bloğu, ince köprüler, Borçların/Alacakların
   kartları, paylaşma satırı kartın dibinde.
7. **Borç dökümü.** Yeni uç + üç kademeli sayfa (kaynak → harcamalar →
   kalemler).
8. **Ödeme geçmişi.** Kasa'da son 2 + "Tümü" sayfası + ödeme detayı.
9. **Anasayfa'nın yeni düzeni.** "Sana düşen", trend satırı (aynı güne göre),
   "günde ortalama" ve "kişi başı" kalkıyor, İstatistik hapı kalkıyor, kart
   dibinde "Tüm istatistikler ›".
10. **Dikkat şeridi.**
11. **İstatistik'te "Toplam"ın yeşili nötre.**
12. **Köprüde tarih filtresi.** Fiş tarihi, maddenin listeye yazıldığı
    tarihten önceyse eşleştirme (tek satır).
13. **Testler.** Dönem semantiği doğrulayan takımlar yeniden yazılacak; yeni
    takım: ödeşilmemiş bakiye, devir, ödeşme çizgisi.
14. **Belgeler + APK v43.**

## Tur 11 — BİTTİ (19 Ağustos 2026, APK v44 · sürüm 1.2.0)

Ekranda adı artık **"Analiz"** — sayfa sayı listelemiyor, soru cevaplıyor.
Dosya/rota adı `istatistik` olarak kaldı (yeniden adlandırmak sekiz dosyada
import kırardı).

### Gelenler

**Son N Ay çubuğu** · **En Çok Harcadıklarımız / En Sık Aldıklarımız** (iki
ikonlu eksen anahtarı) · **Tüm Ürünler** sayfası · **Kategori sayfası**
(6 aylık seyir + ne alındı + nereden) · **Market sayfası** (seyir + ne
alındı + fişler, fiş yerinde açılıyor) · **Fiyat Hareketleri** ·
Marketler kartına geçen ay sütunu · sayfa değere göre sıralandı.

Ayrıca Tur 11'in başına alınan üç jest işi: silme kaydırması parmağı takip
ediyor · bir kerelik kaydırma ipucu · alt sayfa tutamağı.

### Sayfa sırası ve GEREKÇESİ

İlke: **ilk ekran Anasayfa'da olmayan bir şey göstermeli.** Halka ve "Kim Ne
Kadar Ödedi" orada zaten var.

1. **Fiyat Hareketleri** — sürpriz; insanı geri getiren şey grafik değil,
   "kahve %25 zamlanmış" cümlesi
2. **Son N Ay** — genel gidiş, tek bakış
3. **Ay Boyunca** — ay ortasında değerli
4. **Nereye Gitti** — dokuz kategori + değişim, içine girilebilir
5. **En Çok Harcadıklarımız** — eksen anahtarlı
6. **Faturalar** · 7. **Marketler** · 8. **Senin Katkın** ·
9. **Kim Ne Kadar Ödedi** (Anasayfa'da zaten var)

### Bu turda ORTAYA ÇIKAN sessiz hatalar

Hepsi yalnızca yeni ekranlar veriyi **okumaya başlayınca** göründü. Testler
hiçbirini yakalamadı.

| Ne | Kök sebep |
|---|---|
| **`generic` kayda hiç ulaşmıyormuş** | OCR üretiyor, sunucu gönderiyor, `review.tsx` düşürüyordu. Tur 8'den beri ölü; 206 kalemin hiçbirinde yoktu |
| **Birim etiketi yanlış** | 12 kalem "kesirli adet" (7,105 adet tavuk olmaz). `tests/birim-duzelt.py` ile kg'ye çevrildi |
| **Fiyat kartı yalan söylüyordu** | `adet` sınıfında boyut bilinmiyor: "Wassermel. XXL 6→10,60 = +%77" iki farklı boy karpuzdu. O sınıf çıkarıldı |
| **Kapsam taşınmıyordu** | "Kişisel"den girilen kategori evin harcamasını gösteriyordu |
| **Başkasının fişi düzenlenebilir görünüyordu** | Sunucu 403 veriyordu (veri risk altında değildi) ama istemci formu açıyordu |
| **Donanım geri tuşu** | X düğmesi doğruydu, telefonun geri jesti sekme yığınının dibine düşüyordu |

### Kalıcı ders

**Ölçmeden gönderme.** Fiyat kartı ilk sürümünde dört satır üretiyordu ve
dördü de yanlıştı; gerçek veriye bakılmasa kullanıcıya "zam" diye
gösterilecekti. Ev sahibinin cümlesi kural olarak kalsın:
*"yanlış bir şey göstermek, göstermeye çalışmaktan daha kötü."*

---

## Tur 12 — BİLDİRİM BLOĞU (20 Ağustos 2026, kod girdi, APK yok)

Planlanan listede yoktu; cihaz kullanımından geldi ve öne alındı çünkü her
gün karşılaşılan bir şeydi. Yedi madde, madde başına commit; `main` çalışır
durumda, `tsc --noEmit` temiz, Metro paketi derleniyor, `aktivite-test.py`
32/32 (e2e · odestik · settle-edit · duzenli takımları da yeşil).

### Ne geldi

1. ✓ **Bildirimler silinebiliyor** — sola kaydır sil · "Temizle" (yalnızca
   okunmuşlar) · okunmuşların 30 gün sonra kendiliğinden dökülmesi. Okunmamış
   hiçbir kurala girmiyor.
2. ✓ **Bildirime dokunmak ilgili ekranı açıyor** — hem sistem bildirimi hem
   Aktivite satırı, tek harita (`src/bildirimYolu.ts`). Harcama bildirimleri
   fişi açıp ekrana getiriyor; ödeme bildirimleri Kasa'nın Ödeme Geçmişi'ni.
3. ✓ **Kaydırma ipucu her açılışta bir kez**, yarım açılımla, ve iki ekranda
   ortak (`ui.tsx`).
4. ✓ **Ortalama çizgisi hatası** — Analiz'deki çubuk grafiğinde çizgi
   çubuklarla farklı tabandan ölçülüyordu, hep 21 piksel aşağıdaydı.
5. ✓ **Profil satırlarına "içinde ne var"** — "Ev arkadaşımı nasıl davet
   ederim" sorusu burada takılıyordu.
6. ✓ Testler (18 yeni kontrol) + belgeler.
7. ✓ `gelistir.ps1`: BOM'lu UTF-8 + 60 saniyelik sağlık yoklaması.

### Kararlar ve gerekçeleri

- **Sağa kaydırınca "alındı" YAPILMADI** (ev sahibi de istemedi): dokunmak
  zaten "aldım" demek, ikinci bir yol aynı işi iki kez yazmak olurdu. Üstelik
  satır iki yönlü jest taşıyınca yanlış kaydırmayla **silme** riski artıyor.
- **Analiz sayfasına dekoratif renk YAPILMADI.** Renk bu uygulamada bir
  sözlük: yeşil = alacak, kırmızı = borç, kategorinin kendi rengi = kimlik.
  Anlamsız renk o sözlüğü seyreltir ve bir dahaki sefer anlamlı olan da
  anlamsız sanılır. Bugünkü ayrım doğru kurulmuş: **halka renkli** (renk bilgi
  taşıyor), **zaman serisi tek renk** (bir Ağustos'un bir Temmuz'dan farklı
  renkte olması hiçbir şey söylemez), yalnızca bulunduğun ay koyu.
- **Öğretici tur / coach mark YAPILMAYACAK.** İnsanlar geçiyor, geçmeyenler
  unutuyor — sebebi bağlam yokluğu: henüz sorulmamış bir sorunun cevabı
  dinleniyor. Kaydırma ipucu bunun doğru biçimi: anlatmıyor, gösteriyor, ve
  tam o listenin üstünde.

### Bulunabilirlik — kural olarak kalsın

Ev sahibinin sorusu: *"Her ekranda kullanıcı ne yapması gerektiğini bulabilir
mi? Eve birini davet etmek istediğinde bulabilir mi?"*

- İnsan menüyü baştan sona okuyup en iyisini seçmiyor; **en güçlü kokuyu
  veren satıra** giriyor ve ilk makul olanı seçiyor. Çözüm çoğu zaman yeni
  ekran değil, **satırın içinde ne olduğunu yazmak.**
- **Sık olan görünür olsun, önemli olan değil.** Davet yılda bir olur, fiş
  taramak günde iki kez — daveti ana ekrana çıkarmak 364 gün yer israfı
  olurdu. Nadir eylem **bulunabilir** olmalı, **öne çıkan** değil.
- **Boş durumlar en iyi öğretmen:** özelliğin nerede olduğunu öğretmenin en
  iyi anı, kullanıcının eksikliğini hissettiği andır. Tek kişilik bir evde
  Kasa'nın boş hâlinde "ev arkadaşını davet et" demek, Profil'i yeniden
  düzenlemekten etkili. **Henüz yapılmadı** — sıradaki adım.
- **Test etme yöntemi:** ev arkadaşlarına telefonu ver, tek cümle söyle
  ("eve birini davet etmek istiyorsun, ne yapardın?"), sus ve izle. Üç kişi,
  iki dakika. Kendi uygulamanızda kaybolamazsınız — tek panzehir bu.

### Bu bloktan KALAN

- **APK derlenmedi.** Kod `main`'de, `.env` hâlâ yerelde. Turun geri kalanı
  bitince tek APK (v45 / 1.3.0) — bkz. DEVAM.md "APK KONTROL LİSTESİ".
- **Push dokunması canlıya karşı denenmedi.** Yerelde
  `FIREBASE_SERVICE_ACCOUNT` yok, yani push gitmiyor; kayıt ve Aktivite
  tarafı denendi. Gerçek push dokunması ancak sunucu deploy edilip APK
  kurulduktan sonra doğrulanabilir.
- **Boş durum davet çağrısı** (yukarıdaki üçüncü madde) yapılmadı.

---

## Tur 12 — BİTTİ (20 Ağustos 2026, APK v45 · sürüm 1.3.0)

Planlanan listeden **arama** ve **saat dilimi** yapıldı; **çevrimdışı kuyruk**
ve **tema** ertelendi (gerekçe aşağıda). Turun ağırlığı cihaz denemesinden
gelen düzeltmelere kaydı — ve o düzeltmeler planlanan işlerden değerli çıktı.

### Gelenler

**Bildirimler** silinebiliyor (kaydır · topluca temizle · 30 gün eskime) ve
her biri ilgili ekranı açıyor (`src/bildirimYolu.ts`).
**Arama** — ürün · market · kişi · uygulama ekranları, bütün geçmişte;
Anasayfa'nın lacivert dibinde. Marka da aranıyor (`weidemilch` → Süt).
**Ürün sayfası** — ne zaman · **neler** · nereden aldık.
**Saat dilimi** evin ülkesinden (`ev_bugun`); UTC "bugün" ay sınırında koca
bir ay kaydırıyordu.
**Fiş ekranı yeniden kuruldu**: satır bölüşümü açıyor, düzenleme kenarda,
silme geri alınabilir, bölüşüm kompakt menüde, genel ad görünür.
**Elle giriş ve fiş düzenleme** aynı tasarıma geldi.
**Genel ad sözlüğü** geçmişe uygulandı: 155 ham ad → 90 satır.
**Analiz sayfası KÜÇÜLDÜ** — üç kart ve bir eksen çıktı.
**Anasayfa'da tek cümle** (`/stats/highlight`), beş kaynaktan.

### Neden çevrimdışı kuyruk ve tema ertelendi

Ev sahibinin gerekçesi: *"internetimiz hep açık; zaten genele açarken
yapacağız."* Karanlık tema da aynı sepette. İkisi de **genele açma paketine**
taşındı.

### Bu turun kalıcı dersleri

**Cihaz turu her seferinde kazanıyor.** Bu turda testlerin yakalamadığı
hatalar: iki kişilik bölüşümün kırılması, `TabSwitch`'in soru işareti
çizmesi, "3 kez" kalem sayması, birimin iki kez yazılması, Kaydet'in klavye
açılınca yanlış okunması, ✕'in silme demesi.

**Yanlış sebeple yeşil bir test, kırmızı testten tehlikelidir.** Saat dilimi
takımının ilk hâli sunucunun gerçek saatine bağlıydı ve eski kodla da
geçiyordu; dondurulmuş saatle yeniden yazıldı.

**Kural fazla geniş uygulanabilir.** "Bulanık eşleşme yok" kuralı gruplama
için doğruydu; aramaya taşınınca gereksiz katılık üretti — yanlış birleştirme
veriyi bozar, yanlış arama sonucu bir bakışa mal olur.

**Çıkarmak eklemekten değerli.** Analiz sayfası dokuz karttan altıya indi ve
kullanışlılığı arttı. Ölçüt: *bu kart hangi cümleyi kurmamı sağlıyor?*

**Boş kalabilme cesareti.** Anasayfa'daki cümle kayda değer bir şey yoksa hiç
çizilmiyor. Dolgu yazılsaydı kullanıcı satırın bazen bilgi taşıdığını
öğrenir ve bir daha okumazdı.

### Tur 12'den KALANLAR

- **Elle giriş ekranı kalabalık** — etiket boşlukları düzensiz, çok soru
  soruyor. Ev sahibi paradoksu doğru koydu: analiz istiyorsak veriyi bir
  yerden almalıyız. Sıkıştırmadan düzeltilebilir mi, ölçülecek.
- **Aramada bir harflik tolerans** — "sleepy" yazan "SLEPPY"i bulamıyor.
  Kural gruplama için doğru, arama için fazla katı.
- **Ürün sözlüğü sürekliliği** — yeni fişlerin genel adı geliyor ama
  tutarlılığı ölçülmedi (aynı ürün farklı aylarda farklı genel ad alabilir).

---

## Tur 13 planı — öncelik sırasıyla

1. **Genele açma paketi** — çevrimdışı kuyruk, karanlık tema, e-posta
   doğrulama, şifre sıfırlama, rıza + gizlilik metni.
2. **Elle giriş sadeleştirmesi.**
3. **Dışa aktarma (CSV/PDF)** · avatarlar.

---

## Tur 12 planı — öncelik sırasıyla

1. **Arama** (market · ürün · kişi). 49 ürün oldu, bir yıl sonra 400 olacak;
   veri büyüdükçe bulunamaz hale geliyor. Splitwise Pro'da var, bizde yok.
2. **Çevrimdışı kuyruk.** Sunucu uykudayken girilen harcama şu an
   **kayboluyor** — listedeki tek VERİ KAYBI maddesi, o yüzden yukarıda.
3. **Uygulama içinden tema seçimi (Yol A)** — Ayarlarda Açık/Koyu/Sistem, bir
   sonraki açılışta geçerli, ~30 dk. Yol B (canlı tema) 22 dosyada 1.234
   satırlık riskli refaktör, **önerilmiyor.**
4. **Ürün sözlüğü** — `generic` tutarlılığı. ÖNCE ÖLÇ: birkaç fiş tara, aynı
   ürünün farklı yazımları aynı genel ada düşüyor mu? Tutarsızlık çıkarsa evin
   kendi sözlüğü kurulur (market adlarında zaten yaptığımız kalıp:
   `normalize_merchant`). Yapıştırma **muhafazakâr** olmalı — yanlış
   birleştirmek, birleştirmemekten pahalı.
5. **Başlıkların elden geçirilmesi.** Üç boy sistemi bunu ucuzlattı: geometri
   `ui.tsx` içindeki tek bir `HEADER_PAD` tablosunda.
6. Dışa aktarma (CSV/PDF) · avatarlar · ödeşme sıklığı hatırlatması.

### Tur 12'de KARAR BEKLEYENLER

- **Eksik kategoriler** (eczane, yapı market, giyim). Ev sahibi kararsız:
  yeni kategori sayfayı uzatıyor ama bu ürünler nadir alınıyor. 19 Ağustos'ta
  ertelendi.
- **Anasayfa'ya tek satırlık "bu ay dikkat çeken şey"** — grafik değil CÜMLE,
  ve yalnızca gerçekten kayda değer bir şey varsa. Analiz sayfasını açmayan
  kullanıcıya değerin bir kırıntısını taşır.
- **Veri paylaşımı.** Ev sahibi iş ortaklarıyla paylaşmak istiyor. Veri
  gerçekten değerli ama **GDPR kapsamında kişisel veri** ve bugün rıza
  katmanı, gizlilik metni, saklama süresi YOK. Doğru sıra: rıza + gizlilik
  metni → sonra yalnızca **kimliksiz toplulaştırılmış** veri. Not: `price_points`
  koleksiyonu zaten bilerek kimlik alanı taşımıyor — paylaşılabilir verinin
  doğru kalıbı o.

---

## Genele açma paketi

E-posta doğrulama · gerçek şifre sıfırlama · hesap ve veri silme · rıza
katmanı (opt-in) · gizlilik metni · saklama süresi · **şube adresi + ödeme
yöntemi toplama** (açılış APK'sıyla aynı anda; fiş fotoğrafları saklanmadığı
için sonradan çıkarılamaz) · tanıtım ekranları · "sana ne kazandırdı"
rakamları

---

## Biten turlar

| Tur | Ne geldi | Sürüm |
|---|---|---|
| 1+2 | Dönem dondurma, düzenleme geçmişi, birim, aynı fiş uyarısı | v17 |
| 3 | Profil/Ev/Uygulama ayrımı, ülke + para birimi, Aktivite | v18 |
| 4 | `{kişi: tutar}` bölüşme modeli | v23 |
| — | Fiyat altyapısı: birim fiyat, paket sınıfı, `price_points` | v24 |
| 5 | Düzenli ödemeler + ödeyen seçici | v24 |
| 6 | Takvim ayı istatistikleri | v24 |
| 7 | İstatistik düzeni, faturalar kartı, çoklu ev altyapısı, cila | v25–27 |
| 8 | Ödeme yolları (IBAN/PayPal, cihazda), genel ürün adı, hızlı bölüşüm | v28–32 |
| 9 | Fiş küçültme; gezinme çubuğu, tek yüzlü ödeme, etiket bazlı istatistik | v33–41 |
| B | Alınacaklar ↔ fiş köprüsü | v42 |

---

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
- **Emülatör bu projede güvenilmez hakem** — gezinme çubuğu farklı davranıyor
  ve turun en pahalı hatası tam o alandaydı.
- Ayrıntılar: [DEVAM.md](DEVAM.md)

## Geliştirme derlemesi — tur içinde APK derlemeyin

Arayüz maddelerini görmek için release APK derlemeye gerek yok. Bir kez
kurulur, sonrası anlık:

```
. D:\SettleUp\ortam.ps1
cd D:\SettleUp\OdaHesap\frontend
npx expo run:android
```

**Metro'yu yeniden başlattıktan sonra `adb reverse` yeniden kurulmalı:**

```
adb reverse tcp:8081 tcp:8081
```

`expo run:android` bunu kendisi yapıyor ama `expo start` yapmıyor. Yönlendirme
olmadan uygulama JS paketini alamıyor ve **logo ekranında takılı kalıyor** —
görüntü bir çökmeye benziyor, oysa günlükte tek satır yazıyor: *"Unable to
load script."* (Bu yaşandı.)

Sonraki günler yalnızca `npx expo start`. Debug derlemesi hata ayıklama
anahtarıyla imzalandığı için **önce mevcut uygulama kaldırılmalı**
(`adb uninstall com.odahesap.app`). `run:android` içeride `prebuild`
çalıştırır: sonrasında imzalama ve ABI ayarları doğrulanmalı, `versionCode`
elle değiştirilmemeli. Debug yavaştır — performans yargısı release'de verilir.

## Yeni sohbete yapıştırılacak metin

```
D:\SettleUp\OdaHesap üzerinde çalışıyoruz. Önce şu üç dosyayı oku:
SIRADAKI-TUR.md, PROJE-DOKUMANI.md, DEVAM.md.
Tur 10 ve 11 bitti (APK v44 / sürüm 1.2.0). Tur 12'ye başla.
```

### Yeni oturumun İLK yapması gerekenler

1. **Geliştirme ortamını kur:** `iex (gc D:\SettleUp\gelistir.ps1 -Raw)`
   Tek komut: `.env`'i kontrol eder, arka ucu başlatır, `adb reverse`
   tünellerini kurar, Metro'yu **yeniden başlatır** (`.env` açılışta bir kez
   okunuyor).
2. **`.env` yerelde mi?** Geliştirme sırasında `localhost:8098` olmalı.
   Üretim adresi yalnızca APK anında konur — bkz. DEVAM.md "APK KONTROL
   LİSTESİ".
3. **Test sunucusu AYRI veritabanında:** `DB_NAME=odahesap_test`. Yapılmazsa
   üretim kirlenir ve fiyat kayıtları geri ayıklanamaz.
