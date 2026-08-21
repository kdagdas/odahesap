"""Sepet kodu ve bag tablosu.

Iki sey korunuyor:
  1. `price_points` KIMLIKSIZ kaliyor -- sepet kodu disinda hicbir bag yok.
     Satilabilir olan taraf yapisi geregi temiz kalmali.
  2. Bag AYRI tabloda ve silinebilir. "Verilerimi sil" talebi tek satirlik bir
     is olmali; fiyat kaydinin kendisi silinirse her talep tarihsel veride bir
     delik acar ve yuz kullanici ayrildiginda istatistik coker.
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
        ok += 1; print(f"  [OK]   {label}")
    else:
        fail += 1; print(f"  [FAIL] {label}  {detail}")


import os  # noqa: E402
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
os.environ.setdefault("DB_NAME", "odahesap_test")
from dotenv import load_dotenv  # noqa: E402
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend", ".env"))
from pymongo import MongoClient  # noqa: E402

db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
if os.environ["DB_NAME"] != "odahesap_test":
    print("DURDURULDU: uretim veritabani.")
    sys.exit(1)

c = httpx.Client(timeout=60.0)
r = c.post(f"{API}/auth/register", json={
    "email": f"spt_{TAG}@odahesap-e2e.com", "password": "sifre123", "name": "Sepet"})
tok = r.json()["session_token"]
uid = r.json()["user"]["user_id"]
h = {"Authorization": f"Bearer {tok}"}
hh = c.post(f"{API}/households", headers=h,
            json={"name": f"Sepet Ev {TAG}", "country": "TR"}).json()["household"]["household_id"]

print("== ayni fisin kalemleri AYNI sepette ==")
r = c.post(f"{API}/expenses", headers=h, json={
    "target_type": "household", "total": 4.5, "source": "receipt", "merchant": "BIM",
    "expense_date": "2026-08-20",
    "items": [{"name": "DOMATES", "price": 2.0, "quantity": 1, "unit": "kg", "generic": "domates"},
              {"name": "SALATALIK", "price": 2.5, "quantity": 1, "unit": "kg", "generic": "salatalık"}]})
exp_id = r.json()["expense"]["expense_id"]

pp = list(db.price_points.find({"merchant_key": "bim"}, {"_id": 0}))
bizim = [p for p in pp if p.get("sepet_id")]
check("fiyat kayitlari yazildi", len(bizim) >= 2, str(len(bizim)))
sepetler = {p["sepet_id"] for p in bizim[-2:]}
check("iki kalem TEK sepette", len(sepetler) == 1, str(sepetler))
sepet = sepetler.pop()

print()
print("== price_points KIMLIKSIZ kaliyor ==")
kayit = next(p for p in bizim if p["sepet_id"] == sepet)
for alan in ("household_id", "user_id", "expense_id"):
    check(f"{alan} fiyat kaydinda YOK", alan not in kayit, str(sorted(kayit.keys())))

print()
print("== bag AYRI tabloda ==")
bag = db.sepet_kaynak.find_one({"sepet_id": sepet}, {"_id": 0})
check("bag kaydi var", bag is not None, "yok")
check("hane dogru", bag and bag.get("household_id") == hh, str(bag))
check("kullanici dogru", bag and bag.get("user_id") == uid, str(bag))
check("harcama dogru", bag and bag.get("expense_id") == exp_id, str(bag))

print()
print("== SILME: bag gidiyor, istatistik KALIYOR ==")
# "Verilerimi sil" talebinin yapacagi is bu: yalnizca bag tablosundan cikar.
db.sepet_kaynak.delete_many({"household_id": hh})
check("bag silindi", db.sepet_kaynak.find_one({"sepet_id": sepet}) is None)
kalan = list(db.price_points.find({"sepet_id": sepet}, {"_id": 0}))
check("fiyat kayitlari YERINDE", len(kalan) == 2, str(len(kalan)))
check("kalan kayit artik gercekten anonim",
      all(not any(k in p for k in ("household_id", "user_id", "expense_id")) for p in kalan))

print()
print("== farkli fisler farkli sepet ==")
c.post(f"{API}/expenses", headers=h, json={
    "target_type": "household", "total": 3.0, "source": "receipt", "merchant": "BIM",
    "expense_date": "2026-08-21",
    "items": [{"name": "DOMATES", "price": 3.0, "quantity": 1, "unit": "kg", "generic": "domates"}]})
hepsi = [p for p in db.price_points.find({"merchant_key": "bim"}, {"_id": 0}) if p.get("sepet_id")]
check("iki ayri sepet olustu", len({p["sepet_id"] for p in hepsi}) >= 2,
      str(len({p["sepet_id"] for p in hepsi})))

print()
print("== temizlik ==")
db.price_points.delete_many({"sepet_id": {"$in": [p["sepet_id"] for p in hepsi]}})
db.sepet_kaynak.delete_many({"household_id": hh})
c.post(f"{API}/households/leave", headers=h)
c.post(f"{API}/auth/logout", headers=h)
print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
