"""Arama — urun, market ve kisi; BUTUN gecmiste.

Aramanin varlik sebebi ayi asmasi: her ekran takvim ayina kilitli ve
"sutu en son ne zaman aldik" sorusunun bugun cevabi yok. Bu takim iki seyi
koruyor: (1) Turkce karakter yazmak zorunda kalmamak, (2) sonuclarin
Analiz sayfasiyla ayni sayilari vermesi.
"""
import sys
import uuid

import httpx

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8099").rstrip("/")
API = f"{BASE}/api"
TAG = uuid.uuid4().hex[:8]

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


def reg(who):
    r = c.post(f"{API}/auth/register", json={
        "email": f"ara_{who}_{TAG}@odahesap-e2e.com",
        "password": "sifre123", "name": who.title()})
    r.raise_for_status()
    return r.json()["session_token"], r.json()["user"]["user_id"]


alice, alice_id = reg("alice")
bob, bob_id = reg("bob")
r = c.post(f"{API}/households", headers=hdr(alice), json={"name": f"Ara Ev {TAG}"})
kod = r.json()["household"]["invite_code"]
c.post(f"{API}/households/join", headers=hdr(bob), json={"invite_code": kod})
c.post(f"{API}/households/approve", headers=hdr(alice), json={"user_id": bob_id})


def fis(token, market, tarih, kalemler, toplam):
    r = c.post(f"{API}/expenses", headers=hdr(token), json={
        "target_type": "household", "total": toplam, "source": "receipt",
        "merchant": market, "expense_date": tarih, "items": kalemler})
    r.raise_for_status()
    return r.json()["expense"]["expense_id"]


def kalem(ad, fiyat, genel=None, adet=1, birim="adet"):
    k = {"name": ad, "price": fiyat, "quantity": adet, "unit": birim,
         "category": "market"}
    if genel:
        k["generic"] = genel
    return k


# Uc marketin kendi markasi -- genel ad ucunu "sut"te birlestiriyor.
fis(alice, "KAUFLAND", "2026-03-04",
    [kalem("MILBONA VOLLMILCH 3,5%", 1.09, "süt", 2, "lt"),
     kalem("SUTLU CIKOLATA 100G", 1.49, "sütlü çikolata")], 3.67)
fis(alice, "REWE", "2026-06-12",
    [kalem("JA! MILCH", 0.99, "süt", 3, "lt"),
     kalem("KUSKONMAZ", 3.20, "kuşkonmaz", 1, "kg")], 6.17)
fis(bob, "Kaufland GmbH", "2026-08-02",
    [kalem("MILSANI H-MILCH", 1.19, "süt", 1, "lt")], 1.19)

print("== Turkce karakter yazmak ZORUNDA degilsin ==")
r = c.get(f"{API}/search", headers=hdr(alice), params={"q": "sut"}).json()
adlar = [p["name"] for p in r["products"]]
check("'sut' -> Sut bulundu", any(a.lower().startswith("süt") for a in adlar), str(adlar))
r2 = c.get(f"{API}/search", headers=hdr(alice), params={"q": "süt"}).json()
check("'süt' ile ayni sonuc", [p["key"] for p in r2["products"]] == [p["key"] for p in r["products"]],
      str([p["key"] for p in r2["products"]]))
r3 = c.get(f"{API}/search", headers=hdr(alice), params={"q": "SUT"}).json()
check("buyuk harf de ayni", [p["key"] for p in r3["products"]] == [p["key"] for p in r["products"]])

print()
print("== bastan eslesme ONCE ==")
# "sut" hem "süt" (bastan) hem "sütlü çikolata" (bastan) hem de baska bir
# kelimede gecebilir; bastan eslesenler once gelmeli.
check("ilk sonuc Sut", r["products"][0]["name"].lower() == "süt", str(adlar))

