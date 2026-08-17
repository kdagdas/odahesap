"""Etiket bazli muhasebe -- ev sahibinin kendi senaryosu.

"Ben + Salih icin aldigim 4 EUR'luk bir urun:
   * istatistikte BENIM sahsi harcamama 2 EUR eklesin
   * SALIH'in sahsina 2 EUR eklesin
   * EVE hic eklemesin
   * Kasa'da Salih'e olan borcumdan 2 EUR dussun, cunku onun icin odedim"

Bu dosya o cumleyi dogrudan sinar. Ayrica iki ucun AYNI kurali kullandigini
kontrol eder: `/stats` (Anasayfa + Kasa, donem bazli) ile `/stats/monthly`
(Istatistik, takvim ayi) once ayrisiyordu -- ilki `target_type` etiketine,
ikincisi bolusme listesine bakiyordu. Uc kisilik bir evde "sen + Salih"
bolusmesi `custom` etiketi tasidigi icin Anasayfa onu EV harcamasi sayiyordu.

    cd backend
    .venv/Scripts/python.exe ../tests/etiket-bazli-test.py http://127.0.0.1:8099

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
        "email": f"etk_{who}_{TAG}@odahesap-e2e.com",
        "password": "sifre123", "name": who.title()})
    r.raise_for_status()
    return r.json()["session_token"], r.json()["user"]["user_id"]


ben, ben_id = reg("kadir")
salih, salih_id = reg("salih")
kemal, kemal_id = reg("kemal")

r = c.post(f"{API}/households", headers=hdr(ben), json={"name": f"Etiket {TAG}"})
kod = r.json()["household"]["invite_code"]
for tok, uid in ((salih, salih_id), (kemal, kemal_id)):
    c.post(f"{API}/households/join", headers=hdr(tok), json={"invite_code": kod})
    c.post(f"{API}/households/approve", headers=hdr(ben), json={"user_id": uid})

AY = date.today().strftime("%Y-%m")
BUGUN = date.today().isoformat()
print(f"3 kisilik ev kuruldu ({TAG})")


def donem(tok):
    return c.get(f"{API}/stats", headers=hdr(tok)).json()


def aylik(tok, scope="household"):
    return c.get(f"{API}/stats/monthly?month={AY}&scope={scope}",
                 headers=hdr(tok)).json()


def net(tok):
    return c.get(f"{API}/balances", headers=hdr(tok)).json()


print("\n-- once: Salih'e 40 EUR borclanayim --")
# Salih tum evin bolustugu 60 EUR'luk bir alisveris yapiyor -> herkes 20 borclu.
c.post(f"{API}/expenses", headers=hdr(salih), json={
    "target_type": "household", "total": 60.0, "source": "manual",
    "expense_date": BUGUN, "items": []}).raise_for_status()
b = net(ben)
check("Salih +40, ben -20", near(b["net"][salih_id], 40.0) and near(b["net"][ben_id], -20.0),
      str(b["net"]))
borc_once = next((t["amount"] for t in b["transfers"]
                  if t["from"] == ben_id and t["to"] == salih_id), 0)
check("Salih'e borcum 20", near(borc_once, 20.0), str(borc_once))


print("\n-- ASIL SENARYO: ben + Salih icin 4 EUR --")
c.post(f"{API}/expenses", headers=hdr(ben), json={
    "total": 4.0, "source": "manual", "expense_date": BUGUN, "items": [],
    "split_mode": "equal", "split_with": {ben_id: 1, salih_id: 1},
}).raise_for_status()

# 1-2. Istatistikte ikimizin de SAHSI harcamasi 2 EUR artiyor.
check("benim kişisel harcamam 2", near(aylik(ben, "self")["total"], 2.0),
      str(aylik(ben, "self")["total"]))
check("Salih'in kişisel harcaması 2", near(aylik(salih, "self")["total"], 2.0),
      str(aylik(salih, "self")["total"]))
check("Kemal'in kişiseli 0 (ilgisi yok)", near(aylik(kemal, "self")["total"], 0.0),
      str(aylik(kemal, "self")["total"]))

# 3. EVE hic eklenmiyor -- ne aylik istatistikte ne Anasayfa'nin donem toplaminda.
check("aylık EV toplamı 60 (4 girmedi)", near(aylik(ben)["total"], 60.0),
      str(aylik(ben)["total"]))
check("dönem EV toplamı 60 (4 girmedi)", near(donem(ben)["total"], 60.0),
      str(donem(ben)["total"]))

# 4. Kasa'da Salih'e borcum 2 EUR duşuyor.
b2 = net(ben)
borc_sonra = next((t["amount"] for t in b2["transfers"]
                   if t["from"] == ben_id and t["to"] == salih_id), 0)
check("Salih'e borcum 20 -> 18", near(borc_sonra, 18.0), str(borc_sonra))
check("düşen tutar tam 2", near(borc_once - borc_sonra, 2.0),
      f"{borc_once} -> {borc_sonra}")


print("\n-- Kasa satiri: ödediğin - payın = harcamalardan gelen net --")
d = donem(ben)
check("ödediğin 4 (Salih için çıkardığım para dahil)", near(d["my_paid"], 4.0),
      str(d["my_paid"]))
check("payın 22 (evden 20 + ikiliden 2)", near(d["my_share"], 22.0), str(d["my_share"]))
check("ödediğin - payın = net (-18)",
      near(d["my_paid"] - d["my_share"], b2["net"][ben_id]),
      f'{d["my_paid"]} - {d["my_share"]} vs {b2["net"][ben_id]}')

ds = donem(salih)
check("Salih: ödediğin 60", near(ds["my_paid"], 60.0), str(ds["my_paid"]))
check("Salih: payın 22", near(ds["my_share"], 22.0), str(ds["my_share"]))
check("Salih: ödediğin - payın = net (+38)",
      near(ds["my_paid"] - ds["my_share"], b2["net"][salih_id]),
      f'{ds["my_paid"]} - {ds["my_share"]} vs {b2["net"][salih_id]}')


print("\n-- iki uç AYNI kuralı kullanıyor --")
# Onceden `/stats` etikete, `/stats/monthly` bolusme listesine bakiyordu.
check("dönem ve aylık ev toplamı aynı",
      near(donem(ben)["total"], aylik(ben)["total"]),
      f'{donem(ben)["total"]} / {aylik(ben)["total"]}')


print("\n-- tek kişiye alım: tamamı ona yazılır --")
c.post(f"{API}/expenses", headers=hdr(ben), json={
    "target_type": "roommate", "target_user_id": kemal_id, "total": 10.0,
    "source": "manual", "expense_date": BUGUN, "items": []}).raise_for_status()
check("Kemal'in kişiseli 10 (tamamı)", near(aylik(kemal, "self")["total"], 10.0),
      str(aylik(kemal, "self")["total"]))
check("benim kişiselim hâlâ 2 (ödedim ama benim değil)",
      near(aylik(ben, "self")["total"], 2.0), str(aylik(ben, "self")["total"]))
check("ev toplamı hâlâ 60", near(donem(ben)["total"], 60.0), str(donem(ben)["total"]))
d3 = donem(ben)
check("ödediğin 14 oldu", near(d3["my_paid"], 14.0), str(d3["my_paid"]))
check("payın hâlâ 22", near(d3["my_share"], 22.0), str(d3["my_share"]))


print("\n-- temizlik --")
for tok in (salih, kemal, ben):
    c.post(f"{API}/households/leave", headers=hdr(tok))
    c.post(f"{API}/auth/logout", headers=hdr(tok))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
