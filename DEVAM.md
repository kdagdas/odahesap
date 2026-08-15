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

### Üretilen APK'lar

`frontend/android/app/build/outputs/apk/release/` altında tek dosya çıkar:
`app-arm64-v8a-release.apk` (~40 MB). Tek dosyada birleşik APK ~98 MB olur ve
WhatsApp'ın sınırını aşar, o yüzden mimari başına ayrılıyor.

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

## Testler

Sekiz takım, hepsi çalışan bir API'ye HTTP ile bağlanır. Yerel sunucuya da
canlıya da aynı şekilde çalıştırılabilir:

```bash
cd backend
.venv/Scripts/python.exe ../../build-tools/e2e-test.py https://odahesap-api.onrender.com
```

| Dosya | Kapsam | Sayı |
|---|---|---|
| `e2e-test.py` | kayıt, giriş, ev, gizlilik, denge, dönem | 32 |
| `admin-test.py` | yönetici rolü, devir, dönem geri alma | 25 |
| `privacy-test.py` | kişisel/ikili harcama görünürlüğü | 12 |
| `remove-member-test.py` | üye çıkarma, geçmiş dönem doğruluğu | 17 |
| `shopping-test.py` | alınacaklar listesi, iki kapsam | 18 |
| `profile-test.py` | ad/e-posta/şifre, fotoğraf yetkisi | 27 |
| `settle-edit-test.py` | ödeme işaretleme, harcama düzenleme | 25 |
| `session-401-test.py` | oturum hatası ile şifre hatası ayrımı | 16 |

Betikler `build-tools/` altında (depoda değil). Hepsi kendi test hesaplarını
oluşturup sonunda temizler; **üretim verisine dokunmazlar**.

`fcm-verify.py` ayrıdır: Firebase kimlik bilgisinin gerçekten çalıştığını
sahte bir jetonla dolaylı olarak doğrular.

---

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
o dönemde harcaması veya ödemesi olan herkesi kapsar, sadece bugünkü üyeleri
değil. Biri evden çıkarıldığında geçmiş dönemlerin payları bozulmasın diye.

**Fotoğraflar ayrı koleksiyonda.** Kullanıcı nesnesine gömülseydi, ev bilgisi
her ekran açılışında yenilendiği için tüm üyelerin fotoğrafı sürekli yeniden
inecekti. `photo_version` sadece önbellek kırıcıdır.

**Liste eklemesi iyimserdir.** Alınacaklar listesine madde eklerken ağ cevabı
beklenmez; art arda madde girerken her birinde beklemek uygulamayı bozuk
hissettiriyordu.

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
- **Uygulama otomatik test edilmiyor.** Sunucu 172 testle korunuyor ama
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
| Üye ekleme tarih bazlı pay | ~2,5 sa | Şu an dönem ortasında katılan kişi o dönemin tüm geçmiş harcamalarının payını üstleniyor. Uyarı gösteriliyor; tam çözüm için üyelik tarihleri saklanmalı |
