# Devam eden geliştirme için el kitabı

Bu dosya, projede çalışırken öğrenilen ve başka hiçbir yerde yazılı olmayan
şeyleri tutar. Yeni bir oturum (ya da başka bir geliştirici) buradan devam
edebilsin diye yazıldı. Mimari ve kurulum için önce [README.md](README.md).

---

## Canlı ortam

| Ne | Nerede |
|---|---|
| Sunucu | https://odahesap-api.onrender.com (Render, ücretsiz katman) |
| Veritabanı | MongoDB Atlas M0, `odahesap_db` |
| Bildirimler | Firebase Cloud Messaging (proje: `love-quiz-8d0b8`) |
| OCR | Google Gemini `gemini-3.5-flash` |
| Kod | https://github.com/kdagdas/odahesap |

**Sağlık kontrolü tek satırda her şeyi söyler:**

```bash
curl https://odahesap-api.onrender.com/api/
```

`{"service":"odahesap","ok":true,"push_ready":true,"push_detail":"hazir"}`

`push_ready: false` ise bildirimler çalışmıyor; `push_detail` sebebini yazar.

### Sırlar nerede

Hiçbiri depoda değil. Render panelinde `odahesap-api` → **Environment**:
`MONGO_URL`, `GEMINI_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`.

Yerelde `backend/.env` (gitignore'da). `render.yaml` bunları `sync: false` ile
bildirir — **yeni bir ortam değişkeni eklerken `render.yaml`'a da yazın**,
yoksa Blueprint deploy'u sırasında silinebilir.

İmzalama keystore'u: `D:\SettleUp\build-tools\odahesap-release.keystore`,
şifre `odahesap2026`. Kaybedilirse güncelleme APK'sı üretilemez.

---

## Derleme — tuzaklar

Bu makinede toolchain `D:\SettleUp\build-tools` altında, sisteme kurulu değil:

```
build-tools/jdk/jdk-17.0.20+8      JDK 17
build-tools/android-sdk            SDK 35 + 36, build-tools, NDK 27
build-tools/gradle-home            Gradle önbelleği
build-tools/tmp                    ASCII geçici dizin (aşağıya bakın)
```

Derleme komutu:

```bash
cd frontend/android && gradlew.bat assembleRelease
```

Öncesinde `JAVA_HOME`, `ANDROID_HOME`, `GRADLE_USER_HOME`, `TEMP` ve `TMP`
yukarıdaki yollara ayarlanmalı.

### `gradlew clean` ÇALIŞTIRMAYIN

`clean` görevi CMake'i yeniden yapılandırıyor, NDK 27 ise CMake 3.22'nin
istediği `gold` bağlayıcısını desteklemiyor; derleme `-fuse-ld=gold` hatasıyla
patlıyor. Temiz derleme gerekiyorsa şu klasörleri **elle** silin, sonra
doğrudan `assembleRelease` çalıştırın:

```
frontend/android/app/build
frontend/android/app/.cxx
frontend/android/build
```

### Türkçe karakterli kullanıcı klasörü

Windows kullanıcı adı `Kadir Dağdaş` olduğu için JVM geçici dizinde yerel
soket açamıyor ve Gradle daemon "Unable to establish loopback connection"
diyerek hiç başlamıyor. `android/gradle.properties` içindeki
`org.gradle.jvmargs` satırı bu yüzden `-Djava.io.tmpdir=D:/SettleUp/build-tools/tmp`
taşıyor. **Bu satır silinmemeli.**

Ama tek başına yetmiyor: `org.gradle.jvmargs` yalnızca *çatallanan* daemon'a
geçiyor, onu başlatan launcher JVM hâlâ varsayılan geçici dizini kullanıyor ve
soketi orada açmaya çalışıyor. Bu yüzden derlemeden önce kabuğa şunlar da
verilmeli:

```bash
TMP=D:/SettleUp/build-tools/tmp
TEMP=D:/SettleUp/build-tools/tmp
GRADLE_OPTS=-Djava.io.tmpdir=D:/SettleUp/build-tools/tmp
```

### `lintVitalAnalyzeRelease` düşüyor (dosya kilidi)

Derleme `lintVitalAnalyzeRelease FAILED` diyor ama "What went wrong" altında
sebep yazmıyor. Gerçek sebep yığın izinin dibinde:

```
java.nio.file.FileSystemException: ...\lint-cache\...IssueRegistry-....jar:
Dosya başka bir işlem tarafından kullanıldığından bu işlem dosyaya erişemiyor
```

Arkada kalan bir Gradle süreci lint önbelleğindeki jar'ı tutuyor, sonraki
derleme onu silemiyor. Kodla ilgisi yok — aynı kod bir sonraki denemede
derleniyor, o yüzden "geçici hata" gibi görünüyor.

Derlemeden önce:

```bash
gradlew.bat --stop
```

Sonra `android/app/build/intermediates/lint-cache` klasörünü silin. Süreç
hâlâ duruyorsa `java` süreçlerini sonlandırmak gerekiyor.

### Her APK'dan sonra izin listesini kontrol edin

Bir kütüphane eklemek manifest'e sessizce izin ekleyebiliyor.
`expo-media-library` kurulduğunda `READ_MEDIA_AUDIO` ve `READ_MEDIA_VIDEO`
geldi — uygulamanın ses ve videoyla hiçbir işi yok. İkisi de
`app.json` → `expo.android.blockedPermissions` içine eklendi.

```powershell
aapt2 dump badging <apk> | Select-String "uses-permission"
```

Beklenen liste: CAMERA, INTERNET, READ_EXTERNAL_STORAGE, READ_MEDIA_IMAGES,
READ_MEDIA_VISUAL_USER_SELECTED, RECEIVE_BOOT_COMPLETED, POST_NOTIFICATIONS,
ACCESS_NETWORK_STATE, WAKE_LOCK, c2dm.RECEIVE, DYNAMIC_RECEIVER_NOT_EXPORTED.
Fazlası varsa hangi kütüphanenin getirdiğini bulup engelleyin.

### PowerShell dosya yazarken BOM ekliyor

`Set-Content -Encoding utf8` dosyanın başına BOM koyuyor; Groovy bunu
ayrıştıramadığı için `build.gradle` bozuluyor. `.gradle` ve `.json`
dosyalarını PowerShell ile düzenlerken BOM'suz yazın:

```powershell
[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))
```

### versionCode `app.json`'dan gelir

`android/app/build.gradle` içindeki `versionCode`'u elle değiştirmek işe
yaramaz — bir sonraki `expo prebuild` onu `app.json`'daki değerden yeniden
yazar. Her yeni APK'da `frontend/app.json` → `expo.android.versionCode`
artırın, sonra prebuild çalıştırın.

### prebuild neyi korur, neyi korumaz

`npx expo prebuild --platform android --no-install` mevcut `android/`
klasörünü **yeniden kullanır**; `build.gradle` içindeki imzalama ve ABI split
ayarları ile `gradle.properties` bugüne kadar korundu. Yine de her prebuild
sonrası şunu doğrulayın:

```powershell
Select-String -Path "android\app\build.gradle" -Pattern "versionCode|ODAHESAP_STORE_FILE|signingConfigs.release|arm64-v8a"
```

Kaybolmuşsa [IMZALAMA.md](IMZALAMA.md) içindeki adımları tekrar uygulayın.

### APK KONTROL LİSTESİ — sırayla, atlamadan

Bu liste bir kez kaçırıldığı için yazıldı (v43'te dosya adı ve yedek
atlanmıştı). Sıra önemli: 1 ve 2 atlanırsa APK **çalışmaz**.

1. **`.env` üretime dön.** `frontend/.env` geliştirme sırasında
   `localhost:8098` gösteriyor; adres APK'ya derleme anında GÖMÜLÜYOR.
   Yedeği `.env.yedek-tur10` içinde. Derledikten sonra doğrula:
   paketin içinde `onrender.com` **1**, `localhost` **0** kez geçmeli.
2. **Sunucuyu deploy et.** APK canlıya bakıyor; yeni uçlar `main`'e push
   edilmeden APK yarım çalışır. `git push origin main` → Render otomatik
   deploy (~3-5 dk) → `curl .../api/` ile doğrula.
3. **Veritabanı yedeği al** — `.venv/Scripts/python.exe ../tests/yedekle.py`.
   Atlas M0'da otomatik yedek YOK.
4. **`app.json` → `versionCode` artır.** Android'in tek baktığı sayı;
   artmazsa APK eskinin üzerine kurulmaz. `version` (1.1.0) ise insanın
   gördüğü ad, semver.
5. Derle (aşağıdaki adımlar), sonra **izin listesini kontrol et** — beklenen
   **11 izin**.
6. **APK'yı doğru adla kopyala:**
   `D:\SettleUp\APK\KaSa-<version>-v<versionCode>.apk`
   Örnek: `KaSa-1.1.0-v43.apk`. Gradle'ın verdiği
   `app-arm64-v8a-release.apk` adı WhatsApp'ta hangi sürüm olduğunu
   söylemiyor; klasördeki bütün geçmiş sürümler bu kalıpta.

### Üretilen APK'lar

`frontend/android/app/build/outputs/apk/release/` altında tek dosya çıkar:
`app-arm64-v8a-release.apk` (~40 MB). Tek dosyada birleşik APK ~98 MB olur ve
WhatsApp'ın sınırını aşar, o yüzden mimari başına ayrılıyor. Dağıtılan kopya
`D:\SettleUp\APK\` altında sürüm adıyla durur (yukarıdaki 6. madde).

Yalnızca **arm64-v8a** derleniyor: evdeki üç telefon da 64 bit ve 32 bitlik
sürüm hiç kurulmadı. 32 bit bir telefon katılırsa `android/app/build.gradle`
içindeki `splits.abi.include` satırına `"armeabi-v7a"` geri eklenmeli.

---

## Yedekleme

Atlas'ın ücretsiz M0 katmanında otomatik yedek yok. Tüm veritabanını tek bir
JSON'a alır (profil fotoğrafları hariç, son 10 yedeği tutar):

```bash
cd backend
.venv/Scripts/python.exe ../tests/yedekle.py
```

Çıktı `D:\SettleUp\yedekler` altına, yani **depo dışına** yazılır — içinde
herkesin e-postası ve tüm harcama geçmişi var, paylaşılmamalı.

Test takımları çalıştıktan sonra biriken hesapları temizlemek için:

```bash
.venv/Scripts/python.exe ../tests/test-verisi-temizle.py        # sadece gösterir
.venv/Scripts/python.exe ../tests/test-verisi-temizle.py --sil
```

Gerçek kullanıcılara asla dokunmaz; test hesapları `@odahesap-e2e.com`
uzantısından ayırt edilir. Kurucusu silinmiş, üyesi kalmamış yetim evleri de
toplar.

## Testleri AYRI veritabaninda calistirin

`DB_NAME` ortam degiskeninden geliyor. Yerel test sunucusunu ayri bir
veritabaniyla baslatin:

```bash
cd backend
DB_NAME=odahesap_test .venv/Scripts/python.exe -m uvicorn server:app --port 8099
```

Yapilmazsa test hesaplari uretim veritabanina yaziliyor ve `test-verisi-temizle.py`
ile temizlemek gerekiyor. **Fiyat kayitlarinda bu temizlik mumkun degil:**
`price_points` bilerek kimlik alani tasimiyor, yani hangi kaydin testten
geldigi sonradan anlasilamiyor. Kirlenirse tek care koleksiyonu sifirlayip
`fiyat-doldur.py --sifirla --yaz` ile yeniden uretmek.

Canliya karsi test calistirmak da ayni sonucu dogurur; deploy dogrulamasi icin
tek seferlik ve sonrasinda temizlik gerektigini bilerek yapin.

## Testler

Yaklaşık yirmi dört takım, OCR hariç toplam **~700 kontrol**, hepsi çalışan
bir API'ye HTTP ile bağlanır. Yerel sunucuya da canlıya da aynı şekilde
çalıştırılabilir:

```bash
cd backend
.venv/Scripts/python.exe ../../build-tools/e2e-test.py https://odahesap-api.onrender.com
```

| Dosya | Kapsam | Sayı |
|---|---|---|
| `e2e-test.py` | kayıt, giriş, ev, gizlilik, denge, dönem | 32 |
| `admin-test.py` | yönetici rolü, devir, dönem geri alma | 27 |
| `privacy-test.py` | kişisel/ikili harcama görünürlüğü | 12 |
| `remove-member-test.py` | üye çıkarma, geçmiş dönem doğruluğu | 19 |
| `shopping-test.py` | alınacaklar listesi, iki kapsam | 18 |
| `profile-test.py` | ad/e-posta/şifre, fotoğraf yetkisi | 27 |
| `settle-edit-test.py` | ödeme işaretleme, harcama düzenleme | 26 |
| `session-401-test.py` | oturum hatası ile şifre hatası ayrımı | 16 |
| `bolusme-test.py` | `split_with`, kişiye özel tutarlar, listenin donması | 55 |
| `duzenli-test.py` | düzenli ödemeler: vade, çift onay koruması, ödeyen | 53 |
| `aylik-test.py` | takvim ayı istatistiği: ay sınırı, kapsam, sabit/değişken | 54 |
| `aylik-kapsam-test.py` | ev/kişisel/ikili kapsam ayrımı | 29 |
| `fiyat-test.py` | birim fiyat, paket sınıfı, fiyat hafızası | 51 |
| `akis-test.py` | kimin için ekseni, ödeşme çizgisi, ekstre satırları | 38 |
| `analiz-test.py` | Son 6 Ay, ürün/kategori/market uçları, fiyat hareketleri | 58 |
| `kopru-test.py` | alınacaklar ↔ fiş köprüsü + **tarih süzgeci** | 22 |
| `aktivite-test.py` | bildirim kaydı, **gideceği yer (`data`+`ay`), silme, topluca temizleme** | 32 |
| `odestik-test.py` | ödeşme, üyelik günlüğü, **ayrılma bildirimi/rozeti** | 49 |
| `akis-test.py` | **hareket akışları: ekstre satırı == süzülen liste** | 38 |
| Tur 1-3'ten: `donem-dondurma` · `duzenleme-gecmisi` · `market-tekrar` · `para-birimi` · `aktivite` · `stats` · `etiket-bazli` · `categorize` | | ~180 |

**`akis-test.py` neyi koruyor:** Kasa'daki ekstre satırının tutarı ile o
satıra dokununca açılan Harcamalar listesinin toplamı birebir aynı olmalı.
İkisi de `akis_paylari()` okuyor; test onların ayrışmadığını doğruluyor.
Ayrıca ödeşme çizgisi (kapalı dönem = ödeşilmiş) ve geç girilen fiş istisnası
burada.

Betikler `tests/` altında. Hepsi kendi test hesaplarını
oluşturup sonunda temizler; **üretim verisine dokunmazlar**.

`fcm-verify.py` ayrıdır: Firebase kimlik bilgisinin gerçekten çalıştığını
sahte bir jetonla dolaylı olarak doğrular.

---

## Fiş okuma — bilinmesi gerekenler

**Gemini ücretsiz katmanı arka arkaya iki fiş taramayı kaldırmıyor.** Ölçüldü:
ilk istek 200 (13 sn), ikincisi 429. Sunucu 429'da bir kez 20 sn bekleyip
tekrar deniyor; istemci de hangi fişin neden okunamadığını yazıyor (önceden
sessizce yutuluyordu ve kullanıcı iki fiş seçip bir tane görüyordu).
Kalıcı çözüm faturalandırma.

**Fiş okuma her zaman 10-20 saniye sürer**, o yüzden `api.ts` içindeki uyanma
şeridi OCR çağrılarında susturuldu. 3 saniyelik eşik yüzünden her taramada
"sunucu uyanıyor" yazıyordu; sunucu uyanmıyor, model çalışıyor.

**Canlıya karşı OCR testi çalıştırmayın** — kota tüketiyor ve o kota günlük
kullanımdan çalınıyor.

## KURAL: hiçbir şey gezinme çubuğunun altında kalmaz

Ekran, pencere, düğme, liste — **hiçbiri** telefonun gezinme çubuğunun ya da
çentiğin altında kalmayacak. Bu bir tercih değil, uygulamanın kuralı.

`app.json` içinde `edgeToEdgeEnabled: true` — yani uygulama kenardan kenara
çiziyor ve güvenli alanı **her ekran kendisi** halletmek zorunda.

### Alt sayfalar: modalın içini ÖLÇMEYİN

Üç deneme (modal içine kendi `SafeAreaProvider`'ı, `initialMetrics`,
`SafeAreaView edges={["bottom"]}`) sırayla denendi ve **üçü de aynı şeye
dayandığı için** üst üste açılan ikinci sayfada başarısız oldu: modal
penceresini ölçmek. Ölçüm bir yarıştır — ilk sayfa kapanırken ikincisi
ölçülüyor, `insets.bottom` sıfır dönüyor ve düzelme şansı kalmıyor, çünkü
arkadan yeni bir yerleşim olayı gelmiyor. `initialWindowMetrics` de kapatmıyor:
Android'de `null` olabiliyor ve `?? undefined` sessizce sıfıra düşüyordu.

Bugünkü çözüm (`src/ui.tsx` → `BottomSheet`) ölçümü tümden bırakıyor:

1. Güvenli alan **kök sağlayıcıdan**, yani modalın dışından okunuyor ve içeri
   sayı olarak veriliyor. Kök sağlayıcı açılışta bir kez ölçülmüş durumda.
2. Bunun geçerli olması için modal penceresinin kök pencereyle aynı geometride
   olması gerekiyor: `statusBarTranslucent` + `navigationBarTranslucent`.
   İkisi birlikte verilmeli (RN, ikincisi için birincisini şart koşuyor).

Ayrıca **iki alt sayfayı üst üste açmayın.** Kasa'daki "Öde → ödeme yolları"
akışı bunu yapıyordu; artık tek `BottomSheet` içinde içerik değişiyor.

### Sekme çubuğu hangi ekranda kalır

Ayrım **"gezinme mi, iş mi"**:

- **Çubuk KALIR** (gezilen ekranlar, `(tabs)` grubunda `href: null` ile):
  İstatistik, Harcamalar, Aktivite, üye dökümü. İstatistiğe bakıp Kasa'ya
  geçmek isteyen biri önce geri çıkmak zorunda kalmamalı.
- **Çubuk GİTER** (iş ekranları, tam ekran rota): Ayarlar, Ev ayarları,
  Düzenli ödemeler, Ödeme bilgilerim, elle giriş, fiş inceleme, harcama
  düzenleme. Yarım kalmış bir formun üstünde sekmeye basmak girileni
  kaybettirir.

Yeni bir ekran eklerken bu soruyu sorun; `(tabs)` altına koyduğunuz her
dosyayı `_layout.tsx` içinde `href: null` ile bildirmezseniz sekme olarak
görünür.

### Yatay şerit büyüyen listeyi taşımaz

Kişi süzgeci, dönem çipleri ve ay gezinmesi yatay şeritti; üç kişilik evde ve
iki dönemde çalışıyordu. Altı kişilik bir evde uzun isimler taşıyor, iki yıllık
kullanımda ~24 dönem şeridin sonuna ulaşılmaz yapıyor, ay okları geçen yılın
Ocak'ına 19 dokunuşta götürüyordu.

Kural: **oklar komşu için, seçici sıçramak için.** Büyüyebilen her liste
`SelectRow` + `BottomSheet` ile seçilir; İstatistik'te ek olarak yıl + 12
aylık ızgara var. Oklar kaldırılmadı — "geçen ay ne olmuş" ile "geçen şubat ne
olmuştu" aynı hareket değil.

### Alt boşluk elle yazılmaz

`useScrollPad()` (`src/ui.tsx`) kaydırma alanının alt boşluğunu üretir;
sekme çubuğu olan ekranlarda `useScrollPad({ tabs: true })`. Sekme çubuğunun
yüksekliği de aynı dosyadaki `tabBarHeight()`'ten gelir, yani çubuğu çizen
`(tabs)/_layout.tsx` ile ondan kaçınan ekranlar ayrışamaz. Önceden ekranlarda
elle yazılmış `120`, `130`, `paddingBottom: spacing.xxl` vardı; gezinme çubuğu
olmayan telefonda doğru, üç düğmeli telefonda yanlıştı — istatistik sayfasında
son kart çubuğun altında kalıyordu.

Yeni bir tam ekran ya da alt sayfa yazarken bunu **cihazda** doğrulayın;
emülatörde gezinme çubuğu farklı davranabiliyor.

## Ödeme bilgisi paylaşımı — bağlantı neden `#` taşır

Paylaşım bağlantısı `https://odahesap-api.onrender.com/o#u=…&iban=…` biçimindedir.

- **Neden `https`:** `odahesap://` WhatsApp'ta tıklanabilir olmuyor; mesajlaşma
  uygulamaları yalnızca bildikleri şemaları bağlantıya çevirir. Uygulamanın
  hatası değil, yöntemin sınırı.
- **Neden çapa (`#`) ve sorgu (`?`) değil:** çapadan sonrası HTTP isteğine
  **hiç eklenmez**. Sorgu dizesine konsaydı IBAN Render'ın günlüklerine düşerdi
  ve "IBAN cihazda kalır" kararı orada çökerdi. Ölçüldü: sunucu günlüğünde
  yalnızca `GET /o` görünüyor, IBAN sıfır kez geçiyor.
- **`assetlinks.json` sunucudan servis ediliyor** (`/.well-known/assetlinks.json`).
  Parmak izi `build-tools/odahesap-release.keystore`'dan geliyor;
  **keystore değişirse `server.py` içindeki `_ASSETLINKS` de değişmeli.**
  Dosya erişilebilir değilse Android "hangi uygulamayla açılsın" diye sorar —
  yine çalışır, bir dokunuş fazla.
- Eski `odahesap://odeme?…` biçimi **kalıcı olarak destekleniyor**: daha önce
  paylaşılmış mesajlar WhatsApp geçmişinde duruyor.

**Sunucu deploy edilmeden bağlantı yarım çalışır:** uygulaması olmayan biri
404 görür ve App Links doğrulanmaz.

## IBAN doğrulaması gerçek bir sağlamadır

`looksLikeIban` artık şekle değil **ISO 13616 mod-97**'ye bakıyor, üstüne
gerçek ülke kodu listesi ve ülkeye göre sabit uzunluk. Önceki karar
("mod-97 bilerek yapılmıyor, yanlış IBAN'ı yakalamak bankanın işi") **yanlıştı**:
SEPA transferi IBAN'a bakar, isme bakmaz — yapısal olarak geçerli ama hatalı
bir IBAN reddedilmez, para bir yabancıya gider.

**Harf yasaklanmadı.** DE ve TR'de gövde tamamen rakam ama `GB29NWBK…` ve
`NL91ABNA…` harf taşıyor; yasaklamak ev arkadaşının hesabını engellerdi.
Uzunluk + sağlama harf hatasını zaten yakalıyor.

Yakalanamayan tek şey **başkasına ait geçerli bir IBAN**; onun panzehiri
ödeyenin ekranında hesap sahibinin adını görmesi.

## Alınacaklar ↔ fiş köprüsü

Fiş kaydedildikten sonra, fişteki kalemler bekleyen alınacaklar listesiyle
eşleştirilip **öneri** olarak sunulur (`POST /shopping/match`).

- **Sunucu hiçbir şeyi işaretlemez.** Liste paylaşılan bir şey; ev
  arkadaşının yazdığı maddeyi haber vermeden silmek, uygulamanın en çok güven
  kaybedeceği yer olurdu. İşaretleme kullanıcının onayıyla, var olan
  `PATCH /shopping/{id}` üzerinden yapılır.
- **İki güven seviyesi:** anahtarlar birebir aynıysa `sure=True` (kutu
  işaretli açılır); tam kelime içeriyorsa `sure=False` (kutu **boş** açılır).
  Yanlış düşürmek, düşürmemekten pahalı.
- **Eşleştirme Tur 8'in genel ürün adı işine dayanıyor:** fişte `SAHNE 200G`,
  listede `Krema` → `product_key` ikisini aynı anahtara indiriyor. Bunu
  rakiplerin hiçbiri yapamaz çünkü hiçbiri fişi kalem kalem okumuyor.
- Alt dize değil **tam kelime** aranıyor (`kisa in uzun.split()`): alt dize
  olsaydı "yağ" → "yağlı kağıt"a eşleşirdi. Üç harf eşiği de gerekli, yoksa
  "su" her şeye eşleşir.
- Eşleşme yoksa hiçbir şey görünmez; akış kesilmez.

**Tarih süzgeci (Tur 10):** fiş, maddenin listeye yazıldığı günden ESKİYSE
eşleştirme yapılmıyor. Bir hafta önceki fişi bugün taratınca dün yazılmış
"Süt" aday çıkıyordu — o süt alınmadı, madde daha ortada yoktu. Aynı gün
elenmiyor (sabah yazılıp öğlen alınan en sık senaryo); saat karşılaştırması
yok çünkü fişin üstünde saat yok. `kopru-test.py` 22 kontrolle koruyor.

## Ekranlardaki sayılar — hangisi hangisi

Karışıklığın kaynağı iki bağımsız eksendi. **Tur 10'da pencere tekleşti:**
dönem para hesabından çıkınca görüntülemenin her yeri takvim ayı oldu.

**Pencere:** artık her yerde takvim ayı. (Ödeşme hâlâ "ne zaman denk gelirse"
ama o bir OLAY, bir pencere değil — kapanan dönem bir ödeşme anını damgalıyor.)
**Kapsam:** ev (listede evin tamamı) · sen (listede sen, payın kadar)

| Nerede | Pencere | Kapsam |
|---|---|---|
| Anasayfa "Ağustos'ta ev harcaması" | ay | ev |
| Anasayfa "Sana düşen" | ay | sen (payın, kim ödemiş olursa olsun) |
| Anasayfa "Kişisel" | ay | sen (kendine aldıkların) |
| Kasa ekstre "Ödediklerin" | ödeşilmemiş | senin cebinden çıkan |
| Kasa ekstre "Sana düşen / payın" | ödeşilmemiş | senin payın (`expense_shares`) |
| Kasa "Kalan borcun" | ödeşilmemiş | net bakiye |
| Harcamalar akış hapı `pay` | ay | senin payın (ortak harcamalarda) |
| Harcamalar akış `baskasi_icin` | ay | başkası için aldığın (fişin tamamı) |
| İstatistik "Ev harcaması" | ay | ev |
| İstatistik "Ev payın" / "Kişisel" | ay | sen |

**Ev harcaması = evin TAMAMI bölüşüyor.** Üç kişilik bir evde "sen + Salih"
alımı ev harcaması değildir. Bu kural her yerde aynı: `/stats`,
`/stats/monthly`, `/periods` özeti ve bakiye.

**"Bakiye ödeşilmemiş her şeydir" (Tur 10).** Dönem artık para hesabında
kullanılmıyor: açık dönem "ödeşilmemiş her şey" demek, çünkü dönem yalnızca
ödeşilince kapanıyor. `_compute_balances()` yeniden yazılmadı — kapanma
koşulu değişti. Kapalı dönem = ödeşilmiş an; Harcamalar'daki "buraya kadar
ödeşildi" çizgisi bu andan geliyor.

**Hareket akışları (`akis_paylari`).** Bir harcamanın bir kişi için hangi
satıra ne kadar yazıldığı tek fonksiyonda: `pay` (ortak harcamadaki payın,
artıran) · `ev_odedigin` (o harcamayı sen ödediysen, azaltan) · `baskasi_icin`
(tek kişi için aldın, azaltan) · `senin_icin` (biri senin için aldı, artıran).
Ekstre bu türlere ayırıyor, `/expenses?akis=` aynı türle süzüyor —
`akis-test.py` ikisinin ayrışmadığını koruyor.

**"ödediğin − payın = net"** ilişkisi `stats-test.py` ve
`etiket-bazli-test.py` ile korunuyor. Tutmuyorsa bir yerde kapsam kaymıştır.

## Bildirimler — kaydın hayatı ve gideceği yer

Bir bildirim iki ayrı şeydir ve ikisi bilerek ayrı: **push** (telefonun
gösterdiği, kaybolur) ve **kayıt** (`notifications` koleksiyonu, kalır).
`notify()` önce kaydı yazar, push'u sonra dener ve hatasını yutar.

**Kayıt artık silinebiliyor:**

| Uç | Ne yapar |
|---|---|
| `DELETE /notifications/{id}` | Tek kayıt. Yalnızca sahibi; başkasınınki 404. |
| `POST /notifications/clear-read` | Yalnızca **okunmuşlar.** |
| `GET /notifications` | Okunmuş ve 30 günden eskileri **kendiliğinden döker** (`BILDIRIM_OMRU_GUN`). |

Okunmamış olan hiçbir kurala girmiyor — kaçırılan bir olayın tek izi o kayıt.
Eskime için ayrı bir zamanlayıcı YOK: liste ucu zaten günde birkaç kez
çağrılıyor ve iş kişinin kendi kayıtlarıyla sınırlı. Aktivite ekranının
dibinde bunu söyleyen tek satır var; sessiz silme, kullanıcıya "kayıtlarım
nereye gitti" dedirtir.

**Onay sorulmuyor** çünkü bildirim kişiye ait: aynı olay için her alıcı kendi
satırını taşıyor, silmek paylaşılan hiçbir şeyi bozmuyor. Alınacaklar'da tersi
geçerli — orada ev arkadaşının yazdığı madde siliniyor.

### Bildirim nereye götürür — `src/bildirimYolu.ts`

Harita **tek yerde** çünkü iki yerden çağrılıyor: sistem bildirimine dokunmak
(`app/_layout.tsx` → `useBildirimDokunmasi`) ve Aktivite satırına dokunmak.
Ayrışsalar aynı bildirim iki farklı yere giderdi.

| `kind` | `data` | Gidilen yer |
|---|---|---|
| `new_expense` · `expense_edit` · `recurring` (onaylanmış) | `expense_id` + `ay` | Harcamalar, o ay, fiş açık |
| `settlement` · `period_closed` | — | Kasa, Ödeme Geçmişi açık |
| `join_request` · `member_left` | — | Ev ayarları |
| `recurring` (yeni şablon) | `recurring_id` | Düzenli giderler |
| eşleşmeyen | — | `null` — Aktivite'de satır dokunulamaz, push Aktivite'yi açar |

- **`ay` şart:** Harcamalar ay bazlı çalışıyor; ay yazılmazsa geriye tarihli
  bir fiş bugünün listesinde bulunamaz. Sunucu fişin `expense_date`'inden
  yazıyor, bugünün tarihinden değil.
- **Eski bildirimlerde `ay` yok** ve silinen harcamada fiş zaten yok. İkisinde
  de ekran açılıyor ama hiçbir satır açılmıyor — yanlış bir fişi doğruymuş
  gibi göstermektense sessiz kalmak.
- **`null` bir hata değil.** Gidilecek yeri olmayan satır dokunulamaz kalıyor
  ve **oku da yok**: hiçbir yere götürmeyen bir ok yalan söyler.

**Soğuk başlangıç tuzağı:** `Gate` açılışta kendi yönlendirmesini yapıyor
(`replace("/(tabs)/panel")`). Bildirimden gelen yönlendirme ondan önce
çalışırsa bir sonraki karede siliniyor. `useBildirimDokunmasi` bu yüzden
`segments[0] === "(tabs)"` olana kadar bekliyor — Gate'in işini bitirdiğinin
en güvenilir işareti.

## Kaydırma ipucu — neden her açılışta

`useKaydirmaIpucu` + `KaydirmaIpucu` (`src/ui.tsx`), Alınacaklar ve Aktivite.

Önce **bir kerelikti** ve cihazda saklanıyordu; gerekçesi "her açılışta oynayan
bir animasyon üçüncü günden sonra gürültü olur"du. Cihazda asıl kusur çıktı:
**ilk açılışta gözden kaçarsa bir daha hiç görünmüyor** ve kullanıcı silmeyi
bulamıyor. Öğretmeyen bir öğretici gürültüden kötüdür.

- **Açılış başına bir kez**, odaklanma başına değil. Bayrak modül düzeyinde
  (`oynatilanIpuclari`), yani soğuk başlangıçta sıfırlanıyor. Odaklanmaya
  bağlansaydı Kasa↔Alınacaklar arasında gidip gelen biri onu dakikada dört kez
  görürdü.
- **Yarım açılıyor ve açılan kırmızı alan DEKOR** (`pointerEvents` kapalı).
  Swipeable'ın kendi `openRight()`'ı satırı tam açıyor, yani gerçek "Sil"
  düğmesini tam boyutta parmağın altına getiriyor; bir kerelik ipucunda kabul
  edilebilirdi, **her açılışta** oynayan bir animasyonda yanlış dokunuşla
  silme riski gerçek.

## TUZAK: `...T.caption` yayılırken `lineHeight` de geliyor

`{ ...T.caption, fontSize: 9 }` yazmak **satır yüksekliğini ezmiyor** — 12
punto için hesaplanmış `lineHeight: 17` olduğu gibi kalıyor ve yazının
etrafında sekiz piksel görünmez boşluk oluşuyor.

Bu, Analiz'deki çubuk grafiğinde **ölçülebilir bir hataya** dönüştü: ay
ortalaması çizgisi kabın en altından, çubuklar ise ay adının üstünden
ölçülüyordu; aradaki 21 piksel, 64 piksellik ölçeğin üçte biri. Çizgi her
zaman olması gerekenden aşağıda duruyordu ve "bu ortalama olamaz"
dedirtiyordu. Testlerin göremeyeceği bir hata; cihazda göze çarptı.

Punto düşürürken `lineHeight`'ı **açıkça** verin. Ve bir grafikte iki öğe
birbirine göre konumlanıyorsa **aynı tabandan** ölçüldüklerini doğrulayın;
etiket yüksekliği sabit yazılmaz, `onLayout` ile ölçülür (telefonun yazı
boyutu ayarı sabit sayıyı yine kaydırır).

## Kolay gözden kaçan tasarım kararları

**Bildirim hataları yutulur.** `notify()` hiçbir zaman istisna fırlatmaz —
bildirim gönderilememesi harcamanın kaydedilmesini engellememeli. Bunun
bedeli, bir sürüm boyunca bildirimlerin sessizce hiç gitmemesi oldu (eksik
`google-auth[requests]` bağımlılığı). O yüzden açılışta `push.self_check()`
çalışır ve sonucu hem loga hem `/api/` yanıtına yazar. **Bu erken uyarıyı
kaldırmayın.**

**401'in iki anlamı var.** Oturum gerçekten geçersizse sunucu
`X-Session-Invalid` başlığı koyar; uygulama jetonu yalnızca o zaman siler.
Yanlış şifre de 401 döner ama başlık taşımaz. Bu ayrım olmadan, şifresini
yanlış yazan kullanıcı sessizce dışarı atılıyordu.

**Kapalı dönemler dokunulmazdır.** Kapatılmış dönemdeki harcama düzenlenemez
ve silinemez; ödeme kaydı da kaldırılamaz. Bakiyeler insanların ödeştiği
rakamlardır, sonradan değişmemeli. Düzeltme gerekiyorsa yönetici dönemi
yeniden açar (yalnızca yeni dönem boşsa).

**Denge hesabı üyelikten değil katılımdan beslenir.** `period_participants()`
o dönemde harcaması, ödemesi veya bir harcamanın bölüşme listesinde adı olan
herkesi kapsar, sadece bugünkü üyeleri değil. Biri evden çıkarıldığında geçmiş
dönemlerin payları bozulmasın diye.

**Bölüşme listesi kayıt anında donar.** Her harcama `split_with` alanında
kimlerin bölüştüğünü taşır; bu liste parayı, görünürlüğü ve bildirimi birden
belirler. Tur 4 öncesi kayıtlarda alan yok, `split_of()` onları
`target_type`'tan türetir — **bu yedek yol kaldırılmamalı.** Bir göç betiğinin
kaçırdığı her kayıt sessizce dengeden düşerdi.

**Kişiye özel bölüşüm varken tutar tek başına değiştirilemez.** Sunucu 400
döner. Oransal yeniden dağıtım, kimsenin onaylamadığı bir sayıyı A'nın 350'sinin
yerine koyardı — arkadaşlar arasında yanlış borç demek.

**Fotoğraflar ayrı koleksiyonda.** Kullanıcı nesnesine gömülseydi, ev bilgisi
her ekran açılışında yenilendiği için tüm üyelerin fotoğrafı sürekli yeniden
inecekti. `photo_version` sadece önbellek kırıcıdır.

**Liste eklemesi iyimserdir.** Alınacaklar listesine madde eklerken ağ cevabı
beklenmez; art arda madde girerken her birinde beklemek uygulamayı bozuk
hissettiriyordu.

---

## Geliştirme ortamı — `D:\SettleUp\gelistir.ps1`

```
iex (gc D:\SettleUp\gelistir.ps1 -Raw)
```

Tek komut: `.env`'i kontrol eder, arka ucu başlatır (8098, **üretim
veritabanı**), `adb reverse` tünellerini kurar, Metro'yu yeniden başlatır.

