"""Analiz uclari: Son 6 Ay serisi, urun bazli toplam, kategori sayfasi.

Tur 11'in ilk uc maddesi. Uc soru:

  1. `son_aylar` cubugundaki bir ayin toplami, o aya girildiginde gorunen
     toplamla AYNI mi? (Ikisi de `_kapsa` okuyor; ayrisirlarsa kullanici
     cubukta bir sayi gorup dokundugunda baskasini bulur.)
  2. Urun toplama `product_key` uzerinden calisiyor mu -- yani ayni urunun
     farkli market markalari TEK satirda birlesiyor mu? Tur 8'in genel urun
     adi isi bunun altyapisi.
  3. Kategori sayfasi fisin YALNIZCA o kategorideki kismini mi sayiyor?
     Fisin tamamini saymak kategori toplamini sisirir ve halkadaki dilimle
     celisirdi.

    cd backend
    .venv/Scripts/python.exe ../tests/analiz-test.py http://127.0.0.1:8090

Sunucuyu AYRI veritabaniyla baslatin: DB_NAME=odahesap_test
"""
import sys
import uuid
from datetime import date

import httpx

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8001").rstrip("/")
API = f"{BASE}/api"
TAG = uuid.uuid4().hex[:8]
AY = date.today().strftime("%Y-%m")

ok = fail = 0


