"""Istatistik ucu testi."""
import sys
import uuid

import httpx

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8001").rstrip("/")
API = f"{BASE}/api"
TAG = uuid.uuid4().hex[:8]
ok = fail = 0


def check(label, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1; print(f"  [OK]   {label}")
    else:
        fail += 1; print(f"  [FAIL] {label}  {detail}")


def hdr(t):
    return {"Authorization": f"Bearer {t}"}


c = httpx.Client(timeout=90.0)


def reg(w):
    r = c.post(f"{API}/auth/register", json={
        "email": f"st_{w}_{TAG}@odahesap-e2e.com", "password": "sifre123", "name": w.title()})
    r.raise_for_status()
    return r.json()["session_token"], r.json()["user"]["user_id"]


alice, alice_id = reg("alice")
bob, bob_id = reg("bob")
r = c.post(f"{API}/households", headers=hdr(alice), json={"name": f"Stat Ev {TAG}"})
inv = r.json()["household"]["invite_code"]
c.post(f"{API}/households/join", headers=hdr(bob), json={"invite_code": inv})
c.post(f"{API}/households/approve", headers=hdr(alice), json={"user_id": bob_id})

print("\n-- bos dönem --")
s = c.get(f"{API}/stats", headers=hdr(alice)).json()
check("toplam 0", s["total"] == 0, str(s))
check("kategori bos", s["categories"] == [], str(s))

print("\n-- harcamalar --")
c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "household", "total": 100.0, "source": "receipt", "merchant": "REWE",
    "items": [{"name": "Süt", "price": 40.0, "quantity": 1, "category": "sut_urunleri"},
              {"name": "Ekmek", "price": 60.0, "quantity": 1, "category": "firin"}]})
c.post(f"{API}/expenses", headers=hdr(bob), json={
    "target_type": "household", "total": 60.0, "source": "receipt", "merchant": "Türk Marketi",
    "items": [{"name": "Sucuk", "price": 60.0, "quantity": 1, "category": "et_balik"}]})
# bunlar dahil EDILMEMELI
c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "self", "total": 500.0, "source": "manual", "items": []})
c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "roommate", "target_user_id": bob_id, "total": 300.0, "source": "manual", "items": []})

s = c.get(f"{API}/stats", headers=hdr(alice)).json()
check("toplam sadece ev harcamasi (160)", abs(s["total"] - 160) < 0.01, str(s["total"]))
check("kisi basi 80", abs(s["per_person"] - 80) < 0.01, str(s["per_person"]))
check("harcama sayisi 2", s["expense_count"] == 2, str(s["expense_count"]))

print("\n-- kategoriler --")
cats = {x["key"]: x["total"] for x in s["categories"]}
check("firin 60", abs(cats.get("firin", 0) - 60) < 0.01, str(cats))
check("sut_urunleri 40", abs(cats.get("sut_urunleri", 0) - 40) < 0.01, str(cats))
check("et_balik 60", abs(cats.get("et_balik", 0) - 60) < 0.01, str(cats))
check("kategori toplami = genel toplam",
      abs(sum(cats.values()) - s["total"]) < 0.05, f"{sum(cats.values())} vs {s['total']}")
check("buyukten kucuge sirali",
      [x["total"] for x in s["categories"]] == sorted([x["total"] for x in s["categories"]], reverse=True),
      str(s["categories"]))

print("\n-- marketler --")
mer = {x["name"]: x["total"] for x in s["merchants"]}
check("REWE 100", abs(mer.get("REWE", 0) - 100) < 0.01, str(mer))
check("Türk Marketi 60", abs(mer.get("Türk Marketi", 0) - 60) < 0.01, str(mer))

print("\n-- tahminler --")
check("gunluk ortalama > 0", s["daily_average"] > 0, str(s["daily_average"]))
check("30 gun tahmini = gunluk x 30",
      abs(s["projected_30d"] - s["daily_average"] * 30) < 0.02, str(s))
check("ilk donemde degisim yok", s["change_pct"] is None, str(s["change_pct"]))

print("\n-- gecen doneme gore degisim --")
c.post(f"{API}/periods/close", headers=hdr(alice))
c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "household", "total": 240.0, "source": "manual", "items": []})
s2 = c.get(f"{API}/stats", headers=hdr(alice)).json()
check("degisim %50 (160 -> 240)", s2["change_pct"] == 50, str(s2["change_pct"]))
check("kalemsiz harcama 'diger'e dustu",
      any(x["key"] == "diger" and abs(x["total"] - 240) < 0.01 for x in s2["categories"]),
      str(s2["categories"]))

print("\n-- temizlik --")
for t in (alice, bob):
    c.post(f"{API}/households/leave", headers=hdr(t))
    c.post(f"{API}/auth/logout", headers=hdr(t))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
