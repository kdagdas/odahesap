# KaSa — Tam Proje Dokümanı

> Bu dosya, projeyi hiç bilmeyen bir kişiye veya araca devretmek için yazıldı.
> Tek başına yeterlidir; başka bir konuşmaya, sohbet geçmişine veya kişiye
> ihtiyaç duymaz. Günlük operasyon için [DEVAM.md](DEVAM.md), kurulum için
> [README.md](README.md).
>
> Son güncelleme: 16 Ağustos 2026 · Uygulama sürümü 1.0.0 (versionCode 32)

---

## 0. v11 sonrası ne değişti

Bu bölüm, dokümanın ilk yazıldığı andan (versionCode 11) bugüne kadarki
değişiklikleri özetler. Aşağıdaki bölümler güncellendi; burası "neyin ne zaman
geldiğini" tek bakışta görmek içindir.

**Tasarım (v12–v15).** Arayüz baştan yazıldı: lacivert + yeşil finans dili,
her ekranda tam genişlikte koyu bir başlık ve üstüne kavisle binen beyaz
yüzey. Kart başlıkları kartın içinde, liste satırları tek kap içinde saç teli
çizgilerle ayrılıyor. Yazı tipi IBM Plex Sans → **Inter** oldu. Yoğunluk
ölçeği `theme.ts` içindeki `metrics` sabitinden yönetiliyor.

**Tur 1+2 (v17).**
- Kapanmış dönemler donduruldu — bkz. §5 "Dönem yaşam döngüsü"
- Harcama düzenleme geçmişi (`expense_revisions`) ve bildirimi
- Kalemlere birim alanı (adet / kg / lt / paket)
- Aynı fiş uyarısı (market + tarih + toplam)
- Market ismi birleştirme: ticari unvan ekleri + bilinen zincir listesi +
  benzerlik ölçümü
- Çekilen fiş telefonun galerisine kaydediliyor (sunucuda saklanmıyor)
- `tests/sifre-sifirla.py` — uygulamada "şifremi unuttum" hâlâ yok

**Tur 3 (v18).**
- Profil üçe ayrıldı: **Profil** (sana ait) / **Ev ayarları** (ortak) /
  **Uygulama ayarları** (uygulamaya ait). Yeni bir özelliğin yeri artık
  "bu kime ait?" sorusuyla belirleniyor.
- Ev bazlı **ülke ve para birimi** (DE/EUR, TR/TRY). Dönüşüm yok; bir ev tek
  para birimi kullanır, farklı birimler toplanamaz.
- **Aktivite** sayfası ve Anasayfa'daki zil. Bildirimler artık `notifications`
  koleksiyonunda saklanıyor ve bu kayıt push'tan bağımsız yazılıyor.

**Tur 4 (v23).** Bölüşme modeli: her harcama artık kendi katılımcı listesini
taşıyor (`split_with`). Üç özel durum (`household` / `self` / `roommate`) tek
mekanizmaya indi — bkz. §5 "Bölüşme". Gelen iki yeni yetenek: **seçili
kişiler** (fişteki yumurtayı iki kişi bölüşür) ve **kişiye özel tutarlar**
(1200 € kira 350/400/450). Liste kayıt anında donuyor, bu da §11'deki "dönem
ortasında katılan üye" sınırını kapattı.

**Tur 5 (v24).** **Düzenli ödemeler** — kira, elektrik, internet. Takvim
tarihli (`day_of_month`), dönem değil: dönem üç hafta da sürebilir yedi hafta
da, elektrik hep ayın 15'inde gelir. **Kapatmak asla sessizce eklemez**;
vadesi gelen şablon bir öneri üretir, harcama yalnızca onayla oluşur. Onaylamak
"bu ödendi" demek olduğu için **ödeyen ayrıca seçilebiliyor** — uygulamayı açan
ile parayı veren çoğu zaman farklı.

**Tur 6 (v24).** **İstatistikler** — takvim ayı bazlı, Ev/Kişisel sekmeli,
kendi sayfasında. Turun asıl kazancı **sabit / değişken ayrımı**: Tur 5
olmadan kurulamazdı.

**Tur 7 (v25–v27).** İstatistik sayfası yeniden düzenlendi (halka + 9 kategori
tek kartta, ay-ay değişim, kümülatif eğri), **Faturalar** kartı geldi, Kasa'daki
çakışan istatistik bloğu silindi, **çoklu ev altyapısı** kuruldu, ortak
`BottomSheet` çıkarıldı, fiş tarama animasyonu eklendi ve tablet düzeni
düzeltildi.

**Tur 8 (v28–v32).** **Ödeme yolları** — IBAN ve PayPal, **cihazda saklanan**
bilgiyle; karekod bilerek yapılmadı (ödeyen kendi ekranını tarayamaz). Fiş
kalemlerine **genel ürün adı** (`Gelbwurzel 1kg` → havuç), bölüşme seçicisine
hızlı seçim çipleri, avatar tek kapıya indi.

**Test sayısı:** 189 → 281 → 336 → 497 → 516 → **521**. Yeni dosyalar: `donem-dondurma-test.py`,
`duzenleme-gecmisi-test.py`, `market-tekrar-test.py`, `para-birimi-test.py`,
`aktivite-test.py`, `bolusme-test.py`, `fiyat-test.py`, `duzenli-test.py`,
`aylik-test.py`.

**Sıradaki işler ve gerekçeleri** için §12'ye bakın. **Denenip bilerek geri
alınanlar** [SIRADAKI-TUR.md](SIRADAKI-TUR.md) içinde — bir sonraki oturum
onları "eksik" sanıp geri getirmesin.

---

## 1. Uygulama nedir

**KaSa**, birlikte yaşayan insanların ortak harcamalarını paylaşması için
yazılmış bir Android uygulamasıdır. Türkçe arayüzlüdür ve Almanya'daki
paylaşımlı ev senaryosu için tasarlanmıştır.

Ayırt edici özelliği: **Almanca market fişini kamerayla okuyup kalem kalem
ayrıştırması.** Fişteki her ürünü adı, adedi ve fiyatıyla çıkarır, kategorilere
böler, indirim satırlarını tanır. Splitwise gibi genel bölüşme uygulamaları bunu
yapmaz.

Şu anda üç kişilik bir ev tarafından gerçek kullanımdadır ve **hiçbir ücret
ödenmemektedir** — tüm servisler ücretsiz katmanlarda çalışır.

### Temel akış

1. Kullanıcı e-posta ve şifreyle kayıt olur
2. Ya yeni bir ev kurar (6 haneli davet kodu üretilir) ya da koda katılır
3. Ev yöneticisi katılma isteğini onaylar
4. Herkes harcama ekler — fiş tarayarak veya elle
5. Her harcamada kimlerin bölüştüğü seçilir: tüm ev, sadece kendisi, tek bir
   kişi, seçili kişiler ya da kişiye özel tutarlar (bkz. §5)