print()
print("== uc market markasi TEK satirda ==")
sut = next(p for p in r["products"] if p["name"].lower() == "süt")
check("uc fisin sutu tek satir", sut["count"] == 3, str(sut))
# "KAUFLAND" ile "Kaufland GmbH" AYNI markete iniyor (normalize_merchant),
# yani ayri market sayisi iki. Test once uc bekliyordu ve yanilan testti --
# birlestirme dogru calisiyor, asagidaki market kontrolu de onu dogruluyor.
check("iki AYRI markette gorundu", sut["market_count"] == 2, str(sut))
check("miktar toplandi (6 lt)", abs((sut.get("qty") or 0) - 6) < 0.01, str(sut))
check("birim lt", sut.get("unit") == "lt", str(sut))

print()
print("== sonuc AYI ASIYOR ==")
check("ilk ay Mart", sut["first_month"] == "2026-03", str(sut))
check("son ay Agustos", sut["last_month"] == "2026-08", str(sut))

print()
print("== market aramasi ==")
r = c.get(f"{API}/search", headers=hdr(alice), params={"q": "kaufland"}).json()
check("market bulundu", len(r["merchants"]) >= 1, str(r["merchants"]))
kf = r["merchants"][0]
# "KAUFLAND" ile "Kaufland GmbH" ayni anahtara dusuyor (normalize_merchant).
check("iki yazim tek market", kf["receipts"] == 2, str(kf))
check("marketin ay araligi", (kf["first_month"], kf["last_month"]) == ("2026-03", "2026-08"), str(kf))
check("toplam iki fisin toplami", abs(kf["total"] - (3.67 + 1.19)) < 0.01, str(kf))

print()
print("== kisi aramasi ==")
r = c.get(f"{API}/search", headers=hdr(alice), params={"q": "bob"}).json()
check("Bob bulundu", any(m["user_id"] == bob_id for m in r["members"]), str(r["members"]))

print()
print("== tek harf ARAMA YAPMIYOR ==")
r = c.get(f"{API}/search", headers=hdr(alice), params={"q": "s"}).json()
check("tek harfte urun yok", r["products"] == [], str(r["products"]))
check("tek harfte market yok", r["merchants"] == [], str(r["merchants"]))
r = c.get(f"{API}/search", headers=hdr(alice), params={"q": ""}).json()
check("bos sorguda sonuc yok", r["products"] == [] and r["merchants"] == [])

print()
print("== eslesmeyen sorgu bos doner, patlamaz ==")
r = c.get(f"{API}/search", headers=hdr(alice), params={"q": "zzzyok"}).json()
check("bos liste", r["products"] == [] and r["merchants"] == [] and r["members"] == [])

print()
print("== KISISEL harcama baskasinin aramasinda YOK ==")
c.post(f"{API}/expenses", headers=hdr(bob), json={
    "target_type": "self", "total": 9.90, "source": "receipt", "merchant": "GIZLIMARKET",
    "items": [kalem("MANTAR 250G", 9.90, "mantar")]})
r = c.get(f"{API}/search", headers=hdr(alice), params={"q": "mantar"}).json()
check("Alice mantari goremiyor", r["products"] == [], str(r["products"]))
r = c.get(f"{API}/search", headers=hdr(alice), params={"q": "gizlimarket"}).json()
check("Alice gizli marketi goremiyor", r["merchants"] == [], str(r["merchants"]))
r = c.get(f"{API}/search", headers=hdr(bob), params={"q": "mantar"}).json()
check("Bob kendi mantarini goruyor", len(r["products"]) == 1, str(r["products"]))

print()
print("== SIK MARKETLER: elle giris cipleri evin kendi gecmisinden ==")
# Ciplerde on bir Alman zinciri sabit yaziliydi; bu uc, listeyi evin GERCEK
# kayitlarindan uretiyor. Iki sey kanitlanmali: (1) sayim FIS sayisi,
# (2) gorunmeyen harcamanin marketi de gorunmuyor.
r = c.get(f"{API}/merchants/frequent", headers=hdr(alice)).json()
ml = r["merchants"]
check("liste bos degil", len(ml) >= 2, str(ml))
check("en sik market ilk sirada", ml[0]["count"] >= ml[-1]["count"], str(ml))
kaufland = next((m for m in ml if "kaufland" in m["key"]), None)
check("KAUFLAND ile 'Kaufland GmbH' tek satir", kaufland is not None, str(ml))
check("sayim FIS sayisi (2)", kaufland and kaufland["count"] == 2, str(kaufland))
check("REWE de listede", any("rewe" in m["key"] for m in ml), str(ml))
# Ayni market iki yazimla girilmis olabilir (gercek veride var: "Bizim
# Fleischer" / "Bizim Fleischer GmbH"). Gosterilen ad EN COK kullanilan yazim
# olmali -- Mongo'nun donus sirasi degil. Birim testi: `resolve_merchant`
# cogu yazimi girişte birlestirdigi icin ucundan uca kurmak guvenilmez.
import os as _os  # noqa: E402
sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "backend"))
try:
    import server as _srv  # noqa: PLC0415
