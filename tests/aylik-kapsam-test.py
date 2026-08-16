"""Aylik istatistikte EV / KISISEL ayrimi -- UC kisilik evde.

Neden ayri bir dosya: `aylik-test.py` iki kisilik bir ev kuruyor ve orada
"iki kisi bolusuyor" ile "tum ev bolusuyor" AYNI SEY. Ayrimin yanlis oldugu
tek yer uc ve daha kalabalik evler, o yuzden hata yillarca gorunmedi.

Duzeltilen hata (v35):
  * `roommate` harcamalari HICBIR istatistikte yoktu. Sorgu `self` icin
    `target_type == "self"`, `household` icin `["household", "custom"]`
    diyordu; `roommate` ikisine de girmiyordu. Salih'in senin icin aldigi sey
    kayiptı.
  * `custom` (evin bir bolumunun bolustugu sey) EV harcamasi sayiliyordu,
    yani evin almadigi sey ev toplamini sisiriyordu.

Bugunku kural -- **ev bolusmuyorsa ev harcamasi degildir**:
  * Evin tamami listedeyse    -> ev; tutar harcamanin toplami
  * Degilse                   -> kisisel; tutar SENIN PAYIN
  * `target_type == "self"`   -> her zaman kisisel (acik beyan)

Bu, `aylik-test.py` icindeki "custom ev toplamina GIRIYOR" kararini bilerek
tersine cevirir: ev sahibi, evin bir bolumunun bolustugu seyin ev harcamasi
degil kisisel harcama oldugunu soyledi -- "eve alinmamistir, daha keyfi bir
harcamadir ve karsiligini ben odeyecegim".

    cd backend
    .venv/Scripts/python.exe ../tests/aylik-kapsam-test.py http://127.0.0.1:8099

Sunucuyu AYRI veritabaniyla baslatin: DB_NAME=odahesap_test
"""
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
        "email": f"kaps_{who}_{TAG}@odahesap-e2e.com",
        "password": "sifre123", "name": who.title()})
    r.raise_for_status()
    return r.json()["session_token"], r.json()["user"]["user_id"]


alice, alice_id = reg("alice")
bob, bob_id = reg("bob")
carol, carol_id = reg("carol")

r = c.post(f"{API}/households", headers=hdr(alice), json={"name": f"Kapsam {TAG}"})
kod = r.json()["household"]["invite_code"]
for tok, uid in ((bob, bob_id), (carol, carol_id)):
    c.post(f"{API}/households/join", headers=hdr(tok), json={"invite_code": kod})
    c.post(f"{API}/households/approve", headers=hdr(alice), json={"user_id": uid})

AY = "2026-05"
print(f"3 kisilik ev kuruldu ({TAG}) · olculen ay {AY}")


def harca(tok, day, total, **body):
    body.setdefault("source", "manual")
    body.setdefault("target_type", "household")
    r = c.post(f"{API}/expenses", headers=hdr(tok), json={
        "expense_date": day, "total": total, **body})
    r.raise_for_status()
    return r.json()


def stat(tok, scope="household"):
    return c.get(f"{API}/stats/monthly?month={AY}&scope={scope}", headers=hdr(tok)).json()


print("\n-- 1. tum ev bolusuyor: EV harcamasi --")
harca(alice, "2026-05-02", 90.0, category="Market",
      split_mode="equal", split_with={alice_id: 1, bob_id: 1, carol_id: 1})
check("ev toplaminda 90", near(stat(alice)["total"], 90.0), stat(alice)["total"])
check("kisiselde yok", near(stat(alice, "self")["total"], 0.0),
      stat(alice, "self")["total"])
check("ucuncu kisi de ayni ev toplamini goruyor",
      near(stat(carol)["total"], 90.0), stat(carol)["total"])


print("\n-- 2. biri BENIM icin aldi: kisisel, TAM tutar --")
# Onceden bu harcama hicbir istatistikte gorunmuyordu.
harca(alice, "2026-05-05", 20.0, target_type="roommate", target_user_id=bob_id,
      category="Kişisel bakım")
check("ev toplami degismedi", near(stat(alice)["total"], 90.0), stat(alice)["total"])
sb = stat(bob, "self")
check("Bob'un kisiselinde 20 (tamami)", near(sb["total"], 20.0), sb["total"])
check("alan kisi harcama sayisinda gorunuyor", sb["expense_count"] == 1, sb["expense_count"])
check("alan icin degil ODEYEN icin kisisel degil",
      near(stat(alice, "self")["total"], 0.0), stat(alice, "self")["total"])
check("ilgisiz uye gormuyor", near(stat(carol, "self")["total"], 0.0),
      stat(carol, "self")["total"])