6. Kasa ekranı kimin kime ne kadar borçlu olduğunu en az sayıda transferle gösterir
7. Ödemeler gerçekleştikçe işaretlenir
8. Dönem sonunda yönetici dönemi kapatır, bakiyeler arşivlenir ve sıfırlanır

---

## 2. Bu proje nereden geldi — devralma hikâyesi

Proje, **Emergent** adlı bir yapay zekâ uygulama platformunda üretilmiş bir iş
alanı (`app_workspace.zip`) olarak devralındı. Çalışıyordu, ancak tamamen
Emergent'in altyapısına bağımlıydı:

| Bağımlılık | Nasıl çözüldü |
|---|---|
| Emergent Google OAuth (`auth.emergentagent.com`) | Kendi e-posta/şifre sistemimiz (bcrypt + opak oturum jetonu) |
| `emergentintegrations` LLM paketi + Emergent LLM anahtarı | Doğrudan Google Gemini REST API |
| Emergent önizleme sunucusu | Render.com ücretsiz servisi |
| Emergent MongoDB | MongoDB Atlas M0 |
| Emergent derleme araçları (`cmd-guard` vb.) | Silindi; yerel Gradle derlemesi |

### Devralırken bulunan ve düzeltilen hatalar

Bunlar tarihsel kayıt olarak burada; hepsi düzeltildi.

**Güvenlik**

1. **API her kullanıcı alanını döndürüyordu.** `/auth/me`, `/households/me` ve
   `/balances` uçları `password_hash` dahil her şeyi gönderiyordu. Ev
   arkadaşları birbirinin şifre özetini görebiliyordu. → Beyaz liste
   projeksiyonu (`PUBLIC_USER_PROJECTION`, `public_user()`).
2. **`.gitignore`'da `.env` deseni yoktu.** Dosyada "Environment files
   (comprehensive coverage)" başlığı vardı ama altı boştu. GitHub'a push
   edilseydi Gemini anahtarı ve MongoDB şifresi herkese açık olacaktı.
3. **Keystore şifresi dokümana yazılmıştı** ve commit'lenmişti. Push öncesi
   yakalandı, geçmiş temiz tek commit olarak yeniden kuruldu.

**Çalışmayı engelleyen**

4. **`httpx` ve `Pillow` bağımlılıkları eksikti.** `emergentintegrations`
   üzerinden dolaylı geliyorlardı; o paket kalkınca sunucu hiç açılmayacaktı.
5. **Windows'ta `npm install` çalışmıyordu** — `preinstall` kancası bir Linux
   kabuk betiği çağırıyordu.
6. **`gemini-2.5-flash` yeni API anahtarlarına kapatılmış** (404). Model
   `gemini-3.5-flash` olarak güncellendi.

**Doğruluk**

7. **Almanca umlaut çevriyazımı karşılanmıyordu.** Fişlerde çok yaygın olan
   `Broetchen`, `Spuelmittel`, `Kaese` yazımları hiçbir kategoriye eşleşmiyor,
   hepsi "diğer" oluyordu. → `_fold_german()` ile `ö/oe`, `ü/ue`, `ä/ae` aynı
   sonuca katlanıyor.
8. **Kategoriler sözlük sırasına göre deneniyordu**, bu yüzden `Fleischsalat`
   "salat" kelimesine takılıp meyve/sebze oluyordu. → En uzun (en özgül)
   anahtar kelime kazanıyor.
9. **Denge hesabı bugünkü üye listesine göre yapılıyordu.** Biri evden
   çıkarıldığında geçmiş kapalı dönemler yeniden bölünüyor ve o kişinin borcu
   kayıtlardan siliniyordu. → `period_participants()` o dönemde yer alan
   herkesi kapsıyor.
10. **Kapatılmış dönemdeki harcama silinebiliyordu**, ödeşilmiş geçmişi
    sessizce değiştiriyordu. → Kapalı dönemler dokunulmaz hâle getirildi.

**Arayüz**

11. **Ayarlar ekranına ulaşmanın tek yolu Panel'deki avatara dokunmaktı** —
    dişli simgesi yoktu, yazı yoktu. Kullanıcı ev adını değiştiremediğini
    bildirdi. → Ayarlar, alt menüde kendi **Profil** sekmesi oldu.
12. **Katılma istekleri görünmüyordu.** Sunucu isteği alıyordu ama arayüz ev
    bilgisini yalnızca uygulama ilk açıldığında bir kez çekiyordu. → Ekranlar
    her odaklanmada tazeleniyor. *(Bu hata, sunucu testlerinin arayüz
    hatalarını yakalayamayacağının en net örneğidir.)*
13. **Her 401 yanıtı "oturumun düştü" sayılıyordu.** `api.ts` jetonu siliyor ve
    sunucunun Türkçe mesajını atıp "Unauthorized" koyuyordu. Sonuç: şifre
    değiştirirken mevcut şifreyi yanlış yazan kullanıcı **sessizce dışarı
    atılıyordu**, giriş ekranında da anlamsız hata görünüyordu. → Sunucu gerçek
    oturum hatalarına `X-Session-Invalid` başlığı koyuyor; uygulama jetonu
    yalnızca o zaman siliyor.
14. **Fiş tarama ekranında rehber çerçevesi düğmelerle çakışıyordu**; alt menü
    ortadaki dairesel ikon etikete değiyordu.
15. **Bildirimler bir sürüm boyunca sessizce hiç gönderilmedi.** Sebep aşağıda
    ayrı başlıkta.

---

## 3. Mimari

```
Android APK  ──HTTPS──>  FastAPI (Render)  ──>  MongoDB Atlas
   Expo 54                                  ──>  Gemini API (fiş okuma)
   RN 0.81                                  ──>  Firebase FCM (bildirim)
```

| Katman | Teknoloji |
|---|---|
| Uygulama | Expo SDK 54, React Native 0.81, Expo Router, TypeScript |
| Sunucu | FastAPI + Motor (async MongoDB), Python 3.12 |
| Veritabanı | MongoDB Atlas M0 (ücretsiz, 512 MB) |
| Kimlik | Kendi sistemimiz: bcrypt + opak oturum jetonu, 90 gün, kayan süre |
| Fiş okuma | Google Gemini `gemini-3.5-flash` (görüntü → yapılandırılmış JSON) |
| Bildirim | Firebase Cloud Messaging HTTP v1 |
| Barındırma | Render.com ücretsiz web servisi |
| Uyanık tutma | GitHub Actions, 10 dakikada bir ping |

**Sunucu tek dosyadır:** `backend/server.py` (~1.680 satır, 42 uç). Bildirim
gönderimi ayrıdır: `backend/push.py`.

### Canlı adresler

| Ne | Nerede |
|---|---|
| API | https://odahesap-api.onrender.com |
| Kod | https://github.com/kdagdas/odahesap |
| Firebase projesi | `love-quiz-8d0b8` (mevcut bir projeye eklendi) |
| Android paket adı | `com.odahesap.app` |

Sağlık kontrolü her şeyi tek satırda söyler:

```bash
curl https://odahesap-api.onrender.com/api/
# {"service":"odahesap","ok":true,"push_ready":true,"push_detail":"hazir"}
```

### Sırlar

Hiçbiri depoda değildir. Render panelinde `odahesap-api` → **Environment**
altında: `MONGO_URL`, `GEMINI_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`.

`render.yaml` bunları `sync: false` ile bildirir. **Yeni bir ortam değişkeni
eklerken `render.yaml`'a da yazılmalıdır**, yoksa Blueprint deploy'u sırasında
silinebilir.

---

## 4. Veri modeli (MongoDB)

| Koleksiyon | Alanlar |
|---|---|
| `users` | `user_id`, `email` (tekil), `name`, `password_hash` (bcrypt, asla dönmez), `avatar_id`, `photo_version`, `notif_prefs`, `created_at` |
| `user_sessions` | `session_token` (tekil), `user_id`, `expires_at` (TTL indeksi), `created_at` |
| `households` | `household_id`, `name`, `invite_code` (tekil, 6 hane), `created_by`, `admin_id`, `member_ids[]`, `pending_member_ids[]`, `current_period_id` |
| `periods` | `period_id`, `household_id`, `started_at`, `closed_at`, `status` (`active`/`closed`), `final_balances` |
| `expenses` | `expense_id`, `household_id`, `period_id`, `added_by`, `split_mode`, `split_with`, `target_type`, `target_user_id`, `items[]`, `total`, `source`, `category`, `merchant`, `notes`, `expense_date`, `created_at` |
| `settlements` | `settlement_id`, `household_id`, `period_id`, `from_user_id`, `to_user_id`, `amount`, `recorded_by`, `created_at` |
| `shopping_items` | `item_id`, `household_id`, `scope` (`household`/`self`), `text`, `added_by`, `done`, `done_by`, `created_at` |
| `avatars` | `user_id` (tekil), `data` (ham JPEG), `mime`, `updated_at` |
| `recurring` | `recurring_id`, `household_id`, `created_by`, `scope` (`household`/`self`), `name`, `amount`, `amount_fixed`, `day_of_month`, `split_mode`, `split_with`, `category`, `merchant`, `active`, `last_confirmed` (`"2026-08"`), `skipped[]` |
| `price_points` | `merchant_key`, `merchant`, `product_key`, `product`, `pack_type`, `size_amount`, `size_unit`, `unit_price`, `price_unit`, `currency`, `country`, `week`, `category` — **kimlik alanı yoktur**, bkz. §12 |
| `devices` | `token` (tekil, FCM), `user_id`, `platform`, `updated_at` |

---

## 5. İş kuralları — para matematiği

Bu bölüm uygulamanın kalbidir. Değiştirilmeden önce
`tests/e2e-test.py`, `tests/privacy-test.py` ve `tests/settle-edit-test.py`
okunmalıdır.

### Bölüşme — her harcama kendi katılımcı listesini taşır

```
split_mode "equal"  →  split_with = { user_id: ağırlık }   (bugün hep 1)
split_mode "exact"  →  split_with = { user_id: tutar }
```

Bu liste **üç soruyu birden** cevaplar, çünkü üçü aslında aynı sorudur —
*bu harcama kimi ilgilendiriyor?*

| Ne | Kural |
|---|---|
| Para | Ödeyen `+total`, listedeki herkes kendi payı kadar `−` |
| Görünürlük | Ekleyen **ya da** listede olan görür |
| Bildirim | Listedekilere gider (ekleyen hariç) |

Eski üç tür bundan kendiliğinden çıkar, ve iki yenisi gelir:

| Durum | Liste | `target_type` etiketi |
|---|---|---|
| Tüm ev | herkes | `household` |
| Kendim | sadece ben → net etki 0, kimse görmez | `self` |
| Bir kişiye | sadece o kişi | `roommate` |
| **Seçili kişiler** | evin bir bölümü | `custom` |
| **Kişiye özel tutarlar** | `exact` kipinde herhangi bir liste | listeye göre |

`target_type` artık **kural değil, listeden türetilen bir etiket**. Süzgeçler,
ekrandaki rozet ve eski APK sürümleri onu okur; para ondan hesaplanmaz.

**Örnek.** 3 kişilik ev, Alice 90 € ev alışverişi yapar (liste: üçü de):
- Kişi başı pay 30 €
- Alice: `+90 − 30 = +60` (alacaklı), Bob `−30`, Carol `−30`

Alice ayrıca Bob için 18 €'luk şampuan alırsa (liste: sadece Bob):
- Alice `+18`, Bob `−18`. Carol'ın hesabında **hiç görünmez**.

Kira 1200 €, Bob öder, odalar farklı büyüklükte (`exact`, 350/400/450):
- Bob `+1200 − 400 = +800`, Alice `−350`, Carol `−450`
- Tek kayıt. Üç ayrı harcama ve gruplama etiketi gerekmiyor.

### Bölüşme listesi kayıt anında donar

Sonradan eve katılan biri geçmiş harcamaların payını kendiliğinden
üstlenmez — payı o harcamanın içinde yazılıdır ve yeniden hesaplanmaz.
Gerçekten üstlenmesi gerekiyorsa (kişi dönem başından beri evde, uygulamaya
sonradan katıldı) yönetici onay sırasında **"N harcamaya da kat"** der;
sunucu o dönemin eşit bölüşülen ev harcamalarına kişiyi ekler.

### Listesi olmayan eski kayıtlar

Tur 4 öncesi kayıtlarda `split_with` alanı yok. `split_of()` onları
`target_type`'tan türetir ve **bu yedek yol kalıcıdır**: tek seferlik bir göç
betiğinin kaçırdığı her kayıt sessizce dengeden düşerdi, bu yolla böyle bir
kayıp mümkün değil. (Bir üye onaylanırken o dönemin eski kayıtları ayrıca
dondurulur — yoksa "kat / katma" sorusunun cevabı onlarda uygulanmazdı.)

### Borç sadeleştirme

`simplify_debts()` açgözlü eşleştirme yapar: en büyük alacaklı ile en büyük
borçlu eşleştirilir. Amaç transfer sayısını en aza indirmektir.

### Ödeme işaretleme

Kaydedilen ödeme, oda arkadaşı harcamasının tam tersidir: ödeyenin dengesini
sıfıra yaklaştırır, alanınkini uzaklaştırır. **Harcamalardan sonra uygulanır**,
böylece önerilen transferler yalnızca kalan borcu gösterir. Kısmi ödeme
desteklenir. Ödemeyi yalnızca **tarafları** kaydedebilir veya geri alabilir.

### Dönem yaşam döngüsü

- Ev kurulduğunda ilk dönem açılır
- Yönetici dönemi kapatır → bakiyeler `final_balances` olarak arşivlenir, yeni
  boş dönem başlar
- Kapatma **geri alınabilir**, ancak yalnızca yeni döneme henüz harcama
  girilmemişse (girilmişse o harcamalar sahipsiz kalırdı)