except Exception as _e:  # noqa: BLE001
    check("server modulu yuklendi (yazim)", False, str(_e))
else:
    yy = _srv._yaygin_yazim
    check("en cok kullanilan yazim kazaniyor",
          yy({"Bizim Fleischer": 1, "Bizim Fleischer GmbH": 2}) == "Bizim Fleischer GmbH")
    check("esitlikte KISA olan kazaniyor",
          yy({"Bizim Fleischer": 2, "Bizim Fleischer GmbH": 2}) == "Bizim Fleischer")
    check("tek yazim varsa o", yy({"ALDI": 7}) == "ALDI")
check("Bob'un KISISEL marketi Alice'te YOK",
      not any("gizli" in m["key"] for m in ml), str(ml))

r = c.get(f"{API}/merchants/frequent", headers=hdr(bob)).json()
check("Bob kendi kisisel marketini goruyor",
      any("gizli" in m["key"] for m in r["merchants"]), str(r["merchants"]))

r = c.get(f"{API}/merchants/frequent", headers=hdr(alice), params={"limit": 1}).json()
check("limit uygulaniyor", len(r["merchants"]) == 1, str(r["merchants"]))

print()
print("== evsiz kullanici ==")
carol, _ = reg("carol")
r = c.get(f"{API}/search", headers=hdr(carol), params={"q": "sut"}).json()
check("evi olmayan bos aliyor", r["products"] == [] and r["merchants"] == [])

print()
print("== Analiz sayfasiyla AYNI sayilar ==")
# Arama, /stats/products ile ayni fonksiyonu (`_urunler`) kullaniyor; Agustos
# ayinda sutun tutari iki yerde de ayni olmali.
st = c.get(f"{API}/stats/products", headers=hdr(alice), params={"month": "2026-08"}).json()
ag_sut = next((p for p in st["products"] if p["name"].lower() == "süt"), None)
check("stats/products sutu veriyor", ag_sut is not None, str(st["products"]))
if ag_sut:
    check("Agustos tutari 1,19", abs(ag_sut["total"] - 1.19) < 0.01, str(ag_sut))

print()
print("== URUN SAYFASI: butun gecmis tek yerde ==")
d = c.get(f"{API}/stats/product", headers=hdr(alice), params={"key": sut["key"]}).json()
check("ad Sut", (d.get("name") or "").lower() == "süt", str(d.get("name")))
check("toplam arama ile ayni", abs(d["total"] - sut["total"]) < 0.01,
      f'{d["total"]} vs {sut["total"]}')
check("alis sayisi ayni", d["count"] == sut["count"], str(d["count"]))
check("miktar 6 lt", abs((d.get("qty") or 0) - 6) < 0.01, str(d.get("qty")))

# Mart, Nisan, Mayis, Haziran, Temmuz, Agustos = 6 ay. ARADAKI BOS AYLAR DA
# geliyor: "Nisan'da hic almadik" bir bilgi ve cubuk grafigi ancak boyle
# dogru okunuyor.
aylar = d["months"]
check("alti ay geliyor", len(aylar) == 6, str([a["month"] for a in aylar]))
check("ilk ay Mart", aylar[0]["month"] == "2026-03", str(aylar[0]))
check("son ay Agustos", aylar[-1]["month"] == "2026-08", str(aylar[-1]))
nisan = next(a for a in aylar if a["month"] == "2026-04")
check("bos ay sifir olarak var", nisan["total"] == 0 and nisan["count"] == 0, str(nisan))
check("aylarin toplami urunun toplami",
      abs(sum(a["total"] for a in aylar) - d["total"]) < 0.02,
      str(sum(a["total"] for a in aylar)))