İki tuzak bu turda düzeltildi:

- **Dosya BOM'lu UTF-8 olarak saklanıyor.** Windows PowerShell 5.1'in
  `Get-Content`'i BOM yoksa dosyayı ANSI okuyor; Türkçe karakterler bozuluyor
  ve betik *"The string is missing the terminator"* diyerek **hiç
  çalışmıyor**. Düzenlerken kodlamayı bozmayın.
- **Sağlık yoklaması 60 saniye bekliyor** (eskiden 20). Atlas bağlantısı bu
  makinede ~25 saniye sürebiliyor ve betik "BASLATILAMADI" deyip çıkıyordu —
  oysa sunucu saniyeler sonra ayaktaydı. Yanlış alarm gerçek arızadan pahalı:
  insan olmayan bir hatayı aramaya başlıyor.

Kontrol: `curl http://localhost:8098/api/` ve `curl http://localhost:8081/status`.

**Metro paketini kullanıcıdan önce siz derletin.** Telefonu yeniden yüklemeden
söz dizimi ve import hatalarını yakalar:

```
curl -o /dev/null -w "%{http_code}\n" "http://localhost:8081/.expo/.virtual-metro-entry.bundle?platform=android&dev=true"
```

200 dönmüyorsa gövde JSON bir hata nesnesi; `tsc --noEmit` bunu yakalamaz
(çözümlenemeyen modül, Metro'ya özgü yollar).

---

## Bilinen sınırlar

- **Şifre sıfırlama yok.** Kullanıcı şifresini unutursa veritabanından elle
  müdahale gerekir. Üç kişilik kullanım için kabul edildi.
- **E-posta doğrulaması yok.** Adresin gerçek olup olmadığı kontrol edilmez.
- **Render ücretsiz katmanı 15 dk sonra uyur.** Uyanma ~50 sn. GitHub Actions
  (`.github/workflows/keep-alive.yml`) 10 dakikada bir ping atarak bunu
  önler. **Aynı Render hesabında ikinci bir ücretsiz servis açılmamalı** —
  aylık 750 saatlik kota tek servisi 7/24 ayakta tutmaya ancak yetiyor.
- **iOS sürümü yok.** Mac ve yıllık geliştirici hesabı gerekiyor.
- **Uygulama otomatik test edilmiyor.** Sunucu 516 testle korunuyor ama
  arayüzün kendisi hiçbir cihazda otomatik çalıştırılmıyor; ekran hataları
  ancak elle denemeyle bulunuyor.

---

## Yapılmadan bırakılanlar

Kullanıcıyla konuşulmuş, sıraya alınmış ama henüz yapılmamış işler:

| İş | Tahmin | Not |
|---|---|---|
| Harcama dağılımı grafiği (ev + kişisel) | ~3 sa | "Kendim" harcamaları kaydediliyor ama hiçbir yerde toplu gösterilmiyor |
| Çevrimdışı kuyruk | ~2 sa | Sunucu uykudayken eklenen harcama kaybolmasın |
| Karanlık tema | ~4-5 sa | Ertelendi. Renkler `theme.ts`'te sabit; her ekran `StyleSheet.create` ile modül yüklenirken stilini üretiyor, dinamik tema için ~600 satır stilin bileşen içine taşınması gerekiyor |
| Ev içi sohbet | ~4-5 sa | Önerilmedi — WhatsApp zaten var, alınacaklar listesi ihtiyacı karşılıyor |
