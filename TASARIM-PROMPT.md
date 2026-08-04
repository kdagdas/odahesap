# Claude Design için hazır prompt

> Aşağıdaki bloğun tamamını kopyalayıp Claude Design'a yapıştır.
> Altında ayrıca "istersen ekleyebileceğin parçalar" var.

---

Bir mobil uygulamanın arayüzünü yeniden tasarlamanı istiyorum. Uygulama
çalışıyor ve gerçek kullanımda; senden istediğim görsel tasarım, yeni özellik
değil.

## Ürün

**KaSa** — birlikte yaşayan insanların ortak harcamalarını paylaştığı bir
Android uygulaması. Almanya'da paylaşımlı evde yaşayan Türk kullanıcılar için;
**arayüz tamamen Türkçe**.

Ayırt edici özelliği: kullanıcı market fişini kamerayla tarıyor, uygulama
fişteki her ürünü adı, adedi ve fiyatıyla ayrıştırıyor, sonra kullanıcı bu
kalemleri kime ait olduğuna göre dağıtıyor. Yani ekranlarda çokça **liste,
para tutarı ve kişi ataması** var.

Kullanıcı sayısı az ve birbirini tanıyor (3-5 kişilik bir ev). Uygulama günde
birkaç kez, çoğunlukla ayakta ve tek elle kullanılıyor — markette, mutfakta.

## Ana kullanım anları

1. **Markette fiş tarama** — telefon tek elde, acele, ışık kötü
2. **Akşam hesap kontrolü** — "kim ne kadar borçlu"
3. **Aklına gelince liste** — "süt bitmiş" diye not düşme
4. **Ay sonu ödeşme** — borçları kapatıp dönemi sıfırlama

## Platform kısıtları — bunlara uymayan tasarım uygulanamaz

React Native (Expo SDK 54) ile geliştiriliyor. Web değil. Somut sınırlar:

- **Yalnızca Flexbox.** CSS Grid, `position: sticky`, `float`, kardeş
  seçicileri, `:hover` yok
- **Gölge iki platformda farklı çalışıyor.** Android'de yalnızca tek bir
  `elevation` sayısı var; iOS'taki gibi çok katmanlı, renkli veya yönlü gölge
  kurgulama
- **Degrade özel bir bileşenle geliyor** (`expo-linear-gradient`) — doğrusal
  degrade mümkün, radyal/konik degrade yok
- **Blur, backdrop-filter, glassmorphism yok**
- **Font sistem fontu.** Özel yazı tipi kullanmak istiyorsan söyle, ekleyebilirim
  — ama tasarımı ağırlıklı olarak ağırlık ve boyut farkına dayandır
- **İkonlar Ionicons ve MaterialCommunityIcons kütüphanelerinden.** Serbest çizim
  ikon kullanma; hangi ikonu seçtiğini isimleriyle yaz
- Ekranlar dikey, `orientation: portrait` sabit

## Bugünkü tasarım dili

Turkuaz ağırlıklı, açık temalı, finans uygulamalarına yakışan sakin bir dil.
Mor/indigo bilinçli olarak kullanılmıyor.

```
Marka        #0EA5A5  (turkuaz, ana renk)
Marka koyu   #0B8180
Marka açık   #CFF2EF  (yumuşak zeminler)
Marka üstü   #065E5E  (açık zemin üstü yazı)

Yüzey        #FFFFFF
Yüzey alt    #F1FBF9  (ekran arka planı, soluk nane)
Yüzey ikincil #F3F7F9
Metin        #0F2A2E  (koyu turkuaz-siyah)
Metin ikincil #4A5F62
Metin soluk  #7A8D8F

Kenarlık     #E1EEEB   Ayraç #E8F0EF
Olumlu       #16A34A   Olumsuz #DC2626
Uyarı        #F59E0B   Bağlantı #3B82F6
```

Boşluk ölçeği: 4 · 8 · 12 · 16 · 24 · 32 · 48
Köşe yarıçapı: 6 · 12 · 20 · 999 (hap)
Yazı boyutları: 12 · 14 · 16 · 20 · 24 · 32
Ağırlıklar: 400 · 500 · 600 · 700