check("iki market", len(d["merchants"]) == 2, str(d["merchants"]))
check("marketler tutara gore sirali",
      d["merchants"][0]["total"] >= d["merchants"][1]["total"], str(d["merchants"]))
check("market toplamlari urunun toplami",
      abs(sum(m["total"] for m in d["merchants"]) - d["total"]) < 0.02, str(d["merchants"]))
# Sut litre cinsinden alindi; birim fiyat medyan olarak geliyor.
check("litre fiyati geliyor", d.get("price_unit") == "lt" and d.get("unit_price"),
      str((d.get("unit_price"), d.get("price_unit"))))

print()
print("== bilinmeyen urun BOS doner ==")
d = c.get(f"{API}/stats/product", headers=hdr(alice), params={"key": "boyle-bir-urun-yok"}).json()
check("bos ama patlamiyor", d["months"] == [] and d["name"] is None, str(d))

print()
print("== baskasinin kisisel urunu acilamiyor ==")
d = c.get(f"{API}/stats/product", headers=hdr(alice), params={"key": "mantar"}).json()
check("Alice mantar sayfasini goremiyor", d["months"] == [], str(d))

print()
print()
print("== ONERI KATEGORIYI tasiyor; `diger` OY KULLANMIYOR ==")
# AYRI BIR EV: yukaridaki sayimlari bozmasin.
#
# Kritik nokta: `diger` bir kategori DEGIL, kategorinin yoklugu -- OCR ne
# oldugunu anlayamadiginda oraya dusuyor. Bilinmeyenin bilineni oy coklugu
# ile ezmesine izin verilirse urun tumden bilgisiz gorunuyor. Gercek veride
# olculdu: "Yuzey temizlik mendili"nin iki kalemi `diger`, biri
# `ev_urunleri` idi ve sonuc `diger` cikiyordu.
kat_tok, _ = reg("kategori")
r = c.post(f"{API}/households", headers=hdr(kat_tok), json={"name": f"Kat Ev {TAG}"})
r.raise_for_status()
c.post(f"{API}/expenses", headers=hdr(kat_tok), json={
    "target_type": "household", "total": 6.0, "source": "receipt",
    "merchant": "ROSSMANN", "expense_date": "2026-08-05",
    "items": [
        {"name": "SLEPPY EASY CLEAN", "price": 2.0, "quantity": 1,
         "generic": "yüzey temizlik mendili", "category": "diger"},
        {"name": "SLEPPY REFILL", "price": 2.0, "quantity": 1,
         "generic": "yüzey temizlik mendili", "category": "diger"},
        {"name": "Slipy", "price": 2.0, "quantity": 1,
         "generic": "yüzey temizlik mendili", "category": "ev_urunleri"},
    ]})
r = c.get(f"{API}/search", headers=hdr(kat_tok), params={"q": "sleppy"}).json()
check("marka ile bulundu", len(r["products"]) == 1, str(r["products"]))
if r["products"]:
    p0 = r["products"][0]
    check("kategori alani geliyor", "category" in p0, str(p0))
    check("iki `diger`e karsi tek bilinen oy kazandi",
          p0.get("category") == "ev_urunleri",
          f'{p0.get("category")} olmali ev_urunleri')

# Hicbir bilinen kategori yoksa `diger` kaliyor -- uydurma yok.
c.post(f"{API}/expenses", headers=hdr(kat_tok), json={
    "target_type": "household", "total": 3.0, "source": "receipt",
    "merchant": "ROSSMANN", "expense_date": "2026-08-06",
    "items": [{"name": "BILINMEYEN SEY", "price": 3.0, "quantity": 1,
               "generic": "bilinmeyen", "category": "diger"}]})
r = c.get(f"{API}/search", headers=hdr(kat_tok), params={"q": "bilinmeyen"}).json()
check("hepsi diger ise diger kaliyor",
      r["products"] and r["products"][0].get("category") == "diger",
      str(r["products"]))
