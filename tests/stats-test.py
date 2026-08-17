"""Istatistik ucu testi."""
import sys
import uuid
from datetime import date, timedelta

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

print("\n-- kim ne kadar odedi --")
bym = {x["user_id"]: x["total"] for x in s["by_member"]}
check("iki uye de listede", len(s["by_member"]) == 2, str(s["by_member"]))
check("Alice 100 odedi", abs(bym.get(alice_id, 0) - 100) < 0.01, str(bym))
check("Bob 60 odedi", abs(bym.get(bob_id, 0) - 60) < 0.01, str(bym))
# Kisisel ve ikili harcamalar buraya da girmemeli.
check("kisi toplami = ev toplami",
      abs(sum(bym.values()) - s["total"]) < 0.01, f"{sum(bym.values())} vs {s['total']}")
check("buyukten kucuge sirali",
      [x["total"] for x in s["by_member"]] == sorted([x["total"] for x in s["by_member"]], reverse=True),
      str(s["by_member"]))
check("uye sayisi 2", s["member_count"] == 2, str(s["member_count"]))

print("\n-- gunluk seri --")
check("14 gun donuyor", len(s["daily_series"]) == 14, str(len(s["daily_series"])))
check("tarihler artan sirali",
      [d["day"] for d in s["daily_series"]] == sorted(d["day"] for d in s["daily_series"]),
      str([d["day"] for d in s["daily_series"]][:3]))
# Pencere UTC bugunden geri sayiyor; yerel takvim bir gun ileride olabilir.
check("son gun bugun ya da yerel bugun",
      s["daily_series"][-1]["day"] in
      {date.today().isoformat(), (date.today() - timedelta(days=1)).isoformat()},
      s["daily_series"][-1]["day"])
# Harcamalar bugun eklendi; hepsi son kovaya dusmeli.
check("bugunun toplami 160", abs(s["daily_series"][-1]["total"] - 160) < 0.01,
      str(s["daily_series"][-1]))
check("harcamasiz gunler 0 ile duruyor",
      all(d["total"] == 0 for d in s["daily_series"][:-1]), str(s["daily_series"][:3]))
# Yerel takvimi UTC'nin onundeki saatlerde girilen harcama duserdi.
tomorrow = (date.today() + timedelta(days=1)).isoformat()
c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "household", "total": 20.0, "source": "manual",
    "expense_date": tomorrow, "items": []})
s_t = c.get(f"{API}/stats", headers=hdr(alice)).json()
check("ileri tarihli harcama grafikten dusmuyor",
      abs(sum(d["total"] for d in s_t["daily_series"]) - s_t["total"]) < 0.01,
      f"{sum(d['total'] for d in s_t['daily_series'])} vs {s_t['total']}")
c.delete(f"{API}/expenses/{c.get(f'{API}/expenses', headers=hdr(alice)).json()['expenses'][0]['expense_id']}",
         headers=hdr(alice))
s = c.get(f"{API}/stats", headers=hdr(alice)).json()

print("\n-- ortalama ve kalem sayisi --")
check("ortalama fis 80 (160/2)", abs(s["avg_expense"] - 80) < 0.01, str(s["avg_expense"]))
check("kalem sayisi 3", s["item_count"] == 3, str(s["item_count"]))

print("\n-- gecen doneme gore degisim --")
c.post(f"{API}/periods/close", headers=hdr(alice))
c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "household", "total": 240.0, "source": "manual", "items": []})
s2 = c.get(f"{API}/stats", headers=hdr(alice)).json()
check("degisim %50 (160 -> 240)", s2["change_pct"] == 50, str(s2["change_pct"]))
check("kalemsiz harcama 'diger'e dustu",
      any(x["key"] == "diger" and abs(x["total"] - 240) < 0.01 for x in s2["categories"]),
      str(s2["categories"]))

print("\n-- payin: DUZ ORTALAMA degil GERCEK pay --")
# Kasa ekrani `per_person`i "payin" diye gosteriyordu; o ise
# `toplam / uye_sayisi`, yani kisiye ozel bolusmede yanlis. Bakiye
# `expense_shares` ile hesaplandigi icin ekranda "odedigin - payin" ustteki
# net durumu tutmuyordu. `my_share` ayni yontemi kullaniyor.
kira = c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "household", "total": 300.0, "source": "manual",
    "split_mode": "exact", "split_with": {alice_id: 100.0, bob_id: 200.0},
    "items": []})
check("kisiye ozel bolusme kaydedildi", kira.status_code == 200, kira.text[:120])

sa = c.get(f"{API}/stats", headers=hdr(alice)).json()
sb = c.get(f"{API}/stats", headers=hdr(bob)).json()
# Duz ortalama iki tarafta da AYNI; gercek pay farkli olmali.
check("duz ortalama iki kisi icin ayni",
      abs(sa["per_person"] - sb["per_person"]) < 0.01,
      f'{sa["per_person"]} / {sb["per_person"]}')
check("payin kisiye gore DEGISIYOR",
      abs(sa["my_share"] - sb["my_share"]) > 0.01,
      f'{sa["my_share"]} / {sb["my_share"]}')
check("Bob'un payi Alice'inkinden buyuk (200 > 100)",
      sb["my_share"] > sa["my_share"], f'{sb["my_share"]} / {sa["my_share"]}')

# Paylarin toplami harcama toplamina esit olmali: kimsenin payi kaybolmuyor.
# Paylarin toplami TUM donem toplamina esit: kimsenin payi kaybolmuyor,
# fazladan da uretilmiyor. (240 esit bolusuldu -> 120+120, ustune 100/200.)
check("paylarin toplami donem toplamina esit",
      abs((sa["my_share"] + sb["my_share"]) - sa["total"]) < 0.02,
      f'{sa["my_share"]} + {sb["my_share"]} vs {sa["total"]}')
check("Alice 120 + 100 = 220", abs(sa["my_share"] - 220) < 0.02, str(sa["my_share"]))
check("Bob 120 + 200 = 320", abs(sb["my_share"] - 320) < 0.02, str(sb["my_share"]))

print("\n-- temizlik --")
for t in (alice, bob):
    c.post(f"{API}/households/leave", headers=hdr(t))
    c.post(f"{API}/auth/logout", headers=hdr(t))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
