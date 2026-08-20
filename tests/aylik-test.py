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


print("\n-- 4. secili kisiler ev toplamina giriyor (BU EVDE ikisi = tum ev) --")
# DIKKAT: bu ev IKI kisilik, yani {alice, bob} listesi "tum ev" demek --
# harcama bu yuzden ev toplamina giriyor, "custom" etiketi tasidigi icin degil.
#
# Kural v35'te degisti: ev bolusmuyorsa ev harcamasi degildir. Once burada
# "iki kisi bolusuyorsa bu yine evin harcadigi paradir" yaziyordu ve UC kisilik
# bir evde bu yanlisti -- evin almadigi sey ev toplamini sisiriyordu. Iki
# kisilik bir evde iki kural ayni sonucu verdigi icin fark yillarca gorunmedi.
# Ayrimi UC kisilik evde `aylik-kapsam-test.py` koruyor.
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
# DUZENLI GIDERLER HALKADA YOK ve bu bilerek.
#
# Kira 900, degisken harcama 170: kira halkaya girseydi halka kiranin resmi
# olur ve her ay ayni seyi soylerdi. Halkanin isi "neyi degistirebilirim"
# sorusuna cevap vermek; kira bir karar degil bir sabit.
#
# Bu test once "kategori toplami == harcama toplami" diyordu ve kural
# degisince kirmizi verdi -- fark tam olarak 900, yani kiranin kendisiydi.
# Yeni degismez: kategoriler DEGISKENI topluyor.
kat_toplam = sum(x["total"] for x in s["categories"])
check("kategori toplami DEGISKENE esit",
      near(kat_toplam, s["variable"]),
      f'{kat_toplam} vs degisken {s["variable"]} (toplam {s["total"]})')
check("kira halkada YOK",
      near(s["total"] - kat_toplam, s["fixed"]),
      f'fark {s["total"] - kat_toplam} vs sabit {s["fixed"]}')
# Urun listesine de girmiyor: "Kira" bir urun degil ve girseydi her ay
# birinci sirada otururdu.
check("kira urun listesinde YOK",
      all("kira" not in (u["name"] or "").lower() for u in s.get("products", [])),
      str([u["name"] for u in s.get("products", [])]))


print("\n-- 8. kumulatif egri ve ay listesi --")
# Gunluk cubuklarin yerine biriken egri: az harcamada bile duzgun cikiyor ve
# "gecen ayin bu gununde neredeydik" sorusuna cevap veriyor.
s = stat(alice)
check("mayis 31 gun", len(s["cumulative"]) == 31, len(s["cumulative"]))
gun = {d["day"]: d["total"] for d in s["cumulative"]}
check("1 mayis 60 (ilk harcama)", near(gun.get("2026-05-01"), 60.0), str(gun.get("2026-05-01")))
check("egri hic dusmuyor",
      all(a["total"] <= b["total"] + 1e-9 for a, b in zip(s["cumulative"], s["cumulative"][1:])))
check("son gun ay toplamina esit", near(s["cumulative"][-1]["total"], s["total"]),
      f'{s["cumulative"][-1]["total"]} vs {s["total"]}')
check("harcamasiz gunde deger korunuyor (dusmuyor)",
      near(gun.get("2026-05-20"), gun.get("2026-05-13")), str(gun.get("2026-05-20")))
check("gecen ayin egrisi de geliyor", len(s["prev_cumulative"]) == 30,
      len(s["prev_cumulative"]))
# Nisan 30 gun: kisa ayi 31'e germek yanlis bir egri uretirdi.
check("kisa ay gerilmemis", len(s["prev_cumulative"]) == 30)
check("ay listesinde nisan-mayis-haziran var",
      {"2026-04", "2026-05", "2026-06"} <= set(s["months"]), str(s["months"]))


print("\n-- 8b. kategori ay-ay degisimi --")
kat = {x["key"]: x for x in s["categories"]}
check("kategorilerde onceki ay ve degisim alanlari var",
      all("prev_total" in x and "change_pct" in x for x in s["categories"]),
      str(s["categories"][:1]))
# Gecen ay hic olmayan bir kategoride yuzde uretmek yaniltici olur ("yeni").
check("gecen ay olmayan kategoride degisim None",
      kat.get("sut_urunleri", {}).get("change_pct") is None, str(kat.get("sut_urunleri")))


print("\n-- 8d. duzenli giderlerin ay ay seyri --")
# Asil merak edilen kesit: elektrik gecen ay 60 iken bu ay 90 olduysa insan
# sebebini sorar. Kira zaten degismiyor ve listede yer kaplamamali.
r = c.post(f"{API}/recurring", headers=hdr(alice), json={
    "name": "Elektrik", "amount": 60.0, "day_of_month": 5, "amount_fixed": False})
elk = r.json()["recurring"]
bugun2 = date.today()
c.post(f"{API}/recurring/{elk['recurring_id']}/confirm", headers=hdr(alice), json={
    "period_key": f"{bugun2.year:04d}-{bugun2.month:02d}",
    "expense_date": "2026-04-05", "amount": 60.0})
s = stat(alice)
check("tek ayda kayit varsa fatura listesinde yok (kiyas yok)",
      all(b["name"] != "Elektrik" for b in s["bills"]), str(s["bills"]))