c.post(f"{API}/households/leave", headers=hdr(kat_tok))
c.post(f"{API}/auth/logout", headers=hdr(kat_tok))

print("== bulanik eslesme: bir harf tolerans ==")
# Kural yalnizca ARAMADA gecerli ve en son sirada. Once saf birim testi:
# eslesme fonksiyonu, sunucu ayakta olmadan da dogru davranmali.
import os  # noqa: E402
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
try:
    import server  # noqa: PLC0415
except Exception as e:  # noqa: BLE001
    check("server modulu yuklendi", False, str(e))
else:
    bhf = server._bir_harf_farki
    check("harf DEGISMIS", bhf("domates", "domanes"))
    check("harf EKSIK", bhf("domates", "domtes"))
    check("harf FAZLA", bhf("domates", "domaates"))
    check("iki harf farki reddedildi", not bhf("domates", "domnes"))
    check("ilk harf tutmuyorsa reddedildi", not bhf("muzlu", "tuzlu"))
    check("yer degistirme bir harf sayilmiyor", not bhf("sucuk", "sucku"))
    check("ayni kelime bulanik degil", not bhf("domates", "domates"))
    check("bos kelime reddedildi", not bhf("", "domates"))

    sr = server._eslesme_sirasi
    check("bastan eslesme hala 0", sr("domates 1 kg", "domates") == 0)
    check("kelime basi hala 1", sr("kirmizi domates", "domates") == 1)
    check("icinde gecme hala 2", sr("domatesli makarna", "omatesl") == 2)
    check("bulanik en son sirada (5)", sr("domates", "domtes") == 5)
    check("kelime icinde bulanik da 5", sr("kirmizi domates", "domtes") == 5)
    check(f"{server.BULANIK_ASGARI} harflik sorguda bulanik ACIK",
          sr("sucuk", "sutuk") == 5)
    check("3 harflik sorguda bulanik KAPALI",
          sr("tuz", "tur") is None, "kisa sorgular affedilmemeli")
    check("4 harflik sorguda bulanik KAPALI",
          sr("elma", "elna") is None, "kisa sorgular affedilmemeli")
    check("bulanik olmayan alakasiz kelime hala None", sr("domates", "salatal") is None)

# Ucundan uca: gercek veriyle, yanlis yazilan sorgu urunu buluyor mu ve
# TAM eslesen hala once mi geliyor?
bul_tok, bul_id = reg("bulanik")
c.post(f"{API}/households", headers=hdr(bul_tok), json={"name": f"Bul Ev {TAG}"})
fis(bul_tok, "REWE", "2026-08-10",
    [{"name": "TOMATEN RISPE", "price": 2.5, "quantity": 1, "generic": "domates"},
     {"name": "DOMATES SALCASI", "price": 1.8, "quantity": 1, "generic": "salca"}], 4.3)

r = c.get(f"{API}/search", headers=hdr(bul_tok), params={"q": "domtes"}).json()
adlar = [p["name"].casefold() for p in r["products"]]
check("yanlis yazilan sorgu urunu buluyor", "domates" in adlar, str(adlar))

r = c.get(f"{API}/search", headers=hdr(bul_tok), params={"q": "domates"}).json()
check("tam eslesme bulanigin ustunde",
      r["products"] and r["products"][0]["name"].casefold() == "domates",
      str(r["products"]))
check("tam eslesmenin sirasi bulanik degil",
      r["products"][0]["sira"] < 5, str(r["products"][0].get("sira")))

r = c.get(f"{API}/search", headers=hdr(bul_tok), params={"q": "zztop"}).json()
check("alakasiz sorgu hala bos donuyor", not r["products"], str(r["products"]))
c.post(f"{API}/households/leave", headers=hdr(bul_tok))
c.post(f"{API}/auth/logout", headers=hdr(bul_tok))

print("== temizlik ==")
for t in (alice, bob, carol):
    c.post(f"{API}/households/leave", headers=hdr(t))
    c.post(f"{API}/auth/logout", headers=hdr(t))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
