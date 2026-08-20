"""Anasayfa'daki tek cumle -- `/stats/highlight`.

Iki sey korunuyor:

1. BOS KALABILIR. Kayda deger bir sey yoksa `null` donuyor. Dolgu metni
   yazilsaydi kullanici bir hafta icinde satirin bazen bilgi tasidigini
   bazen sadece orada durdugunu ogrenir ve bir daha hic okumazdi.
2. ONCELIK: para > fiyat > urun > degisim. Ayni gun birden cok aday varsa
   borc kazanir cunku borc bir EYLEM ister, otekiler bilgi verir.
"""
import sys
import uuid
from datetime import date, timedelta

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
bugun = date.today()
bu_ay = bugun.strftime("%Y-%m")
gecen = (bugun.replace(day=1) - timedelta(days=1))
gecen_ay = gecen.strftime("%Y-%m")


def yeni_ev(etiket):
    r = c.post(f"{API}/auth/register", json={
        "email": f"oc_{etiket}_{TAG}@odahesap-e2e.com",
        "password": "sifre123", "name": etiket.title()})
    r.raise_for_status()
    tok = r.json()["session_token"]
    c.post(f"{API}/households", headers=hdr(tok), json={"name": f"OC {etiket} {TAG}"})
    return tok


def fis(tok, tarih, market, kalemler, toplam):
    r = c.post(f"{API}/expenses", headers=hdr(tok), json={
        "target_type": "household", "total": toplam, "source": "receipt",
        "merchant": market, "expense_date": tarih, "items": kalemler})
    r.raise_for_status()


def one(tok):
    return c.get(f"{API}/stats/highlight", headers=hdr(tok)).json().get("highlight")


print("== veri yokken BOS ==")
bos = yeni_ev("bos")
check("hicbir sey yokken null", one(bos) is None, str(one(bos)))

print()
print("== kucuk degisim cumle URETMIYOR ==")
# Esik: fark hem 20 EUR'yu hem gecen ayin %10'unu asmali.
kucuk = yeni_ev("kucuk")
fis(kucuk, f"{gecen_ay}-05", "ALDI",
    [{"name": "EKMEK", "price": 100.0, "quantity": 1, "category": "firin"}], 100.0)
fis(kucuk, f"{bu_ay}-05", "ALDI",
    [{"name": "EKMEK", "price": 105.0, "quantity": 1, "category": "firin"}], 105.0)
h = one(kucuk)
check("5 EUR fark cumle uretmiyor", h is None, str(h))

print()
print("== buyuk degisim: kategoriyi soyluyor ==")
deg = yeni_ev("degisim")
fis(deg, f"{gecen_ay}-05", "ALDI",
    [{"name": "EKMEK", "price": 100.0, "quantity": 1, "category": "firin"}], 100.0)
fis(deg, f"{bu_ay}-05", "ALDI",
    [{"name": "EKMEK", "price": 100.0, "quantity": 1, "category": "firin"},
     {"name": "DANA KUSBASI", "price": 200.0, "quantity": 1, "category": "et_balik"}], 300.0)
h = one(deg)
check("tur degisim", h and h["kind"] == "degisim", str(h))
check("fark 200", h and abs(h["diff"] - 200.0) < 0.01, str(h))
check("sebep et_balik", h and h["category"] == "et_balik", str(h))
check("kategori farki 200", h and abs(h["cat_diff"] - 200.0) < 0.01, str(h))

print()
print("== azalis da soyleniyor ==")
az = yeni_ev("azalis")
fis(az, f"{gecen_ay}-05", "ALDI",
    [{"name": "DANA KUSBASI", "price": 300.0, "quantity": 1, "category": "et_balik"}], 300.0)
fis(az, f"{bu_ay}-05", "ALDI",
    [{"name": "EKMEK", "price": 50.0, "quantity": 1, "category": "firin"}], 50.0)
h = one(az)
check("azalis da cumle uretiyor", h and h["kind"] == "degisim", str(h))
check("fark negatif", h and h["diff"] < 0, str(h))

print()
print("== FIYAT degisimden ONCE gelir ==")
# Ayni market, ayni paketli urun, iki ay: %30 zam. Ayni anda toplam da
# degisiyor, yani iki aday birden var; fiyat kazanmali.
fy = yeni_ev("fiyat")
fis(fy, f"{gecen_ay}-05", "REWE",
    [{"name": "KAHVE 500G", "price": 5.0, "quantity": 1, "unit": "paket",
      "category": "temel_gida"}], 5.0)
fis(fy, f"{bu_ay}-05", "REWE",
    [{"name": "KAHVE 500G", "price": 6.5, "quantity": 1, "unit": "paket",
      "category": "temel_gida"},
     {"name": "DANA KUSBASI", "price": 200.0, "quantity": 1, "category": "et_balik"}], 206.5)
h = one(fy)
check("tur zam", h and h["kind"] == "zam", str(h))
check("urun adi kahve", h and "kahve" in (h.get("name") or "").lower(), str(h))
check("yuzde ~30", h and 25 <= h.get("pct", 0) <= 35, str(h))

print()
print("== ODESME her seyin ONUNDE ==")
# Iki kisilik ev: Alice buyuk bir ev harcamasi yapiyor, Bob borclu kaliyor.
# Donem 14 gunden yeni oldugu icin bu ev icin cumle ODESME OLMAYACAK --
# esigin sureye bagli oldugunu da bu dogruluyor.
r = c.post(f"{API}/auth/register", json={
    "email": f"oc_alice_{TAG}@odahesap-e2e.com", "password": "sifre123", "name": "Alice"})
alice = r.json()["session_token"]
r = c.post(f"{API}/auth/register", json={
    "email": f"oc_bob_{TAG}@odahesap-e2e.com", "password": "sifre123", "name": "Bob"})
bob, bob_id = r.json()["session_token"], r.json()["user"]["user_id"]
r = c.post(f"{API}/households", headers=hdr(alice), json={"name": f"OC borc {TAG}"})
kod = r.json()["household"]["invite_code"]
c.post(f"{API}/households/join", headers=hdr(bob), json={"invite_code": kod})
c.post(f"{API}/households/approve", headers=hdr(alice), json={"user_id": bob_id})
fis(alice, f"{bu_ay}-05", "ALDI",
    [{"name": "DANA KUSBASI", "price": 400.0, "quantity": 1, "category": "et_balik"}], 400.0)
h = one(bob)
check("yeni donemde borc cumlesi CIKMIYOR",
      h is None or h["kind"] != "odesme",
      f"esik sureye bagli olmali: {h}")

print()
print("== temizlik ==")
for t in (bos, kucuk, deg, az, fy, alice, bob):
    c.post(f"{API}/households/leave", headers=hdr(t))
    c.post(f"{API}/auth/logout", headers=hdr(t))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