def check(label, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  [OK]   {label}")
    else:
        fail += 1
        print(f"  [FAIL] {label}  {detail}")


def hdr(t):
    return {"Authorization": f"Bearer {t}"}


c = httpx.Client(timeout=90.0)
r = c.post(f"{API}/auth/register", json={
    "email": f"anz_{TAG}@odahesap-e2e.com", "password": "sifre123", "name": "Anz Test"})
r.raise_for_status()
tok = r.json()["session_token"]
c.post(f"{API}/households", headers=hdr(tok), json={"name": f"Analiz Ev {TAG}"})


def harcama(**kw):
    kw.setdefault("target_type", "household")
    kw.setdefault("source", "receipt")
    r = c.post(f"{API}/expenses", headers=hdr(tok), json=kw)
    r.raise_for_status()
    return r.json()["expense"]["expense_id"]


def kalem(ad, fiyat, adet=1, kategori="sut_urunleri", birim="adet", genel=None):
    k = {"name": ad, "price": fiyat, "quantity": adet,
         "category": kategori, "unit": birim}
    # `generic`: fis okunurken her kaleme yazilan "bu urun aslinda NE" adi.
    # Tur 8'in isi; urun toplama bunun uzerine kuruluyor.
    if genel:
        k["generic"] = genel
    return k


print("\n-- harcamalar --")
# Ayni urun UC FARKLI market markasiyla: `product_key` ucunu de "milch"e
# indirmeli, yani tek satirda birlesmeli. Tur 8'in isi tam olarak bu.
harcama(total=10.0, merchant="LIDL", items=[
    kalem("MILBONA MILCH 1L", 4.0, genel="süt"),
    kalem("Spülmittel", 6.0, kategori="ev_urunleri", genel="bulaşık deterjanı")])
harcama(total=7.0, merchant="ALDI", items=[kalem("MILSANI MILCH 1L", 7.0, genel="süt")])
harcama(total=3.0, merchant="REWE", items=[kalem("JA! MILCH 1L", 3.0, genel="süt")])
# GENEL ADI OLMAYAN kayit (Tur 8 oncesi ya da OCR cikaramamis): yedek yol ham
# addan anahtar uretmeli, yoksa bu kalemler istatistikten tamamen dusrerdi.
harcama(total=5.0, merchant="LIDL", items=[
    kalem("BUTTER 250G", 5.0, kategori="sut_urunleri")])
check("harcamalar yazildi", True)

s = c.get(f"{API}/stats/monthly?month={AY}", headers=hdr(tok)).json()

print("\n-- 1. SON 6 AY serisi --")
seri = s.get("son_aylar") or []
# Ev BUGUN kuruldu ve yalnizca bu ayda verisi var: seri o tek ayi donmeli.
# Var olmayan aylari sifir diye cizmek "o ay hic harcamadin" demek olurdu,
# oysa o ay ortada yoktun. Ekran basligi da buna gore duzeliyor ("Son 3 Ay")
# ve tek ay kalirsa kart hic cizilmiyor -- bir cubugun karsilastiracagi
# bir sey yok.
check("yalnizca VERI OLAN aylar donuyor", len(seri) == 1, str(seri))
check("eskiden yeniye sirali",
      [x["month"] for x in seri] == sorted(x["month"] for x in seri), str(seri))
check("son eleman bu ay", seri and seri[-1]["month"] == AY, str(seri[-1:]))
# DEGISMEZLIK: cubuktaki ay ile o ayin kendi toplami ayni olmali.
bu = next(x for x in seri if x["month"] == AY)
check("cubuktaki toplam = ayin toplami",
      abs(bu["total"] - s["total"]) < 0.01, f"{bu['total']} vs {s['total']}")
check("her ay toplam tasiyor", all("total" in x for x in seri), str(seri))

# GECMISE tarihli fis girilince seri geriye aciliyor: alt sinir evin
# kurulusu degil ilk HARCAMA ayi. Ag~ustos'ta kurulan bir eve Temmuz fisi
# girilirse Temmuz da cizilmeli.
gecen = (date.today().replace(day=1) - __import__("datetime").timedelta(days=1))
harcama(total=20.0, merchant="EDEKA", expense_date=gecen.isoformat(),
        items=[kalem("Reis", 20.0, kategori="temel_gida", genel="pirinç")])
s2 = c.get(f"{API}/stats/monthly?month={AY}", headers=hdr(tok)).json()
check("geriye tarihli fis seriyi aciyor",
      len(s2["son_aylar"]) == 2, str(s2["son_aylar"]))
check("acilan ay gecen ay",
      s2["son_aylar"][0]["month"] == gecen.strftime("%Y-%m"), str(s2["son_aylar"]))
check("gecen ayin toplami dogru",
      abs(s2["son_aylar"][0]["total"] - 20.0) < 0.01, str(s2["son_aylar"]))

print("\n-- 2. URUN BAZLI toplam --")
urunler = s.get("products") or []
sut = [u for u in urunler if u["key"] == "sut"]
check("uc market markasi TEK satirda (genel ad)", len(sut) == 1,
      str([u["key"] for u in urunler]))
if sut:
    u = sut[0]
    check("toplam 14,00 (4+7+3)", abs(u["total"] - 14.0) < 0.01, str(u))
    check("uc markette gorundu", u["market_count"] == 3, str(u))
    check("uc kalem sayildi", u["count"] == 3, str(u))
    # Ekranda GENEL ad yaziyor, market markasi degil.
    check("ekranda genel ad", u["name"] == "Süt", str(u["name"]))
# Genel adi olmayan kalem yedek yolla kendi satirinda duruyor -- kaybolmuyor.
tere = [u for u in urunler if "butter" in u["key"]]
check("genel adi olmayan kalem yedek yolla geliyor", len(tere) == 1,
      str([u["key"] for u in urunler]))
check("urun sayisi ayrica donuyor", s.get("product_count", 0) >= 2, str(s.get("product_count")))
check("liste buyukten kucuge", [u["total"] for u in urunler]
      == sorted((u["total"] for u in urunler), reverse=True), str(urunler))

r = c.get(f"{API}/stats/products?month={AY}", headers=hdr(tok)).json()
check("tum urunler ucu ayni sayiyi veriyor",
      len(r["products"]) == s.get("product_count"), str(len(r["products"])))

# IKI SIRALAMA da sunucudan geliyor, biri kesilip istemcide yeniden
# siralanmiyor: ucuz ama sik alinan bir urun tutar siralamasinin ilk
# besinde hic olmayabilir ve istemcide siralamak onu KAYBEDERDI.
sik = s.get("products_frequent") or []
check("siklik listesi ayrica donuyor", len(sik) > 0, str(sik))
check("siklik listesi sayiya gore sirali",
      [u["count"] for u in sik] == sorted((u["count"] for u in sik), reverse=True),
      str([(u["key"], u["count"]) for u in sik]))
check("kart listeleri BESER satir", len(s["products"]) <= 5 and len(sik) <= 5,
      f"{len(s['products'])} / {len(sik)}")

print("\n-- 2b. GENEL AD kayda ULASIYOR mu --")
# Bu kontrol somut bir hatadan dogdu: OCR `generic` alanini uretiyordu ve
# sunucu istemciye gonderiyordu, ama fis inceleme ekrani onu kayda TASIMIYORDU
# (Row tipinde alan yoktu). Sonuc: gercek evde 206 kalemin HICBIRINDE genel ad
# yoktu ve marka birlestirme hic calismiyordu -- ozellik kuruldugu gunden beri
# sessizce oluydu. Sunucunun alani kabul edip sakladigini burada kilitliyoruz.
eid = harcama(total=2.5, merchant="PENNY", items=[
    kalem("GELBWURZEL 1KG", 2.5, kategori="meyve_sebze", genel="havuç")])
r = c.get(f"{API}/expenses?month={AY}", headers=hdr(tok)).json()["expenses"]
kayit = next(e for e in r if e["expense_id"] == eid)
check("genel ad kayda yazildi",
      (kayit["items"][0].get("generic") or "") == "havuç", str(kayit["items"][0]))
# Ve istatistige o adla giriyor -- fisteki "GELBWURZEL" degil.
s3 = c.get(f"{API}/stats/monthly?month={AY}", headers=hdr(tok)).json()
havuc = [u for u in s3["products"] if u["key"] == "havuc"]
check("istatistikte genel adla gorunuyor", len(havuc) == 1,
      str([u["key"] for u in s3["products"]]))
check("ekranda 'Havuç' yaziyor", havuc and havuc[0]["name"] == "Havuç",
      str(havuc[:1]))


print("\n-- 3. KATEGORI sayfasi --")
k = c.get(f"{API}/stats/category?key=sut_urunleri&month={AY}", headers=hdr(tok)).json()
# LIDL fisi 10 EUR ama yalnizca 4 EUR'su sut; kategori toplami 14 olmali (4+7+3),
# fisin tamamini sayarsa 20 cikar ve halkadaki dilimle celisir.
check("fisin YALNIZCA o kategorideki kismi sayildi",
      abs(k["total"] - 19.0) < 0.01, str(k["total"]))
# Seri KATEGORI sayfasinda da evin ilk harcamasindan oncesine inmiyor.
# Onceden her zaman 6 ay donuyordu ve yeni kurulan bir evde bes ay SIFIR
# cizilip ortalamayi asagi cekiyordu -- "o ay hic harcamadin" demek olur,
# oysa o ay ortada yoktun. Bu senaryoda veri iki ayda: gecen ay ve bu ay.
check("seri yalnizca VERI OLAN aylari kapsiyor",
      len(k.get("series") or []) == 2, str(k.get("series")))
check("serinin ilk ayi evin ilk harcama ayi",
      k["series"][0]["month"] == gecen.strftime("%Y-%m"), str(k["series"]))
check("serinin son ayi bu ayin toplamini tutuyor",
      abs(k["series"][-1]["total"] - k["total"]) < 0.01, str(k["series"][-1:]))
check("ne alindi: sut tek satir",
      len([p for p in k["products"] if p["key"] == "sut"]) == 1, str(k["products"]))
check("nereden: uc market", len(k["merchants"]) == 3, str(k["merchants"]))
check("market toplamlari kategoriye ait",
      abs(sum(m["total"] for m in k["merchants"]) - 19.0) < 0.01, str(k["merchants"]))

k2 = c.get(f"{API}/stats/category?key=ev_urunleri&month={AY}", headers=hdr(tok)).json()
check("diger kategori yalnizca kendi kismini sayiyor",
      abs(k2["total"] - 6.0) < 0.01, str(k2["total"]))
check("o kategoride tek market", len(k2["merchants"]) == 1, str(k2["merchants"]))

bos = c.get(f"{API}/stats/category?key=uydurma&month={AY}", headers=hdr(tok)).json()
check("bilinmeyen kategori bos donuyor", abs(bos["total"]) < 0.01, str(bos["total"]))

print("\n-- 3b. MARKET sayfasi --")
# Marketler listesi NORMALIZE anahtar tasimali: "BIZIM FLEISCHER GMBH" ile
# "BIZIM FLEISCHER" ayni market ve ham adla acilsaydi ikisi ayri sayfa olurdu.
sm = c.get(f"{API}/stats/monthly?month={AY}", headers=hdr(tok)).json()
lidl = [m for m in sm["merchants"] if "lidl" in m["key"]]
check("marketler anahtar tasiyor", len(lidl) == 1, str(sm["merchants"]))
check("gecen ay sutunu donuyor",
      all("prev_total" in m for m in sm["merchants"]), str(sm["merchants"][:2]))

mk = c.get(f"{API}/stats/merchant?name=lidl&month={AY}", headers=hdr(tok)).json()
# LIDL'de iki fis var: 10,00 (sut+deterjan) ve 5,00 (tereyagi) = 15,00
check("market toplami dogru", abs(mk["total"] - 15.0) < 0.01, str(mk["total"]))
check("fis sayisi dogru", mk["expense_count"] == 2, str(mk["expense_count"]))
# Ortalama fis: ayni markete 40 EUR birakmak ile dort kez 10 EUR birakmak
# toplamda ayni, aliskanlikta degil.
check("ortalama fis 7,50", abs(mk["avg_expense"] - 7.5) < 0.01, str(mk["avg_expense"]))
check("kategoriler donuyor", len(mk["categories"]) >= 2, str(mk["categories"]))
check("urunler donuyor", len(mk["products"]) >= 2, str([p["key"] for p in mk["products"]]))
check("fisler yeniden eskiye",
      [e["expense_date"] for e in mk["expenses"]]
      == sorted((e["expense_date"] for e in mk["expenses"]), reverse=True),
      str(mk["expenses"]))
check("fis satirlari kalem sayisi tasiyor",
      all("item_count" in e for e in mk["expenses"]), str(mk["expenses"][:1]))
check("seri evin ilk ayindan baslıyor", len(mk["series"]) == 2, str(mk["series"]))
# BASKA marketin fisi bu sayfaya SIZMAMALI.
toplam_kalem = sum(e["item_count"] for e in mk["expenses"])
check("baska market sizmadi", toplam_kalem == 3, str(mk["expenses"]))
bos_mk = c.get(f"{API}/stats/merchant?name=yokboyle&month={AY}", headers=hdr(tok)).json()
check("bilinmeyen market bos donuyor", bos_mk["expense_count"] == 0, str(bos_mk["total"]))


print("\n-- 4. ZAMLANANLAR / UCUZLAYANLAR --")
# Ayri bir ev: fiyat serileri temiz olsun.
r = c.post(f"{API}/auth/register", json={
    "email": f"zam_{TAG}@odahesap-e2e.com", "password": "sifre123", "name": "Zam Test"})
ztok = r.json()["session_token"]
c.post(f"{API}/households", headers=hdr(ztok), json={"name": f"Zam Ev {TAG}"})


def zharcama(tarih, market, kalemler, toplam):
    r = c.post(f"{API}/expenses", headers=hdr(ztok), json={
        "target_type": "household", "source": "receipt", "merchant": market,
        "expense_date": tarih, "total": toplam, "items": kalemler})
    r.raise_for_status()


gecen_ay = (date.today().replace(day=1) - __import__("datetime").timedelta(days=1))
GA = gecen_ay.strftime("%Y-%m")
g1 = f"{GA}-05"
g2 = f"{GA}-20"
b1 = date.today().replace(day=1).isoformat()

# KAHVE: gecen ay 8,00 -> bu ay 10,00 (%25 zam), paketli (500 g)
zharcama(g1, "LIDL", [kalem("KAFFEE 500G", 8.00, genel="kahve", kategori="temel_gida")], 8.00)
zharcama(b1, "LIDL", [kalem("KAFFEE 500G", 10.00, genel="kahve", kategori="temel_gida")], 10.00)
# TEREYAGI: 3,00 -> 2,40 (%20 ucuzlama)
zharcama(g1, "LIDL", [kalem("BUTTER 250G", 3.00, genel="tereyağı")], 3.00)
zharcama(b1, "LIDL", [kalem("BUTTER 250G", 2.40, genel="tereyağı")], 2.40)
# MAKARNA: 1,00 -> 1,04 (%4, ESIGIN ALTINDA) -- gorunmemeli
zharcama(g1, "LIDL", [kalem("PASTA 500G", 1.00, genel="makarna", kategori="temel_gida")], 1.00)
zharcama(b1, "LIDL", [kalem("PASTA 500G", 1.04, genel="makarna", kategori="temel_gida")], 1.04)
# SEKER: gecen ay IKI kez alindi, biri kampanyali (1,00 ve 2,00; medyan 1,50),
# bu ay 1,50. ORTALAMA olsaydi degisim %0 cikardi ama medyan da %0 -- burada
# asil test: tek kampanya listeyi kirletmiyor.
zharcama(g1, "LIDL", [kalem("ZUCKER 1KG", 1.00, genel="şeker", kategori="temel_gida")], 1.00)
zharcama(g2, "LIDL", [kalem("ZUCKER 1KG", 2.00, genel="şeker", kategori="temel_gida")], 2.00)
zharcama(b1, "LIDL", [kalem("ZUCKER 1KG", 1.50, genel="şeker", kategori="temel_gida")], 1.50)
# CAY: yalnizca BU ay alindi -- iki ayda da olmadigi icin listede olmamali.
zharcama(b1, "LIDL", [kalem("TEE 250G", 4.00, genel="çay", kategori="icecek")], 4.00)
# SUT: ayni urun BASKA markette. Marketler arasi karsilastirma YAPILMAMALI.
zharcama(g1, "ALDI", [kalem("MILCH 1L", 1.00, genel="süt")], 1.00)
zharcama(b1, "REWE", [kalem("MILCH 1L", 2.00, genel="süt")], 2.00)
# KARPUZ: boyutu bilinmeyen ADET urunu. 6,00 -> 10,60 (%77) ama bu bir zam
# DEGIL, iki farkli boy karpuz. Gercek evde tam bu satir cikti ve karti
# gondermeden once yakalandi: `adet` sinifinda fiyat farki URUN farki
# olabiliyor, o yuzden bu sinif karsilastirmaya HIC girmiyor.
zharcama(g1, "LIDL", [kalem("Wassermelone", 6.00, genel="karpuz",
                            kategori="meyve_sebze")], 6.00)
zharcama(b1, "LIDL", [kalem("Wassermel. XXL", 10.60, genel="karpuz",
                            kategori="meyve_sebze")], 10.60)
# ZEYTINYAGI: ACIK (kasada tartilan, kg). Bu sinif karsilastirilabilir.
zharcama(g1, "LIDL", [kalem("Oliven lose", 10.00, genel="zeytin",
                            kategori="meyve_sebze", birim="kg")], 10.00)
zharcama(b1, "LIDL", [kalem("Oliven lose", 13.00, genel="zeytin",
                            kategori="meyve_sebze", birim="kg")], 13.00)

AY_S = date.today().strftime("%Y-%m")
z = c.get(f"{API}/stats/prices?month={AY_S}", headers=hdr(ztok)).json()
up = {x["key"]: x for x in z["up"]}
down = {x["key"]: x for x in z["down"]}

check("kahve zamlandi (%25)", "kahve" in up and up["kahve"]["change_pct"] == 25, str(z["up"]))
check("zamda onceki ve simdiki fiyat var",
      "kahve" in up and up["kahve"]["prev"] == 16.0 and up["kahve"]["now"] == 20.0,
      str(up.get("kahve")))
# ANAHTARLAR KATLANMIS geliyor: `product_key` Turkce harfleri sadelestiriyor
# ("tereyagi", "seker", "cay", "sut"). Olumsuz kontroller katlanmis anahtarla
# yazilmali, yoksa yanlis anahtar yuzunden BOSUNA gecerler.
check("tereyagi ucuzladi (-%20)",
      "tereyagi" in down and down["tereyagi"]["change_pct"] == -20, str(z["down"]))
check("esigin ALTINDAKI oynama listede yok (%4)",
      "makarna" not in up and "makarna" not in down, str(z))
check("tek kampanya listeyi kirletmedi (medyan)",
      "seker" not in up and "seker" not in down, str(z))
check("tek ayda gorulen urun listede yok",
      "cay" not in up and "cay" not in down, str(z))
check("MARKETLER ARASI karsilastirma yapilmiyor",
      "sut" not in up and "sut" not in down, str(z))
# Listede TOPLAM kac satir var: yukaridaki dortu elenince yalnizca kahve ve
# tereyagi kalmali. Bu, olumsuz kontrollerin gercekten calistigini kanitliyor.
check("BOYUTU BILINMEYEN adet urunu karsilastirilmiyor",
      "karpuz" not in up and "karpuz" not in down, str(z))
check("ACIK (tartilan) urun karsilastiriliyor",
      "zeytin" in up and up["zeytin"]["change_pct"] == 30, str(z["up"]))
# Yukaridakiler elenince geriye yalnizca kahve, zeytin (zam) ve tereyagi
# (ucuzlama) kalmali. Bu, olumsuz kontrollerin gercekten calistigini
# kanitliyor -- yanlis anahtar yuzunden bosuna gecmiyorlar.
check("listede yalnizca uc hareket var",
      len(z["up"]) == 2 and len(z["down"]) == 1, str(z))
check("esik yaniti donuyor", z.get("threshold") == 8, str(z.get("threshold")))
check("zamlar buyukten kucuge",
      [x["change_pct"] for x in z["up"]] == sorted((x["change_pct"] for x in z["up"]), reverse=True),
      str(z["up"]))

c.post(f"{API}/households/leave", headers=hdr(ztok))
c.post(f"{API}/auth/logout", headers=hdr(ztok))


print("\n-- temizlik --")
c.post(f"{API}/households/leave", headers=hdr(tok))
c.post(f"{API}/auth/logout", headers=hdr(tok))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