- **Kapalı dönemler dokunulmazdır:** harcama düzenlenemez, silinemez, ödeme
  kaydı kaldırılamaz

### Üyelik ve pay

`period_participants()` bir dönemin hesabına, o dönemde harcaması, **ödemesi
veya bir harcamanın bölüşme listesinde adı** olan herkesi katar — sadece
bugünkü üyeleri değil. Böylece biri evden çıkarıldığında geçmiş dönemlerin
payları bozulmaz.

Dönem ortasında katılma sorunu Tur 4'te kapandı: liste kayıt anında donduğu
için yeni üye geçmişe kendiliğinden girmez, gerçekten girmesi gerekiyorsa
onay sırasında seçilir.

### Yönetici rolü

Ev kurucusu yöneticidir (`admin_id`, eski kayıtlarda `created_by`'a düşer).
Yalnızca yönetici: katılma isteğini onaylar/reddeder, ev adını değiştirir, üye
çıkarır, yöneticiliği devreder, davet kodunu yeniler, dönem kapatır/geri açar.

Yönetici evden ayrılırsa yöneticilik kalan bir üyeye **otomatik geçer** —
aksi hâlde kimse onay veremez hâle gelirdi.

Üye çıkarma, o kişinin açık dönemde harcaması varsa **engellenir**; doğru sıra
ödeş → dönemi kapat → çıkar.

---

## 6. Ekranlar

Alt menü beş sekmelidir; "Fiş Tara" gerçek ortada ve dairesel vurguludur
(Instagram düzeni):

```
Anasayfa · Alınacaklar · [Fiş Tara] · Kasa · Profil
```

> Rota dosya adları `panel` ve `denge` olarak kaldı (başka ekranlar bu yollara
> gidiyor); yalnızca görünen başlıklar Anasayfa ve Kasa oldu.

| Dosya | Ekran |
|---|---|
| `app/login.tsx` | Giriş / kayıt (sekmeli) |
| `app/onboarding.tsx` | Ev kur veya davet koduyla katıl; onay bekleme |
| `app/(tabs)/panel.tsx` | Anasayfa: net durum, ev arkadaşları, son harcamalar |
| `app/(tabs)/liste.tsx` | Alınacaklar: Ev / Kendim sekmeli |
| `app/(tabs)/tara.tsx` | Kamera + galeri, çoklu fiş desteği |
| `app/(tabs)/denge.tsx` | Kasa: bakiyeler, önerilen transferler, ödeme işaretleme, dönem kapatma/geri alma |
| `app/(tabs)/profil.tsx` | Profil, fotoğraf, hesap ayarları, bildirimler, ev yönetimi, üyeler |
| `app/harcamalar.tsx` | Harcama geçmişi, süzgeçlerle (Anasayfa'daki "Tümü"nden) |
| `app/review.tsx` | Fiş okuma sonucu: kalem kalem düzenleme ve dağıtım |
| `app/manual.tsx` | Elle harcama girişi |
| `app/expense-edit.tsx` | Harcama düzenleme, kalem bazlı |
| `app/member-detail.tsx` | Bir üyenin dönem içindeki harcama dökümü |

Paylaşılan modüller `frontend/src/`: `api.ts` (istemci + yeniden deneme +
uyanma sinyali), `auth.tsx`, `household.tsx`, `notifications.ts`, `photo.ts`,
`theme.ts`, `ui.tsx`, `WakingBanner.tsx`.

---

## 7. API (42 uç)

Tümü `/api` önekiyle. Sağlık ucu dışında hepsi `Authorization: Bearer <jeton>` ister.

**Kimlik**
`POST /auth/register` · `POST /auth/login` · `GET /auth/me` · `POST /auth/logout`
`PATCH /auth/profile` · `POST /auth/change-email` · `POST /auth/change-password`
`PUT /auth/photo` · `DELETE /auth/photo` · `GET /users/{id}/photo`
`PATCH /auth/notifications`

**Ev**
`POST /households` · `PATCH /households` · `GET /households/me` · `POST /households/join`
`POST /households/approve` · `POST /households/reject` · `POST /households/leave`
`POST /households/remove-member` · `POST /households/transfer-admin`
`POST /households/regenerate-invite`

**Harcama**
`POST /expenses` · `GET /expenses` · `PATCH /expenses/{id}` · `DELETE /expenses/{id}`
`GET /members/{id}/expenses` · `POST /ocr/receipt`

**Denge ve dönem**
`POST /price-memory` — evin kendi fişlerinden, aynı market içinde ürün fiyatı geçmişi
`GET /recurring` · `POST /recurring` · `PATCH /recurring/{id}` · `DELETE /recurring/{id}`
`POST /recurring/{id}/confirm` · `POST /recurring/{id}/skip`
`GET /stats/monthly` — takvim ayı bazlı, `?month=2026-08&scope=household|self`
`GET /balances` · `GET /periods` · `POST /periods/close` · `POST /periods/reopen`
`GET /settlements` · `POST /settlements` · `DELETE /settlements/{id}`

**Alınacaklar**
`GET /shopping` · `POST /shopping` · `PATCH /shopping/{id}` · `DELETE /shopping/{id}`
`POST /shopping/clear-done`

**Cihaz**
`POST /devices/register` · `POST /devices/unregister`

---

## 8. Kolay gözden kaçan tasarım kararları

Bunlar bilinçli tercihlerdir; sebebini bilmeden değiştirilirse hata gibi
görünürler.

**Bildirim hataları yutulur.** `notify()` asla istisna fırlatmaz — bildirim
gönderilememesi harcamanın kaydedilmesini engellememelidir. Bunun bedeli
ödendi: bir sürüm boyunca bildirimler sessizce hiç gitmedi, çünkü
`google-auth` paketi `requests`'i **zorunlu bağımlılık olarak getirmiyor**;
`google.auth.transport.requests` import edilirken `ImportError` fırlıyor ve
`try/except` bunu yutuyordu. Yerelde fark edilmedi çünkü `requests` test
bağımlılığı olarak kuruluydu — yani kodun çalıştırıldığı yer, çalışacağı
yerden farklıydı. → `google-auth[requests]` ve açılışta `push.self_check()`.
**Bu erken uyarı kaldırılmamalıdır.**

**401'in iki anlamı vardır.** Gerçek oturum hatası `X-Session-Invalid` başlığı
taşır; yanlış şifre taşımaz. Uygulama jetonu yalnızca başlık varsa siler.

**Fotoğraflar ayrı koleksiyonda ve ayrı uçtan servis edilir.** Kullanıcı
nesnesine gömülseydi, ev bilgisi her ekran odaklanmasında yenilendiği için tüm
üyelerin fotoğrafı sürekli yeniden inecekti. `photo_version` yalnızca önbellek
kırıcıdır; adres sonsuza kadar önbelleklenebilir ama yeni yüklemede değişir.

**Fotoğraf telefonda küçültülür.** Ham telefon fotoğrafı base64'e çevrilince
7 MB'ı aşar. 256 piksele indirilince ~15 KB olur ve avatar boyutunda fark
görünmez.

**Alınacaklar listesine ekleme iyimserdir** — ağ cevabı beklenmez. Art arda
madde girerken her birinde beklemek uygulamayı bozuk hissettiriyordu.

**Uyanma şeridi ve otomatik yeniden deneme.** Render ücretsiz katmanı 15 dk
boşta kalınca uyur; ilk istek ~50 sn sürer ve boot sırasında 502 dönebilir.
`api.ts` 502/503/504 ve ağ hatalarında 3 kez yeniden dener; istek 3 saniyeyi
aşarsa ekranın üstünde açıklayıcı bir şerit çıkar.

**E-posta değiştirmek şifre sorar.** Masada açık kalan bir telefon, hesabı
sahibinin erişemediği bir adrese taşıyamamalıdır.

**Şifre değişince diğer cihazların oturumu düşer**, mevcut telefon açık kalır.
Şifre değiştirmenin amacı başkasını dışarıda bırakmaksa, eski oturumların
ayakta kalması o amacı boşa çıkarır.

**Kişisel ("Kendim") harcamalar hiçbir bildirim üretmez** — gizli olmaları
gereken şeyler varlıklarını bile duyurmamalıdır.

---

## 9. Derleme ve dağıtım

Araç zinciri `D:\SettleUp\build-tools` altındadır, **sisteme kurulu değildir**:
taşınabilir JDK 17, Android SDK 35+36, NDK 27, Gradle önbelleği.

```bash
cd frontend
npx expo prebuild --platform android --no-install
cd android && gradlew.bat assembleRelease
```

Öncesinde `JAVA_HOME`, `ANDROID_HOME`, `GRADLE_USER_HOME`, `TEMP`, `TMP`
ayarlanmalıdır. Çıktı: `app/build/outputs/apk/release/app-arm64-v8a-release.apk`
(~38 MB). Üç mimari üretilir; dağıtılan `arm64-v8a`, 2016 sonrası tüm
telefonları kapsar. Birleşik tek APK ~98 MB olur ve WhatsApp sınırını aşar.

### Bu ortama özgü dört tuzak

1. **`gradlew clean` çalıştırmayın.** `clean` CMake'i yeniden yapılandırır,
   NDK 27 ise CMake 3.22'nin istediği `gold` bağlayıcısını desteklemez.
   Temiz derleme için `app/build`, `app/.cxx`, `android/build` klasörlerini
   **elle** silip doğrudan `assembleRelease` çalıştırın.
2. **Windows kullanıcı adında Türkçe karakter var** (`Kadir Dağdaş`), bu yüzden
   JVM geçici dizinde soket açamıyor ve Gradle daemon hiç başlamıyor.
   `gradle.properties` içindeki `-Djava.io.tmpdir=D:/SettleUp/build-tools/tmp`
   **silinmemelidir.**
3. **PowerShell `Set-Content -Encoding utf8` BOM ekler**, Groovy bunu
   ayrıştıramaz ve `build.gradle` bozulur. BOM'suz yazın:
   `[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))`
4. **`versionCode` `app.json`'dan gelir.** `build.gradle`'da elle değiştirmek
   işe yaramaz; bir sonraki `prebuild` üzerine yazar.

### İmzalama

Keystore: `D:\SettleUp\build-tools\odahesap-release.keystore`, alias
`odahesap`, şifre `odahesap2026`. **Bu dosya kaybedilirse bir daha güncelleme
APK'sı üretilemez** — kullanıcıların uygulamayı silip yeniden kurması gerekir.
Yedeklenmelidir. Ayrıntı: [IMZALAMA.md](IMZALAMA.md).

### Sunucu deploy'u

`main` dalına push → Render otomatik deploy eder (2-5 dk). Deploy'un gerçekten
geçtiğini yeni bir ucun varlığıyla doğrulayın; Render "live" dese de eski sürüm
ayakta kalabiliyor (bu projede yaşandı).

---

## 10. Testler

On dokuz takım, toplam **497 kontrol**, hepsi çalışan bir API'ye HTTP ile bağlanır.
Yerelde de canlıda da aynı şekilde çalışır:

```bash
cd backend
.venv/Scripts/python.exe ../tests/e2e-test.py https://odahesap-api.onrender.com
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
| `bolusme-test.py` | `split_with`, kişiye özel tutarlar, listenin donması | 52 |
| `duzenli-test.py` | düzenli ödemeler: vade, çift onay koruması, ödeyen | 53 |
| `aylik-test.py` | takvim ayı istatistiği: ay sınırı, kapsam, sabit/değişken | 33 |
| `fiyat-test.py` | birim fiyat, paket sınıfı, fiyat hafızası | 46 |
| `donem-dondurma-test.py` · `duzenleme-gecmisi-test.py` · `market-tekrar-test.py` · `para-birimi-test.py` · `aktivite-test.py` · `stats-test.py` · `categorize-test.py` | Tur 1-3'ten | 147 |

Hepsi kendi test hesaplarını oluşturup sonunda temizler; üretim verisine
dokunmaz. Yardımcılar: `fcm-verify.py` (Firebase kimlik bilgisi gerçekten
çalışıyor mu), `yedekle.py`, `test-verisi-temizle.py`.

> **Kritik uyarı:** Bu testlerin tamamı **sunucuyu** korur. Arayüz hiçbir
> cihazda otomatik çalıştırılmaz. Bu projede bulunan arayüz hatalarının hepsi
> elle kullanım sırasında ortaya çıktı — özellikle 12 ve 13 numaralı hatalar
> sunucu testlerinden geçtikleri hâlde kullanıcıyı engelliyorlardı.

---

## 11. Bilinen sınırlar

- **Şifre sıfırlama yok.** Kullanıcı şifresini unutursa veritabanından elle
  müdahale gerekir.
- **E-posta doğrulaması yok.** Adresin gerçek olup olmadığı kontrol edilmez;
  yazım hatası yapan kullanıcı o adresle kalır. (Bu fiilen yaşandı.)
- **Hiçbir uçta hız sınırlaması yok.** Üç kişilik kullanımda sorun değil, ama
  genele açılırsa: davet kodu 6 hanedir (bir milyon ihtimal) ve `/households/join`
  sınırsız denenebilir; `/ocr/receipt` de döngüye sokularak Gemini kotası
  tüketilebilir.
- **Gemini Pro aboneliği API kotasını ÇÖZMEZ.** O tüketici ürünü (uygulama,
  Gmail/Docs entegrasyonu); API kotası anahtarın bağlı olduğu Google Cloud
  projesine ait ve ayrı faturalandırılır. Kotayı açan tek şey o projede
  faturalandırmayı açmak — kodda hiçbir şey değişmez.
- **Faturalandırma açılınca hız sınırlaması öncelik olur.** Ücretsiz katmanda
  `/ocr/receipt` istismarının bedeli "kota doldu"ydu; ücretlide bir fatura.
- **Fiş fotoğrafı tam çözünürlükte gönderiliyor** (yalnızca JPEG kalitesi
  düşürülüyor). Küçültmek yükleme, sunucu ve model tarafında birden kazandırır;
  `src/photo.ts` avatarlar için bunu zaten yapıyor. Eşik **ölçülerek**
  bulunmalı: çok küçültmek fişi okunmaz yapar.
- **Gemini ücretsiz katmanı arka arkaya iki fiş taramayı kaldırmıyor.**
  Ölçüldü: üretime karşı iki ardışık `/ocr/receipt` isteğinde birincisi 200
  (13 sn), ikincisi **429 — kota**. Sunucu 429'da bir kez 20 sn bekleyip
  tekrar deniyor (kota dakikalık), istemci de hangi fişin neden okunamadığını
  yazıyor. Kalıcı çözüm Google Cloud'da faturalandırmayı açmak: fiş başına
  maliyet kuruşun binde birkaçı, ama limitler bambaşka. **Genele açmadan önce
  şart.**
- **Fiş okuma her zaman 10–20 saniye sürer.** Bu yüzden `api.ts` içindeki
  uyanma şeridi OCR çağrılarında bilerek susturuldu: 3 saniyelik eşik yüzünden
  her taramada "sunucu uyanıyor" diyordu ve bu yanlıştı — sunucu uyanmıyor,
  model çalışıyor.
- **Atlas M0'da otomatik yedek yok.** `tests/yedekle.py` elle çalıştırılmalıdır.
- **Render ücretsiz katmanı uyur.** GitHub Actions 10 dakikada bir ping atar.
  Aylık 750 saatlik kota tek servisi 7/24 ayakta tutmaya ancak yeter —
  **aynı hesapta ikinci bir ücretsiz servis açılmamalıdır.**
- **iOS sürümü yok.** Mac ve yıllık geliştirici hesabı gerekir.

---

## 12. Yapılmadan bırakılanlar

### Kararlaştırılmış sıra

Aşağıdaki sıra ev sahibiyle konuşulup kabul edildi. İki bağımlılık **katı**:

1. ~~**`{kişi: tutar}` bölüşme modeli**~~ — **Tur 4'te yapıldı** (v23).
   Kira senaryosu (c) için ayrı bir mekanizma gerekmedi: `exact` kipli tek
   kayıt yetti. Fiş kalemleri de kendi listelerini taşıyor, aynı kişilerin
   bölüştüğü kalemler kaydederken tek harcamada toplanıyor. Evden ayrılma
   kuralı **bilinçli olarak değişmedi** — gerekçe aşağıda.
2. ~~**Düzenli ödemeler**~~ — **Tur 5'te yapıldı** (v24). "Onayla / Düzenle"
   tek şeye indi: karta dokunmak dolu gelen sayfayı açıyor. Ayrıca ödeyen
   seçilebiliyor, çünkü onaylamak izin vermek değil "bu ödendi" demek ve
   ödeyen bakiyede alacaklı çıkıyor.
   **Yapılmadı:** vadesi gelince push bildirimi. Zamanlanmış iş yok; en ucuz
   yol mevcut GitHub Actions'a günlük bir iş eklemek (~1,5-2 sa). Yeni ortam
   değişkeni `render.yaml`'a da yazılmalı.
3. ~~**İstatistikler sayfası**~~ — **Tur 6'da yapıldı** (v24). Sıra doğru
   işledi: sabit/değişken ayrımı Tur 5'in `recurring_id`'sine dayanıyor ve
   ondan önce kurulsaydı bu kesit hiç olmayacaktı.
4. **Arama** (market + ürün + kişi) — sıradaki tur. Sonra CSV ve logolu PDF
   dışa aktarma, dönem hatırlatması, ödeme yolları, avatarlar
5. Çoklu yönetici + **kurucu** kavramı — yöneticiler işletme işlerini yapar,
   üye çıkarma ve yönetici atama yalnızca kurucuda. Böylece iki yöneticinin
   birbirini çıkarıp evi kilitlemesi mümkün olmuyor.
6. Ev/Grup ayrımı ve bir kullanıcının birden çok alanda olabilmesi

### Fiyat verisi — ne toplanıyor, ne toplanmıyor, ne zaman

Tur 4'ten sonra her fiş harcaması `price_points` koleksiyonuna anonim birim
fiyat kayıtları da yazıyor (bkz. §5). Amaç iki katmanlı: kullanıcıya kendi
fiyat hafızası, ileride ölçeğe ulaşıldığında toplu bir fiyat veri seti.

**Kimlik yazma anında kopuk.** `household_id` / `user_id` / `expense_id` hiç
yazılmıyor — sonradan temizlenen değil, hiç var olmayan alanlar. Sonradan
silinen bir alan yedeklerde ve günlüklerde yaşamaya devam eder. Tarih hafta
çözünürlüğünde: gün + nadir ürün + market üçlüsü tek bir fişe kadar
izlenebilir, hafta izlenemez.

**Karşılaştırma yalnızca aynı marketin içinde.** "REWE'de 2 €, ALDI'de 1 €"
çoğu zaman fiyat farkını değil *ürün farkını* ölçer: süt her markette kendi
markası altında (`MILSANI`, `MILBONA`, `JA!`), aynı gramajlı biber birinde
tepside ötekinde açık. Aynı marketin içinde ise fiş metnini o marketin kasası
üretir, yani dizgi haftadan haftaya sabittir. Marketler arası karşılaştırma
ancak barkod (EAN) ile sağlam olurdu; Alman fişleri onu genelde basmıyor.
**Yapısal olarak zor, bilerek yapılmıyor.**

**Genele açmadan ÖNCE açılması gerekenler.** Şube adresi (zincir + sokak +
PLZ + şehir) ve ödeme yöntemi sınıfı (nakit / kart) fişte basılı ve OCR
okuyabilir. İkisi de bugün *istenmiyor*, dolayısıyla veritabanında yoklar.

> **Geriye dönük doldurulamazlar.** Fiş fotoğrafları sunucuda saklanmıyor
> (telefonun galerisine kaydedilip bırakılıyor, bilinçli bir gizlilik kararı).
> Yani bugün çıkarılmayan hiçbir bilgi sonradan çıkarılamaz. Bu alanlar
> genele açılıştan **önce** açılmazsa ilk ayların fişleri eksik kalır.

Ödeme yönteminde yalnızca *sınıf* alınmalı. Kart satırının etrafında maskeli
kart numarası, terminal kimliği ve işlem izleme numarası basılıyor; bunlar
ödeme verisi, toplanmamalı ve OCR istemine açık yasak yazılmalı.

**Hane ↔ konum bağlantısı ayrı bir karardır.** Şube adresini *mağazanın
özelliği* olarak saklamak kişisel veri değildir ve ticari değerin neredeyse
tamamını verir — "hangi bölgede ne kadar alışveriş" sorusu şube başına fiş
sayısından zaten çıkar. Ama aynı adresi *bir haneyi konumlandırmak* için
kullanmak, ad silinse bile kişisel veri işlemektir. Gerekirse:
**açık rıza (opt-in, önceden işaretli kutu değil)**, amaç sınırlaması,
saklama süresi, silme yolu ve muhtemelen bir etki değerlendirmesi (DPIA).
Ortakla paylaşılan veri geri çağrılamaz — IBAN kararının aynısı: cihazdan
sunucuya geçmek kolay, tersi zordur.

**Test verisi fiyat kayıtlarını kirletir ve ayıklanamaz.** Kimlik alanı
taşımadıkları için hangi kaydın testten geldiği sonradan anlaşılamıyor. Tek
çare koleksiyonu sıfırlayıp kaynak fişlerden yeniden üretmek
(`tests/fiyat-doldur.py --sifirla --yaz`). Bu yüzden testler ayrı
veritabanında çalıştırılmalı: `DB_NAME=odahesap_test`. Ayrıntı: DEVAM.md.

### Çoklu ev — dokümandaki tahmin YANLIŞTI

Bu bölüm önceden "`get_user_household()` 20 yerde çağrılıyor, tek ev varsayımı
derine işlemiş, ~8-12 sa" diyordu. Ölçüldü, doğru değil:

```
v18: 24 çağrı · v22: 24 · v23: 24 · v25: 31
```

Çağrı sayısı her turla artıyor (endişe haklı), **ama hepsi tek bir iki
satırlık fonksiyondan geçiyor.** "Bir kullanıcı = bir ev" varsayımı yalnızca
iki yerde: o fonksiyon ve `/households/join` içindeki "Zaten bir evdesiniz"
kontrolü. Diğer ev sorguları elindeki kimlikle arama yapıyor.

**Tur 7'de altyapı kuruldu:** `get_user_household()` artık kullanıcının
`active_household_id` alanını okuyor, boşsa eski davranışa düşüyor. Çağrı
yerlerinin hiçbirine dokunulmadı ve bugün hiçbir şey farklı çalışmıyor.
Geriye kalan iş (~4-5 sa): çoklu üyelik, ev seçici, katılma kısıtının
kaldırılması.

**Grup ≠ ev.** Grup, adı farklı bir ev değil — sadeleştirilmiş bir ev:
dönem yok (grubun kendisi bir dönem), düzenli ödeme yok, alınacaklar genelde
gereksiz, bitince arşivleniyor.

### Karanlık tema — maliyeti koşula bağlı

Doküman "~4-5 sa, ~600 satır stilin bileşen içine taşınması" diyordu; bugün
o rakam **22 dosyada 1.234 satır** ve her yeni ekran ~40 satır ekliyor.

Ama bu yalnızca tema **canlı** değişecekse geçerli. Tema **sistem ayarını
takip edip yalnızca açılışta okunursa**, `StyleSheet.create` zaten açılışta
çalıştığı için hiçbir stilin taşınmasına gerek yok: **~1-2 sa.** Bedeli,
kullanıcının sistem temasını değiştirmesinin bir sonraki açılışta yakalanması.

**Renk kararı: ters çevirme YOK.** Bugün lacivert zemin, beyaz yüzey onun
üstünde; kavisle binen o katman uygulamanın imzası ve "bu yüzey yukarıda"
diyor. Ters çevrilirse beyaz başlık ekranın en açık öğesi olur ve ilişki
bozulur. Doğrusu ilişkiyi korumak:

| | Aydınlık | Karanlık |
|---|---|---|
| Başlık (zemin) | `#0F1B33` | **daha koyu** lacivert `#0A1120` |
| Yüzey (üstte) | beyaz | koyu gri `#161B22` |
| İlişki | yüzey daha açık | **yüzey yine daha açık** |

Yeşil vurgu ve amber (`attention`) her iki temada da çalışıyor.

### Konumlandırma — tek kitle seç

Uygulama üç kitleye bakıyor: WG/öğrenci evi, grup (tatil, yemek), tek kişilik
ev. Kod tarafında üçü aynı çekirdeğin kırpılmış hâli, **karmaşıklaşan ürün
değil anlatı**. "Ev arkadaşları ve gruplar ve tek yaşayanlar için" diyen bir
cümle hiçbir şey söylemiyor.

Afişte tek şey olmalı ve kimsenin olmadığı yer belli: **fişi kalem kalem
okumak.** Splitwise yapmıyor, bütçe uygulamaları yapmıyor. Grup ve tek kişilik
ev, indiren kişinin sonradan fark ettiği şeyler olsun. Üçünden **tek kişilik
ev** afişten çıkarılmalı: en kalabalık pazar ve bölüşme olmadığı için fiş
okuma avantajı orada daha az parlıyor.

**Banka bağlantısı yapılmayacak** — düzenlemeye tabi, pahalı, ve bizim farkımızı
değil rakibin oyununu oynamak olur.

### Kararlaştırılmış tasarım notları

- **Ödeme sayfası TEK yüzdür** (v34'te yeniden kuruldu). Önce iki yüzdü —
  tutar, sonra yollar — ve tutar yüzü bir **gişeydi**: tutar zaten dolu
  geliyordu, kullanıcı ona bakıp yeniden "Öde"ye basıyordu. Karşı taraf
  bilgisini paylaşmamışsa akış orada **çıkmaza** giriyordu; nakit ödeyecek
  birinin bile yolu kapalıydı.

  Bugünkü düzen üç bölge, aralarında yalnızca saç teli çizgi: **tutar**
  (büyük, dolu, dokununca düzeltilir + Tamamı/Yarısı/Başka çipleri) →
  **yollar** (PayPal, IBAN — sessiz liste satırları) → **kayıt** (Nakit/elden
  ödedim → Kaydet). Sayfada **tek koyu düğme** vardır ve o kayıttır.

  Gerekçe: **parayı biz taşımıyoruz.** Banka yönlendirmesinin sonucunu
  göremiyoruz; uygulamanın gerçekten sahip olduğu tek iş defter kaydı. O
  yüzden kayıt en altta ve her durumda erişilebilir, yollar ise yardımcı.
  Ayrı bir "kısmi öde" düğmesi **konmadı** — nadir durum sık durumla aynı yeri
  kaplamamalı; çipler o işi görüyor.

  Dönüşteki **"kaydedelim mi?" Alert'i kaldırıldı.** Yerine kayıt satırında
  `PulseDot` yanıyor: aynı hatırlatmayı yapıyor ama ekranın ortasına
  sıçramıyor. Kaybolan bir şey yok, çünkü sayfa zaten açık kalıyor.
- **IBAN cihazda saklanır**, sunucuda değil. Cihazdan sunucuya geçmek kolay,
  tersi zordur: sunucudan silmek duyuru ve güven kaybı demek.
- **Ödeme yolunu paylaşma** uygulama bağlantısıyla yapılır (WhatsApp mesajının
  içinde), böylece bilgi bizim sunucumuza hiç uğramaz.
- **Paylaşma düğmesi ALACAKLININ ekranında da durur.** İlk sürümde bu yol
  yalnızca Profil'in içindeydi ve tek tetikleyicisi borçlunun "İste" demesiydi:
  mesaj gidiyor, alacaklının onu okuyup Profil → Ödeme Bilgilerim → Paylaş
  yolunu bulması gerekiyordu. Dört adım, iki kişi, iki uygulama — üstelik
  alacaklı o ekranı hiç keşfetmemiş olabilir. Oysa bilgiyi paylaşabilecek tek
  kişi odur ve zaten "X sana 42 € borçlu" yazan ekrana bakmaktadır.
  Kasa'da kendi satırında ikinci bir düğme görüyor; hiç bilgi girmemişse düğme
  "Paylaş" demiyor, doğrudan formu açıyor.
  **Düğme paylaştıktan sonra kaybolmaz, küçülür.** Kaybolamaz çünkü IBAN
  değişir ve eve yeni biri katılır; büyük de kalamaz çünkü "Kim Kime Borçlu"
  ekranın en yoğun bloğu. Cihazdaki "paylaştım" işareti karşı tarafın
  kaydettiğinin **kanıtı değildir** — bilgi cihazda durduğu için o bilgi bize
  hiç ulaşmıyor. İşaret yalnızca *vurgu* kararını veriyor, yanlış olması
  hiçbir şeye mal olmuyor. Borçludaki "İste" de duruyor: ikisi farklı
  yerlerden başlıyor (borçlu ödemeye kalkışınca, alacaklı ekrana bakınca).
- **Banka uygulamasına yönlendirme güvenilir değildir.** Ortak bir derin
  bağlantı standardı yok. Çalışan yollar: IBAN'ı panoya kopyalayıp bankayı
  açmak, WhatsApp'tan paylaşmak, aynı odadayken EPC/Girocode karekodu,
  ve PayPal.me bağlantısı.
- **Evden ayrılırken dönem kapatılır.** Kişi bazlı bakiye dondurma
  ("evde değil ama borçlu üye") tartışıldı ve **elenmedi ama ertelendi**:
  Kasa ekranı, üye listesi, bildirimler ve dönem kapatma bu üçüncü durumu
  bilmek zorunda kalıyor — yılda bir olan bir olay için kalıcı karmaşıklık.
  "Dönemi kapat ve çıkar" diye tek düğme de **konmadı**: dönem kapatmak
  "bakiyeler arşivlendi, bu rakamlar ödendi" demek, kolayca basılan bir
  düğme insanları ödeşmeden arşivlemeye iter. Doğru sıra Kasa'dan ödeş →
  dönemi kapat → çıkar.
- **Tüketim karşılaştırması konmayacak** ("kim ne kadar tüketti"). Kimin daha
  çok alışveriş yaptığını değil kimin daha müsait olduğunu ölçer ve ev
  arkadaşları arasında gereksiz sürtünme üretir.

### Tahminler

| İş | Tahmin | Not |
|---|---|---|
| Düzenli harcamalar (kira, fatura) | ~4-6 sa | Yukarıdaki sırada 2. madde; takvim tarihli ve onaylı |
| Harcama dağılımı grafiği (ev + kişisel) | ~3 sa | "Kendim" verisi kaydediliyor ama hiç gösterilmiyor |
| Çevrimdışı kuyruk | ~2 sa | Uyanma ekranı riskin çoğunu azalttı |
| Karanlık tema | ~4-5 sa | Renkler `theme.ts`'te sabit; her ekran `StyleSheet.create` ile modül yüklenirken stilini üretiyor. Dinamik tema ~600 satır stilin bileşen içine taşınmasını gerektirir |
| Google ile giriş | ~4 sa | Firebase projesi zaten var. Doğrulanmış e-posta getirir: şifre sıfırlama ve yazım hatası sorunlarını bitirir |
| Hız sınırlaması | ~2 sa | Genele açmadan **önce** şart |
| Hesap silme + veri dışa aktarma | ~3 sa | GDPR asgarisi |
| Çoklu ev/grup üyeliği | ~8-12 sa | Sırada 6. madde.  `get_user_household()` 20 yerde çağrılıyor; tek ev varsayımı derine işlemiş |
| Ev içi sohbet | ~4-5 sa | **Önerilmedi** — WhatsApp zaten var, alınacaklar listesi ihtiyacı daha iyi karşılıyor |

---

## 13. Genele açma senaryosu — maliyet notları

Bugün üç kişi için hiçbir ücret ödenmiyor. Genele açılırsa:

| Kalem | Render + Atlas | Kendi VPS'i (ör. Hetzner) |
|---|---|---|
| Sunucu | ~7-25 €/ay | ~5 €/ay |
| Veritabanı | ~10-60 €/ay | 0 (aynı makinede) |
| OCR (Gemini) | ~10-15 €/ay (1.000 kullanıcı, ayda 20 fiş) | aynı |
| Bildirim (FCM) | 0 | 0 |
| Play Store | 25 € tek seferlik | aynı |

**OCR sanıldığı kadar pahalı değildir.** Flash sınıfı bir görüntü modelinde fiş
başına maliyet binde birkaç kuruştur; birkaç bin kullanıcıya kadar baskın kalem
sabit altyapıdır. Ücretsiz katmanda sorun maliyet değil, dakikalık istek
limitidir.

**Açık kaynak "bedava" demek değildir.** Tesseract/PaddleOCR ücretsizdir ama
düz metin verir, kalem listesi vermez; termal fiş üzerinde doğruluğu düşüktür
ve üstüne ayrıştırma katmanı yazmak gerekir. Açık ağırlıklı görüntü modelleri
kaliteyi yakalayabilir ama GPU ister (aylık 50-200 €), yani **API'den
pahalıdır** — çok yüksek hacme çıkana kadar.

Gerçek tasarruf barındırmadadır: kendi VPS'inde sunucu + veritabanı ~5 €/ay.

**Fiyatlama.** Splitwise ücretli sürümü aylık 3-4 € bandındadır, çıpa budur.
Doğal model: ücretsizde fiş taramayı sınırlamak (örn. ayda 10), ücretlide
sınırsız — çünkü kullanım başına para yakan tek şey odur.

---

## 14. İlk yapılacaklar (yeni devralan için)

1. `curl https://odahesap-api.onrender.com/api/` — `push_ready: true` mü?
2. `DEVAM.md` oku (günlük operasyon, tuzaklar)
3. `backend/server.py` oku — sunucunun tamamı orada
4. Testleri **ayrı bir veritabanına** karşı çalıştır (`DB_NAME=odahesap_test`),
   497'sinin de geçtiğini gör
5. Kod değiştirmeden önce ilgili test takımını oku; iş kuralları oraya yazılı

**Değiştirmeden önce iki kez düşünülecek yerler:** `_compute_balances()`,
`expense_shares()`, `split_of()` ve `period_participants()` (para matematiği),
`_visible_filter()` (gizlilik), `get_current_user()` (401 ayrımı),
`push.self_check()` (sessiz hata koruması), kapalı dönem kontrolleri.