Uygulama ikonu koyu lacivert (#101C33) zeminde "KaSa" yazısı; sol yarısı kırık
beyaz, sağ yarısı yeşil (#5FC08D), etrafında dört parçaya bölünmüş halka.
**Renk paletini değiştirmekte serbestsin**, ama ikonla tamamen çelişmesin.

## Alt menü (5 sekme)

```
Anasayfa · Alınacaklar · [Fiş Tara] · Kasa · Profil
```

Ortadaki "Fiş Tara" dairesel bir vurgu içinde ve diğerlerinden büyük, şeridin
biraz üstüne taşıyor — Instagram'daki gibi. Bu düzen kasıtlı ve korunmalı.

## Tasarlanacak ekranlar

Her biri için **açık temada, telefon boyutunda** bir tasarım istiyorum.

**1. Anasayfa**
Üstte selamlama ve ev adı, sağ üstte kullanıcının avatarı. Altında büyük bir
**degrade bakiye kartı**: "Bu dönem net durumun", büyük tutar (`+42,50 €`),
tek satır açıklama ("Ev sana borçlu" / "Eve borcun var" / "Ödeşmiş
durumdasın") ve iki eylem düğmesi (Manuel Ekle, Fiş Tara). Kart alacaklıysa
turkuaz, borçluysa kırmızı degrade.
Altında **ev arkadaşları listesi**: avatar, isim, "ev için ödedi" tutarı.
En altta **son harcamalar**: her satırda harcamayı yapanın avatarı ve adı,
market rozeti (REWE kırmızı, EDEKA sarı gibi marka renkli küçük etiket),
kime ait olduğu (Ev / Kendim / → Ali), tarih ve tutar.

**2. Fiş Tara**
Tam ekran kamera. Ortada fişi hizalamak için köşe işaretlerinden oluşan bir
rehber çerçeve ve altında "Fişi çerçeveye yerleştir" ipucu. Altta üç düğme:
galeri, büyük deklanşör, elle giriş. Fiş okunurken tam ekran bir bekleme
katmanı ("Fatura okunuyor…"). Kritik nokta: çerçeve ile düğmeler asla
çakışmamalı ve beyaz fiş kameraya girdiğinde beyaz ikonlar kaybolmamalı.

**3. Fiş İnceleme** — en yoğun ekran
Fiş okunduktan sonra çıkan kalem listesi. Her kalem: kategori ikonu (dokununca
kategori değişiyor), ürün adı, adet, birim fiyat, satır toplamı ve **bu kalem
kime ait** seçimi (Ev / Kendim / bir ev arkadaşı). Kalem silinebiliyor, yeni
kalem eklenebiliyor. Üstte market, tarih ve toplam. Toplu atama kısayolu var
("hepsini Ev'e ata"). **Bu ekranın kalabalık görünmeden okunabilir olması en
büyük tasarım problemi** — bir fişte 15-20 kalem olabiliyor.

**4. Kasa (ödeşme)**
Üstte dönem seçici (yatay kaydırılan etiketler: "Aktif · Dönem #3", "Dönem #2").
Sonra üye kartları: avatar, isim, ev için ödediği, kişisel harcaması, sağda
renkli net bakiye. Altında **önerilen ödemeler**: her biri "A → 30,00 € → B"
biçiminde, iki avatar arasında ok ve tutar hapı. Her önerinin yanında "Ödedim"
işaretleme eylemi (tutar değiştirilebiliyor, kısmi ödeme mümkün). Altta
kaydedilmiş ödemeler listesi ve geri alma. En altta sabit "Dönemi Kapat &
Denkleştir" düğmesi (yalnızca ev yöneticisinde görünür). Herkes ödeşmişse
kutlama havasında boş durum.

**5. Alınacaklar**
Üstte iki sekme: **Ev** ve **Kendim**. Altında hızlı ekleme alanı (yazı kutusu
+ artı düğmesi). Liste maddeleri: yuvarlak işaret kutusu, ürün adı, kim
eklediyse onun küçük avatarı, silme çarpısı. İşaretlenenler üstü çizili ve
listenin dibinde, "Alındı (3)" başlığı ve "Temizle" bağlantısıyla.
Boş durum için iki farklı mesaj (Ev / Kendim).

**6. Profil**
Üstte büyük avatar (köşesinde kamera rozeti — fotoğraf değiştirme), isim,
e-posta. Sonra sırayla: 8 hazır avatar seçimi (renkli daireler), **Ev** kartı
(ev adı + düzenleme kalemi, dev puntolu 6 haneli davet kodu, paylaş düğmesi,
kodu yenile), onay bekleyenler (varsa, turuncu vurgulu, onayla/reddet
düğmeleriyle), **Hesap** (ad / e-posta / şifre değiştirme, açılır kapanır
satırlar), **Bildirimler** (üç anahtarlı liste), en altta "Evden ayrıl" ve
"Çıkış yap".
Bu ekran şu an **çok uzun** — bölümlemesi en çok yardıma ihtiyaç duyan yer.

**7. Giriş / Kayıt**
Turkuaz degrade zemin, üstte marka, altında beyaz bir kart içinde giriş/kayıt
sekmeleri ve form alanları.

**8. Harcamalar (geçmiş)**
Süzgeç etiketleri (dönem, kişi, tür) ve harcama kartları listesi. Karta
dokununca kalem dökümü açılıyor.

## Beklediğim çıktı

Her ekran için:
- Telefon boyutunda görsel tasarım
- Kullandığın renk, boşluk ve yazı değerlerinin **sayısal** listesi (rastgele
  değil, bir ölçekten seçilmiş)
- İkon isimleri (Ionicons / MaterialCommunityIcons karşılığıyla)
- Boş durum, yükleniyor ve hata durumları — özellikle Anasayfa, Alınacaklar
  ve Kasa için

Ayrıca **tekrar eden bileşenler** için ayrı bir sayfa: kart, hap etiket, birincil
düğme, avatar, market rozeti, kategori ikonu, tutar gösterimi, işaret kutusu.

## Neye dikkat etmeni istiyorum

- **Para okunabilirliği önce gelir.** Tutarlar hızlı taranabilmeli; işaret (+/−)
  ve renk anlamı bir bakışta anlaşılmalı
- **Fiş İnceleme ekranı** kalabalıklaşmadan 20 kalemi taşıyabilmeli
- **Tek elle kullanım** — sık kullanılan eylemler başparmak erişiminde
- Uygulama **finansal ve güvenilir** hissettirmeli, oyunlaştırılmış değil
- Metinler Türkçe ve Almanca yazımdan daha uzun ("Harcamalar", "Alınacaklar",
  "Dönemi Kapat & Denkleştir") — dar kutulara sıkıştırma

## Serbestsin

Renk paletini, tipografi ölçeğini, kart ve köşe dilini, boşluk ritmini
değiştirebilirsin. Yeter ki React Native ile uygulanabilir olsun ve yukarıdaki
içerik eksilmesin.

---

## İstersen prompta ekleyebileceğin parçalar

**Karanlık tema de istiyorsan** — sonuna ekle:

> Her ekranın karanlık tema karşılığını da tasarla. İki temada da çalışan
> anlamsal renk isimleri kullan (yüzey, yüzey-üstü-metin, marka gibi), ham
> renk kodu değil.

**Belirli bir estetik istiyorsan** — "Serbestsin" bölümünü şununla değiştir:

> Şu yönde ilerle: [ör. "daha yumuşak, yuvarlak, sıcak" / "daha keskin ve
> tipografi ağırlıklı" / "kart yerine daha çok ayraç kullanan sade bir dil"].

**Önce seçenek görmek istiyorsan** — en başa ekle:

> Önce yalnızca **Anasayfa** ekranını üç farklı yönde tasarla ve kısaca her
> birinin mantığını anlat. Ben birini seçince diğer ekranlara geçelim.

**Uygulanabilirliği garantiye almak istiyorsan** — sona ekle:

> Tasarımı bitirince, her ekran için React Native'de nasıl kurulacağını
> anlatan kısa bir not yaz: hangi bileşen hangi Flexbox düzeniyle, gölge
> gerekiyorsa Android `elevation` değeri kaç.
