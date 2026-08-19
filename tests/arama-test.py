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
print("== temizlik ==")
for t in (alice, bob, carol):
    c.post(f"{API}/households/leave", headers=hdr(t))
    c.post(f"{API}/auth/logout", headers=hdr(t))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