print("\n-- 3. evin BIR BOLUMU bolusuyor: kisisel, PAY kadar --")
# Uc kisilik evde iki kisinin bolustugu 30 EUR ev harcamasi DEGILDIR.
harca(alice, "2026-05-06", 30.0, split_mode="equal",
      split_with={alice_id: 1, bob_id: 1}, category="Restoran")
check("ev toplami hala 90", near(stat(alice)["total"], 90.0), stat(alice)["total"])
check("Alice'in kisiselinde payi (15)", near(stat(alice, "self")["total"], 15.0),
      stat(alice, "self")["total"])
check("Bob'un kisiseli 20 + 15 = 35", near(stat(bob, "self")["total"], 35.0),
      stat(bob, "self")["total"])
check("Carol'un kisiseli hala 0", near(stat(carol, "self")["total"], 0.0),
      stat(carol, "self")["total"])


print("\n-- 3b. ODEYEN listede yok: harcama ona hic yazilmiyor --")
# Ev sahibinin kendi ornegi: "Salih kendi haricinde ben ve Kemal icin harcama
# yapmis olabilir. Bunlarin Salih'e yazilmiyor olmasi lazim, eve de yazilmiyor
# olmasi lazim; bana ve Kemal'e yazilip aramizda bolusuluyor olmasi lazim."
harca(alice, "2026-05-09", 24.0, split_mode="equal",
      split_with={bob_id: 1, carol_id: 1}, category="Hediye")
check("ev toplami degismedi", near(stat(alice)["total"], 90.0), stat(alice)["total"])
check("ODEYENE yazilmadi (Alice hala 15)", near(stat(alice, "self")["total"], 15.0),
      stat(alice, "self")["total"])
check("Bob 35 + 12 = 47", near(stat(bob, "self")["total"], 47.0),
      stat(bob, "self")["total"])
check("Carol 0 + 12 = 12", near(stat(carol, "self")["total"], 12.0),
      stat(carol, "self")["total"])


print("\n-- 4. kisiye ozel tutarlar: pay tam olarak yazildigi kadar --")
harca(alice, "2026-05-07", 100.0, split_mode="exact",
      split_with={alice_id: 70.0, carol_id: 30.0}, category="Ulaşım")
check("ev toplami hala 90", near(stat(alice)["total"], 90.0), stat(alice)["total"])
check("Alice 15 + 70 = 85", near(stat(alice, "self")["total"], 85.0),
      stat(alice, "self")["total"])
check("Carol 12 + 30 = 42", near(stat(carol, "self")["total"], 42.0),
      stat(carol, "self")["total"])


print("\n-- 5. 'Kendim' acik beyandir, listeye bakilmadan kisisel --")
harca(carol, "2026-05-08", 45.0, target_type="self", category="Kişisel")
check("ev toplami hala 90", near(stat(alice)["total"], 90.0), stat(alice)["total"])
check("Carol 42 + 45 = 87", near(stat(carol, "self")["total"], 87.0),
      stat(carol, "self")["total"])
check("baskasinin 'Kendim'i gorunmuyor", near(stat(alice, "self")["total"], 85.0),
      stat(alice, "self")["total"])


print("\n-- 6. my_personal, kisisel sekmesiyle ayni sayiyi soyluyor --")
# Iki farkli yerden hesaplanip ekranin iki kosesinde celisen sayilar
# gostermesin diye.
for tok, ad in ((alice, "Alice"), (bob, "Bob"), (carol, "Carol")):
    ev = stat(tok)
    kis = stat(tok, "self")
    check(f"{ad}: my_personal == kisisel toplam",
          near(ev["my_personal"], kis["total"]),
          f'{ev["my_personal"]} != {kis["total"]}')


print("\n-- 7. ev payi yalnizca EV harcamalarindan --")
s = stat(alice)
check("Alice'in ev payi 30 (90/3)", near(s["my_share"], 30.0), s["my_share"])
check("kisi basi 30", near(s["per_person"], 30.0), s["per_person"])
check("uye sayisi 3", s["member_count"] == 3, s["member_count"])


print("\n-- 8. kategori dokumu kisiselde de pay kadar --")
kis = stat(alice, "self")
toplam = round(sum(x["total"] for x in kis["categories"]), 2)
check("kategori toplami kisisel toplama esit", near(toplam, kis["total"]),
      f'{toplam} != {kis["total"]}')


print("\n-- temizlik --")
for tok in (bob, carol, alice):
    c.post(f"{API}/households/leave", headers=hdr(tok))
    c.post(f"{API}/auth/logout", headers=hdr(tok))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
