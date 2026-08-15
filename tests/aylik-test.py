"""Aylik istatistik testi -- TAKVIM AYI bazli.

Mevcut `/stats` DONEM bazlidir ve Anasayfa'nin basligini besler. Burasi ayri:
donem uc hafta da surebilir yedi hafta da, ama "bu ay ne kadar harcadik"
sorusunun cevabi dönemle degismemeli.

Korunan kurallar:
  1. Ay siniri kesin: 31 Temmuz temmuza, 1 Agustos agustosa yazilir.
  2. Kisisel harcamalar yalnizca sahibine gorunur ve ev toplamina girmez.
  3. Sabit / degisken ayrimi `recurring_id`'den geliyor (Tur 5'in getirdigi
     kesit): "bu ay 340 EUR market, 1.290 EUR sabit gider".
  4. Onceki AY ile karsilastirma, onceki donemle degil.

    cd backend
    .venv/Scripts/python.exe ../tests/aylik-test.py http://127.0.0.1:8090

Sunucuyu AYRI veritabaniyla baslatin: DB_NAME=odahesap_test
"""
import sys
import uuid
from datetime import date

import httpx

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8001").rstrip("/")
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


def near(a, b, tol=0.02):
    return a is not None and abs(float(a) - float(b)) <= tol


def hdr(t):
    return {"Authorization": f"Bearer {t}"}


c = httpx.Client(timeout=90.0)


def reg(who):
    r = c.post(f"{API}/auth/register", json={
        "email": f"ay_{who}_{TAG}@odahesap-e2e.com",
        "password": "sifre123", "name": who.title()})
    r.raise_for_status()
    return r.json()["session_token"], r.json()["user"]["user_id"]


alice, alice_id = reg("alice")
bob, bob_id = reg("bob")
r = c.post(f"{API}/households", headers=hdr(alice), json={"name": f"Aylik Ev {TAG}"})
invite = r.json()["household"]["invite_code"]
c.post(f"{API}/households/join", headers=hdr(bob), json={"invite_code": invite})
c.post(f"{API}/households/approve", headers=hdr(alice), json={"user_id": bob_id})

# Sabit iki ay kullaniliyor: testin bugunun tarihine bagli olmamasi icin.
AY = "2026-05"
ONCEKI = "2026-04"
print(f"2 kisilik ev kuruldu ({TAG}) · olculen ay {AY}")


def harca(tok, day, total, **body):
    body.setdefault("source", "manual")
    body.setdefault("target_type", "household")
    return c.post(f"{API}/expenses", headers=hdr(tok), json={
        "expense_date": day, "total": total, **body})


def stat(tok, month=AY, scope="household"):
    return c.get(f"{API}/stats/monthly?month={month}&scope={scope}", headers=hdr(tok)).json()


print("\n-- 1. ay siniri --")
harca(alice, "2026-04-30", 100.0, category="Market")     # onceki ay
harca(alice, "2026-05-01", 60.0, category="Market")      # olculen ayin ilk gunu
harca(bob, "2026-05-31", 40.0, category="Market")        # olculen ayin son gunu
harca(alice, "2026-06-01", 999.0, category="Market")     # sonraki ay
s = stat(alice)
check("ayin ilk ve son gunu iceride, komsu aylar disarida", near(s["total"], 100.0), s["total"])
check("harcama sayisi 2", s["expense_count"] == 2, s["expense_count"])
check("onceki AY toplami 100", near(s["prev_total"], 100.0), s["prev_total"])
check("degisim %0", s["change_pct"] == 0, s["change_pct"])
check("onceki ay etiketi dogru", s.get("prev_month") == ONCEKI, s.get("prev_month"))


print("\n-- 2. kisisel harcamalar ev toplamina girmiyor --")
harca(alice, "2026-05-10", 250.0, target_type="self", category="Kişisel")
s = stat(alice)
check("ev toplami degismedi", near(s["total"], 100.0), s["total"])
sp = stat(alice, scope="self")
check("kisisel sekmede 250 gorunuyor", near(sp["total"], 250.0), sp["total"])
sb = stat(bob, scope="self")
check("Bob, Alice'in kisiselini gormuyor", near(sb["total"], 0.0), sb["total"])
check("kisisel sekmede kim odedi dokumu yok", sp["by_member"] == [], str(sp["by_member"]))


print("\n-- 3. ikili harcama ev toplamina girmiyor --")
harca(alice, "2026-05-11", 30.0, target_type="roommate", target_user_id=bob_id)
check("iki kisi arasindaki borc ev harcamasi degil",
      near(stat(alice)["total"], 100.0), stat(alice)["total"])


