# Sıradaki turlar — Tur 10: para çekirdeği · Tur 11: analiz sayfası

> Bu dosya yeni bir sohbet penceresine geçerken bağlamı taşımak için yazıldı.
>
> Son durum: **APK v42**, **596 kontrol** geçiyor, `main` çalışır durumda.
> Aşağıdaki kararlar **konuşuldu ve onaylandı, koda girmedi.**
> Uygulamanın bugünkü hâli için [PROJE-DOKUMANI.md](PROJE-DOKUMANI.md),
> günlük operasyon için [DEVAM.md](DEVAM.md).

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
animasyonu, alt sayfa sürükleme jesti, EPC karekodu, bütçe ve hız göstergesi,
sabit/değişken oranı kartı, marketler arası fiyat karşılaştırması, kişi başına
tüketim karşılaştırması.

---

## Tur 10 — NEREDE KALDIK (18 Ağustos 2026)

**23 commit atıldı, 617 kontrol geçiyor, `main` çalışır durumda.**

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

### Kalanlar

1. **Ekstre satırları tıklanabilir**, açılım kavisin altında beyaz kartta;
   dokunulan satır lacivertte vurgulu
2. **Hareket satırı → Harcamalar**, süzgeçli (`ev` · `baskasi_icin` ·
   `senin_icin` · ay)
3. **Süzgeç SUNUCUYA taşınacak.** İstemcideki `split_with` süzgeci Tur 4
   öncesi kayıtları kaçırıyor — o kayıtlarda alan yok ve `split_of()` yedek
   yolu yalnızca sunucuda çalışıyor. **"Senin için alınanlar 3 €" görünüp
   içeriğinin açılmaması bu yüzden**, gizlilik değil
4. Harcamalar başlığında kaldırılabilir süzgeç hapı
5. `borc-dokumu.tsx` sil
6. **Geri dönüş Kasa'ya** — şu an Anasayfa'ya atıyor
7. **Sekmeye dokununca en üstten başlasın**, kaldığı yerden değil
8. Ayrılan üyenin "ayrıldı" rozeti + ayrılma uyarısı (borç tutarıyla)
9. Anasayfa dikkat şeridi
10. İstatistik'te "Toplam"ın yeşili nötre
11. Köprüde tarih filtresi
12. `member-detail` ay bazlı
13. **`.env` geri konacak** (`.env.yedek-tur10`), sonra APK v43

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

## Tur 11 planı — analiz sayfası

Kaba tahmin ~15 saat.

1. Halkanın derinleşmesi + **kategori sayfası** (6 aylık seyir, ne alındı,
   nereden)
2. **Son 6 Ay** çubuğu
3. **En Çok Aldıklarımız** + "tüm ürünler" sayfası
4. **Market sayfası**
5. **Zamlananlar / Ucuzlayanlar**
6. Marketler kartına geçen ay sütunu
7. Sayfa sırası + iki kapı
8. Belgeler + APK v44

**Neden ayrıldı:** para matematiği ile analiz ekranı aynı APK'da değişirse,
bir şey bozulduğunda hangisinden geldiği ayırt edilemez. "Madde başına commit,
tur başına APK" kuralının sebebi bu.

---

## Sonraki adaylar

- **Başlık tasarımlarının elden geçirilmesi** — ev sahibi lacivert üst
  alanları bir bütün olarak yeniden görmek istiyor (18 Ağustos 2026). Üç boy
  sistemi bunu **ucuzlattı**: geometri artık `ui.tsx` içindeki tek bir
  `HEADER_PAD` tablosunda; oran değiştirmek üç sayı demek, 22 ekran değil.
- **Ödeşme sıklığı hatırlatması** — ev ayarı, **varsayılan kapalı**;
  hatırlatma isteyen ev ile istemeyen ev çok farklı. GitHub Actions günlük
  işi, kira hatırlatmasıyla paylaşımlı. **Hatırlatma asla kendiliğinden
  ödeştirmez.**
- **Uygulama içinden tema seçimi (Yol A)** — Ayarlarda Açık/Koyu/Sistem, bir
  sonraki açılışta geçerli, ~30 dk. Yol B (canlı tema) 22 dosyada 1.234
  satırlık riskli refaktör, önerilmiyor.
- Alınacaklar–fiyat köprüsü · arama · avatarlar · CSV/PDF · çevrimdışı kuyruk
- Hız sınırlaması ve paralel toplu tarama — **faturalandırma bekliyor**
  (ev sahibi 17 Ağustos 2026'da şimdilik açmayacağını söyledi)

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
Sonra Tur 10'a başla.
```
