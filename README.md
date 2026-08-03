# OdaHesap

Ev arkadaşlarıyla ortak harcamaları paylaşmak için mobil uygulama. Almanca market
fişlerini kamerayla okur, kalemleri kişilere dağıtır, dönem sonunda kimin kime ne
kadar borçlu olduğunu en az sayıda transferle hesaplar.

- **Uygulama:** Expo SDK 54 / React Native 0.81, Expo Router
- **Sunucu:** FastAPI + MongoDB (Motor)
- **Fiş okuma:** Google Gemini Vision API
- **Giriş:** e-posta + şifre (bcrypt, 90 günlük oturum jetonu)

Ücretli hiçbir servise bağımlı değildir; MongoDB Atlas M0, Render free ve Google AI
Studio'nun ücretsiz katmanlarıyla çalışır.

---

## Dizin yapısı

```
backend/          FastAPI sunucusu (tek dosya: server.py)
frontend/         Expo uygulaması
  app/            Ekranlar (Expo Router — dosya tabanlı yönlendirme)
  src/            API istemcisi, auth/household context'leri, tema, ortak bileşenler
  android/        `expo prebuild` ile üretilir; elle düzenlenen tek yer imzalama ayarı
render.yaml       Render Blueprint (sunucu deploy tarifi)
```

## Sunucuyu yerelde çalıştırma

```bash
cd backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

`.env.example` dosyasını `.env` olarak kopyala, MongoDB adresini ve Gemini
anahtarını yaz, sonra:

```bash
.venv\Scripts\python.exe -m uvicorn server:app --reload --port 8000
```

Sağlık kontrolü: <http://localhost:8000/api/> → `{"service":"odahesap","ok":true}`

## Sunucuyu Render'a deploy etme

1. Bu repoyu GitHub'a push et.
2. Render → **New +** → **Blueprint** → repoyu seç. `render.yaml` otomatik okunur.
3. Deploy sırasında iki değer sorulur (bunlar repoya girmez):
   - `MONGO_URL` — Atlas bağlantı adresi
   - `GEMINI_API_KEY` — Google AI Studio anahtarı
4. Deploy bitince servis adresini not al: `https://odahesap-api-xxxx.onrender.com`

> Render ücretsiz katmanında servis 15 dk boş kalınca uyur. Sonraki ilk istek
> ~50 sn sürer, sonrası normaldir.

MongoDB Atlas'ta **Network Access → `0.0.0.0/0`** ekli olmalı; Render'ın çıkış
IP'si sabit değildir.

## APK üretme

`frontend/.env` içindeki `EXPO_PUBLIC_BACKEND_URL` **derleme anında** APK'ya gömülür.
Sunucu adresi değişirse APK'yı yeniden derlemek gerekir. Yayındaki değer:

```
EXPO_PUBLIC_BACKEND_URL=https://odahesap-api.onrender.com
```

> `gradlew clean` **çalıştırma.** `clean` görevi CMake'i yeniden yapılandırıyor,
> NDK 27 ise CMake 3.22'nin istediği `gold` bağlayıcısını desteklemiyor ve derleme
> patlıyor. Temiz derleme için `android/app/build`, `android/app/.cxx` ve
> `android/build` klasörlerini elle sil, sonra doğrudan `assembleRelease` çalıştır.

```bash
cd frontend
npm install
npx expo prebuild --platform android --no-install
cd android
gradlew.bat assembleRelease
```

Çıktı: `frontend/android/app/build/outputs/apk/release/app-release.apk`

Derleme için `JAVA_HOME` (JDK 17) ve `ANDROID_HOME` ortam değişkenleri gerekir.

### İmzalama

Release APK, `android/gradle.properties` içindeki `ODAHESAP_*` değerleriyle imzalanır.
Keystore dosyasını kaybetme — güncelleme APK'ları **aynı** anahtarla imzalanmalıdır,
aksi halde telefonlar kurulumu "farklı uygulama" gerekçesiyle reddeder.

`expo prebuild` `android/` klasörünü sıfırdan üretir ve imzalama ayarını siler.
Yeniden prebuild yaptıysan `android/IMZALAMA.md` içindeki iki değişikliği tekrar uygula.

### Windows'a özel not

Kullanıcı adında Türkçe karakter varsa (`C:\Users\Kadir Dağdaş\...`) Gradle daemon'ı
"Unable to establish loopback connection" hatasıyla başlamaz — JVM geçici dizinde
yerel soket oluşturamaz. Çözüm, derlemeden önce geçici dizini ASCII bir yola almak:

```bash
set TEMP=D:\SettleUp\build-tools\tmp
```

## Testler

Sunucu testleri çalışan bir API'ye HTTP ile bağlanır:

```bash
cd backend
set EXPO_BACKEND_URL=http://localhost:8000
.venv\Scripts\python.exe -m pytest tests -v
```
