# Release imzalama ayarı

`expo prebuild` `frontend/android/` klasörünü **sıfırdan üretir** ve aşağıdaki iki
değişikliği siler. Prebuild'i tekrar çalıştırdıysan bunları yeniden uygula, yoksa
release APK debug anahtarıyla imzalanır ve mevcut kurulumların üzerine güncelleme
olarak inmez.

Keystore: `D:\SettleUp\build-tools\odahesap-release.keystore` (repoda değil)
Alias: `odahesap`

> Şifreyi bu dosyaya yazma — depo herkese açık. Şifre yalnızca yerel
> `frontend/android/gradle.properties` içinde durur, o dosya `.gitignore`'dadır.

## 1. `android/app/build.gradle`

`signingConfigs` bloğuna `release` ekle:

```gradle
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            storeFile file(ODAHESAP_STORE_FILE)
            storePassword ODAHESAP_STORE_PASSWORD
            keyAlias ODAHESAP_KEY_ALIAS
            keyPassword ODAHESAP_KEY_PASSWORD
        }
    }
```

`buildTypes.release` içindeki satırı değiştir:

```gradle
        release {
            signingConfig signingConfigs.release   // onceden: signingConfigs.debug
```

`defaultConfig` bloğundan sonra APK'yı mimariye göre bölmeyi ekle (tek dosya
~98 MB olup WhatsApp'ın 100 MB sınırını zorluyor; arm64-v8a tek başına ~35 MB):

```gradle
    splits {
        abi {
            reset()
            enable true
            universalApk false
            include "arm64-v8a", "armeabi-v7a", "x86_64"
        }
    }
```

## 2. `android/gradle.properties`

Dosyanın sonuna ekle:

```properties
ODAHESAP_STORE_FILE=D:/SettleUp/build-tools/odahesap-release.keystore
ODAHESAP_STORE_PASSWORD=<keystore sifresi>
ODAHESAP_KEY_ALIAS=odahesap
ODAHESAP_KEY_PASSWORD=<keystore sifresi>
```

Ayrıca `org.gradle.jvmargs` satırının sonuna
`-Djava.io.tmpdir=D:/SettleUp/build-tools/tmp` ekli olmalı; kullanıcı klasöründe
Türkçe karakter olduğu için Gradle daemon aksi halde başlamıyor.

## Doğrulama

Derlenen APK'nın hangi anahtarla imzalandığını görmek için:

```bash
D:\SettleUp\build-tools\android-sdk\build-tools\36.0.0\apksigner.bat verify --print-certs app-release.apk
```

Çıktıdaki sertifika sahibi `CN=OdaHesap` olmalı; `CN=Android Debug` görüyorsan
yukarıdaki ayarlar uygulanmamış demektir.