# Ayni sablonu bir sonraki ay farkli tutarla: artik kiyaslanabilir.
await_ = c.post(f"{API}/recurring/{elk['recurring_id']}/confirm", headers=hdr(alice), json={
    "period_key": "2026-05", "expense_date": "2026-05-05", "amount": 90.0})
check("ikinci ay onaylandi", await_.status_code == 200, await_.text[:160])
s = stat(alice)
elektrik = next((b for b in s["bills"] if b["name"] == "Elektrik"), None)
check("fatura listesinde gorunuyor", elektrik is not None, str(s["bills"]))
check("bu ay 90", elektrik and near(elektrik["total"], 90.0), str(elektrik))
check("gecen ay 60", elektrik and near(elektrik["prev_total"], 60.0), str(elektrik))
check("degisim %50", elektrik and elektrik["change_pct"] == 50, str(elektrik))
check("degisken oldugu isaretli", elektrik and elektrik["amount_fixed"] is False, str(elektrik))
# Kira iki ayda da 900 olsaydi listede olmamali; degismeyen satir her ay ayni
# seyi soyler ve asil degiseni gizler.
check("degismeyen sablon listede yok",
      all(b["change_pct"] != 0 for b in s["bills"]), str(s["bills"]))


print("\n-- 8c. senin toplam cikisin --")
# Ev payin + kisiselin. Oran degil toplam: "kisiselin evin %35'i" garip bir
# sayi, "bu ay toplam su kadar harcadin" gercek bir soruya cevap.
s = stat(alice)
check("ev payi hesaplandi", s["my_share"] > 0, str(s["my_share"]))
check("kisisel harcama ayri geliyor", near(s["my_personal"], 250.0), str(s["my_personal"]))
check("ev payi ev toplamindan kucuk", s["my_share"] < s["total"],
      f'{s["my_share"]} / {s["total"]}')


print("\n-- 9. bos ay dusurmuyor --")
s = stat(alice, month="2020-01")
check("veri olmayan ay sifir donuyor", near(s["total"], 0.0), s["total"])
check("degisim None", s["change_pct"] is None, str(s["change_pct"]))
check("kumulatif seri yine dolu (31 gun)", len(s["cumulative"]) == 31, len(s["cumulative"]))
s = c.get(f"{API}/stats/monthly?month=bozuk", headers=hdr(alice)).json()
check("bozuk ay parametresi dusurmuyor", "total" in s, str(s)[:120])


print("\n-- ay ortasinda AYNI GUNE gore karsilastirma --")
# Onceki hesap bu ayin SU ANA KADARKI toplamini gecen ayin TAM toplamiyla
# karsilastiriyordu: ayin 5'inde bakan herkes "%80 azalis" goruyordu, cunku
# ay bitmemisti. Ancak ayin son gununde duzeliyordu.
#
# Kurgu: gecen aya biri ERKEN biri GEC iki harcama konuyor. Dogru hesap
# yalnizca erken olani sayar; eski hesap ikisini birden sayardi.
bugun3 = date.today()
if bugun3.day >= 27:
    print("  [ATLA] ayin sonundayiz; erken/gec kesiti kurulamiyor")
else:
    carol, carol_id = reg("carol")
    r = c.post(f"{API}/households", headers=hdr(carol), json={"name": f"Kesit Ev {TAG}"})
    BU_AY = f"{bugun3.year:04d}-{bugun3.month:02d}"
    onceki_yil = bugun3.year - 1 if bugun3.month == 1 else bugun3.year
    onceki_ay = 12 if bugun3.month == 1 else bugun3.month - 1
    ONC = f"{onceki_yil:04d}-{onceki_ay:02d}"

    harca(carol, f"{ONC}-01", 100.0, category="Market")          # bugunun gununden ONCE
    harca(carol, f"{ONC}-{bugun3.day + 1:02d}", 900.0, category="Market")  # SONRA
    harca(carol, f"{BU_AY}-01", 120.0, category="Market")

    s = c.get(f"{API}/stats/monthly?month={BU_AY}", headers=hdr(carol)).json()
    check("gecen ayin TAM toplami 1000", near(s["prev_total"], 1000.0), s["prev_total"])
    check("ayni gune kadarki toplam 100", near(s["prev_same_day"], 100.0),
          s.get("prev_same_day"))
    # Eski hesap: (120-1000)/1000 = -%88. Dogrusu: (120-100)/100 = +%20.
    check("degisim ayni gune gore (+%20)", s["change_pct"] == 20, str(s["change_pct"]))
    check("gecen gun sayisi bugun", s.get("elapsed_days") == bugun3.day,
          str(s.get("elapsed_days")))

    # Gecmis bir aya bakilirken kesit YOK: iki ay da tam.
    s2 = c.get(f"{API}/stats/monthly?month={AY}", headers=hdr(alice)).json()
    check("gecmis ayda kesit uygulanmiyor", near(s2["prev_same_day"], s2["prev_total"]),
          f"{s2.get('prev_same_day')} vs {s2['prev_total']}")

    c.post(f"{API}/households/leave", headers=hdr(carol))
    c.post(f"{API}/auth/logout", headers=hdr(carol))

print("\n-- temizlik --")
for tok in (alice, bob):
    c.post(f"{API}/households/leave", headers=hdr(tok))
    c.post(f"{API}/auth/logout", headers=hdr(tok))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