print("\n-- 4. secili kisiler (custom) ev toplamina GIRIYOR --")
# Fisteki yumurtayi iki kisi bolusuyorsa bu yine evin harcadigi paradir.
harca(alice, "2026-05-12", 20.0, split_mode="equal",
      split_with={alice_id: 1, bob_id: 1})
s = stat(alice)
check("custom harcama sayildi", near(s["total"], 120.0), s["total"])


print("\n-- 5. kim ne kadar odedi --")
s = stat(alice)
by = {x["user_id"]: x["total"] for x in s["by_member"]}
check("Alice 80 odedi (60 + 20)", near(by.get(alice_id), 80.0), str(by))
check("Bob 40 odedi", near(by.get(bob_id), 40.0), str(by))
check("kisi basi 60", near(s["per_person"], 60.0), s["per_person"])


print("\n-- 6. sabit / degisken ayrimi --")
# Duzenli odemeden gelen harcama `recurring_id` tasiyor. Bu ayrim Tur 5'ten
# once kurulamiyordu ve insanlarin asil sordugu ayrim bu.
s = stat(alice)
check("henuz sabit gider yok", near(s["fixed"], 0.0), s["fixed"])
check("hepsi degisken", near(s["variable"], 120.0), s["variable"])

bugun = date.today()
r = c.post(f"{API}/recurring", headers=hdr(alice), json={
    "name": "Kira", "amount": 900.0, "day_of_month": 1, "amount_fixed": True})
rec = r.json()["recurring"]
r = c.post(f"{API}/recurring/{rec['recurring_id']}/confirm", headers=hdr(alice), json={
    "period_key": f"{bugun.year:04d}-{bugun.month:02d}",
    "expense_date": "2026-05-05", "amount": 900.0})
check("kira onaylandi", r.status_code == 200, r.text[:160])
s = stat(alice)
check("sabit gider 900", near(s["fixed"], 900.0), s["fixed"])
check("degisken 120", near(s["variable"], 120.0), s["variable"])
check("toplam 1020", near(s["total"], 1020.0), s["total"])


print("\n-- 7. kategori ve market dokumu --")
harca(alice, "2026-05-13", 50.0, merchant="ALDI", category="Market",
      items=[{"name": "SUT", "price": 20.0, "quantity": 1, "category": "sut_urunleri"},
             {"name": "EKMEK", "price": 30.0, "quantity": 1, "category": "firin"}])
s = stat(alice)
cats = {x["key"]: x["total"] for x in s["categories"]}
check("kalem kategorileri dokumde", near(cats.get("sut_urunleri"), 20.0), str(cats))
check("firin 30", near(cats.get("firin"), 30.0), str(cats))
merch = {x["name"]: x["total"] for x in s["merchants"]}
check("ALDI 50", near(merch.get("ALDI"), 50.0), str(merch))
check("kategori toplami harcama toplamina esit",
      near(sum(x["total"] for x in s["categories"]), s["total"]),
      f'{sum(x["total"] for x in s["categories"])} vs {s["total"]}')


print("\n-- 8. gunluk seri ve ay listesi --")
s = stat(alice)
check("mayis 31 gun", len(s["daily_series"]) == 31, len(s["daily_series"]))
gun = {d["day"]: d["total"] for d in s["daily_series"]}
check("1 mayis 60", near(gun.get("2026-05-01"), 60.0), str(gun.get("2026-05-01")))
check("31 mayis 40", near(gun.get("2026-05-31"), 40.0), str(gun.get("2026-05-31")))
check("harcamasiz gun 0 ile duruyor", near(gun.get("2026-05-20"), 0.0), str(gun.get("2026-05-20")))
check("ay listesinde nisan-mayis-haziran var",
      {"2026-04", "2026-05", "2026-06"} <= set(s["months"]), str(s["months"]))


print("\n-- 9. bos ay dusurmuyor --")
s = stat(alice, month="2020-01")
check("veri olmayan ay sifir donuyor", near(s["total"], 0.0), s["total"])
check("degisim None", s["change_pct"] is None, str(s["change_pct"]))
check("gunluk seri yine dolu (31 gun)", len(s["daily_series"]) == 31, len(s["daily_series"]))
s = c.get(f"{API}/stats/monthly?month=bozuk", headers=hdr(alice)).json()
check("bozuk ay parametresi dusurmuyor", "total" in s, str(s)[:120])


print("\n-- temizlik --")
for tok in (alice, bob):
    c.post(f"{API}/households/leave", headers=hdr(tok))
    c.post(f"{API}/auth/logout", headers=hdr(tok))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
