"""Duzenli odemeler testi -- kira, elektrik, internet.

Korunan uc kural:

  1. **Takvim tarihli, donem degil.** Donem uc hafta da surebilir yedi hafta
     da; elektrik hep ayin 15'inde gelir.
  2. **Kapatmak asla sessizce eklemez.** Vadesi gelen sablon bir ONERI uretir,
     kayit degil. Yanlis eklenen bir kira, arkadaslar arasinda yanlis borc
     demek -- ve kimsenin gormedigi bir borc en kotusudur.
  3. **Ayni ay iki kez onaylanamaz.** Iki telefon ayni anda bildirimi gorup
     ikisi de onaylayabilir; kontrol sunucuda olmak zorunda.

    cd backend
    .venv/Scripts/python.exe ../tests/duzenli-test.py http://127.0.0.1:8093

Sunucuyu AYRI veritabaniyla baslatin: DB_NAME=odahesap_test
"""
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
TODAY = date.today()
BU_AY = f"{TODAY.year:04d}-{TODAY.month:02d}"


def reg(who):
    r = c.post(f"{API}/auth/register", json={
        "email": f"dz_{who}_{TAG}@odahesap-e2e.com",
        "password": "sifre123", "name": who.title()})
    r.raise_for_status()
    return r.json()["session_token"], r.json()["user"]["user_id"]


alice, alice_id = reg("alice")
bob, bob_id = reg("bob")
carol, carol_id = reg("carol")
r = c.post(f"{API}/households", headers=hdr(alice), json={"name": f"Duzenli Ev {TAG}"})
invite = r.json()["household"]["invite_code"]
for tok, uid in ((bob, bob_id), (carol, carol_id)):
    c.post(f"{API}/households/join", headers=hdr(tok), json={"invite_code": invite})
    c.post(f"{API}/households/approve", headers=hdr(alice), json={"user_id": uid})
print(f"3 kisilik ev kuruldu ({TAG}) · bugun {TODAY} · ay {BU_AY}")


def kur(tok, **body):
    return c.post(f"{API}/recurring", headers=hdr(tok), json=body)


def liste(tok):
    return c.get(f"{API}/recurring", headers=hdr(tok)).json()


def net(tok):
    return c.get(f"{API}/balances", headers=hdr(tok)).json()["net"]


print("\n-- 1. sablon kurma --")
# Vadesi GECMIS: ayin 1'i (ya da bugun kacinciysa o) -> hemen onay bekliyor
gecmis_gun = 1
r = kur(alice, name="Kira", amount=1200.0, day_of_month=gecmis_gun,
        amount_fixed=True, split_mode="exact",
        split_with={alice_id: 400.0, bob_id: 350.0, carol_id: 450.0},
        category="Kira")
check("kisiye ozel tutarli kira kuruldu", r.status_code == 200, r.text[:200])
kira = r.json()["recurring"]
check("vadesi gelmis olarak isaretlendi", kira["due_period"] == BU_AY, str(kira["due_period"]))

# Vadesi GELMEMIS: ayin son gunu (bugunden sonra olacak sekilde)
ileri_gun = min(28, TODAY.day + 2) if TODAY.day + 2 <= 28 else None
if ileri_gun and ileri_gun > TODAY.day:
    r = kur(alice, name="Internet", amount=39.99, day_of_month=ileri_gun,
            amount_fixed=True, category="İnternet")
    check("vadesi gelmemis sablon due degil",
          r.json()["recurring"]["due_period"] is None, str(r.json()["recurring"]))
else:
    check("vadesi gelmemis sablon due degil (ay sonu, atlandi)", True)

r = kur(bob, name="Elektrik", amount=90.0, day_of_month=gecmis_gun,
        amount_fixed=False, category="Elektrik")
elektrik = r.json()["recurring"]
check("degisken tutarli gider kuruldu", r.status_code == 200, r.text[:200])
check("bolusum verilmeyince tum ev", elektrik["split_mode"] == "equal"
      and len(elektrik["split_with"]) == 3, str(elektrik["split_with"]))

r = kur(carol, name="Spor salonu", amount=25.0, day_of_month=gecmis_gun,
        scope="self", category="Diğer")
spor = r.json()["recurring"]
check("kisisel gider kuruldu", r.status_code == 200, r.text[:200])
check("kisisel giderde liste yalnizca sahibi",
      list(spor["split_with"]) == [carol_id], str(spor["split_with"]))


print("\n-- 2. gorunurluk --")
check("ortak sablonlari Bob goruyor",
      {x["name"] for x in liste(bob)["recurring"]} >= {"Kira", "Elektrik"})
check("Carol'in kisisel gideri Bob'a gorunmuyor",
      "Spor salonu" not in {x["name"] for x in liste(bob)["recurring"]},
      str([x["name"] for x in liste(bob)["recurring"]]))
check("Carol kendi kisisel giderini goruyor",
      "Spor salonu" in {x["name"] for x in liste(carol)["recurring"]})


print("\n-- 3. onaylanana kadar HICBIR harcama olusmuyor --")
# Bu turun en onemli kurali: kapatmak sessizce eklemez.
n = net(alice)
check("vadesi gelmis 3 sablon var ama denge sifir",
      all(near(v, 0) for v in n.values()), str(n))
exps = c.get(f"{API}/expenses", headers=hdr(alice)).json()["expenses"]
check("hic harcama yok", len(exps) == 0, str(len(exps)))
due = liste(alice)["due"]
check("due listesinde bekleyenler var", len(due) >= 2, str([d["name"] for d in due]))


print("\n-- 4. onaylama --")
r = c.post(f"{API}/recurring/{kira['recurring_id']}/confirm", headers=hdr(alice),
           json={"period_key": BU_AY})
check("kira onaylandi", r.status_code == 200, r.text[:200])
exp = r.json()["expense"]
check("harcama sablona bagli", exp["recurring_id"] == kira["recurring_id"])
check("kisiye ozel bolusum tasindi", exp["split_mode"] == "exact"
      and near(exp["split_with"][bob_id], 350.0), str(exp["split_with"]))
n = net(alice)
check("Alice +1200-400 = +800", near(n[alice_id], 800.0), n)
check("Bob -350", near(n[bob_id], -350.0), n)
check("Carol -450", near(n[carol_id], -450.0), n)

check("onaylanan sablon due listesinden cikti",
      kira["recurring_id"] not in {d["recurring_id"] for d in liste(alice)["due"]})


print("\n-- 5. ayni ay iki kez onaylanamaz --")
r = c.post(f"{API}/recurring/{kira['recurring_id']}/confirm", headers=hdr(alice),
           json={"period_key": BU_AY})
check("ikinci onay reddedildi (409)", r.status_code == 409, f"{r.status_code} {r.text[:120]}")
r = c.post(f"{API}/recurring/{kira['recurring_id']}/confirm", headers=hdr(bob),
           json={"period_key": BU_AY})
check("baska bir uye de ikinci kez onaylayamiyor", r.status_code == 409,
      f"{r.status_code} {r.text[:120]}")
n = net(alice)
check("kira hala tek kez sayiliyor", near(n[alice_id], 800.0), n)


print("\n-- 6. degisken tutar onayda degistirilebiliyor --")
# Elektrik sablonda 90, bu ay 112,40 geldi. Once sablonu duzenlemeye zorlamak
# faturayi girmenin onune fazladan bir ekran koyar.
r = c.post(f"{API}/recurring/{elektrik['recurring_id']}/confirm", headers=hdr(bob),
           json={"period_key": BU_AY, "amount": 112.40})
check("farkli tutarla onaylandi", r.status_code == 200, r.text[:200])
check("harcama yeni tutari tasiyor", near(r.json()["expense"]["total"], 112.40))
n = net(alice)
check("Alice elektrikten -37,47", near(n[alice_id], 800.0 - 112.40 / 3), n)
tpl = next(x for x in liste(bob)["recurring"] if x["name"] == "Elektrik")
check("sablonun kendi tutari degismedi (90)", near(tpl["amount"], 90.0), str(tpl["amount"]))


print("\n-- 7. kisisel gider dengeye girmiyor --")
before = net(carol)
r = c.post(f"{API}/recurring/{spor['recurring_id']}/confirm", headers=hdr(carol),
           json={"period_key": BU_AY})
check("kisisel gider onaylandi", r.status_code == 200, r.text[:200])
check("etiket 'self'", r.json()["expense"]["target_type"] == "self",
      r.json()["expense"]["target_type"])
after = net(carol)
check("kimsenin dengesi degismedi",
      all(near(after[k], before[k]) for k in before), f"{before} -> {after}")
check("Alice bu harcamayi gormuyor",
      r.json()["expense"]["expense_id"] not in
      {e["expense_id"] for e in c.get(f"{API}/expenses", headers=hdr(alice)).json()["expenses"]})


print("\n-- 7b. odeyen secilebiliyor --")
# "Kirayi Salih oduyor ama uygulamayi ben giriyorum." Onaylamak izin vermek
# degil, "bu odendi" demek: olusan harcamanin odeyeni bakiyede ALACAKLI
# cikiyor. Yanlis kisi yazilirsa borc tersine doner.
r = kur(alice, name="Su", amount=60.0, day_of_month=gecmis_gun)
su = r.json()["recurring"]
before = net(alice)
r = c.post(f"{API}/recurring/{su['recurring_id']}/confirm", headers=hdr(alice),
           json={"period_key": BU_AY, "paid_by": bob_id})
check("Alice, Bob adina kaydetti", r.status_code == 200, r.text[:200])
exp = r.json()["expense"]
check("harcamanin odeyeni Bob", exp["added_by"] == bob_id, exp["added_by"])
check("kaydeden Alice olarak yazildi", exp.get("recorded_by") == alice_id, str(exp.get("recorded_by")))
after = net(alice)
check("Bob alacakli (+60-20)", near(after[bob_id] - before[bob_id], 40.0),
      f"{before[bob_id]} -> {after[bob_id]}")
check("Alice borclu (-20)", near(after[alice_id] - before[alice_id], -20.0),
      f"{before[alice_id]} -> {after[alice_id]}")

r = c.post(f"{API}/recurring/{su['recurring_id']}/confirm", headers=hdr(alice),
           json={"period_key": BU_AY, "paid_by": "user_yok"})
check("ev disindan odeyen reddedildi", r.status_code in (400, 409), f"{r.status_code}")

r = kur(carol, name="Kitap", amount=15.0, day_of_month=gecmis_gun, scope="self")
r = c.post(f"{API}/recurring/{r.json()['recurring']['recurring_id']}/confirm",
           headers=hdr(carol), json={"period_key": BU_AY, "paid_by": alice_id})
check("kisisel gider baskasi adina kaydedilemiyor", r.status_code == 400,
      f"{r.status_code} {r.text[:140]}")


print("\n-- 8. bu ay atla --")
r = kur(alice, name="Temizlikci", amount=60.0, day_of_month=gecmis_gun)
temizlik = r.json()["recurring"]
check("yeni sablon due", temizlik["due_period"] == BU_AY)
r = c.post(f"{API}/recurring/{temizlik['recurring_id']}/skip", headers=hdr(alice),
           json={"period_key": BU_AY})
check("atlandi", r.status_code == 200, r.text[:160])
check("due listesinden cikti",
      temizlik["recurring_id"] not in {d["recurring_id"] for d in liste(alice)["due"]})
check("atlamak harcama uretmedi",
      not any(e.get("recurring_id") == temizlik["recurring_id"]
              for e in c.get(f"{API}/expenses", headers=hdr(alice)).json()["expenses"]))


print("\n-- 9. yetki --")
r = c.patch(f"{API}/recurring/{kira['recurring_id']}", headers=hdr(bob),
            json={"amount": 1400.0})
check("kurmayan kisi degistiremiyor", r.status_code == 403, f"{r.status_code} {r.text[:120]}")
r = c.delete(f"{API}/recurring/{kira['recurring_id']}", headers=hdr(bob))
check("kurmayan kisi silemiyor", r.status_code == 403, f"{r.status_code}")
r = c.patch(f"{API}/recurring/{spor['recurring_id']}", headers=hdr(alice),
            json={"amount": 30.0})
check("baskasinin kisisel gideri gorunmuyor (404)", r.status_code == 404, f"{r.status_code}")
r = c.patch(f"{API}/recurring/{kira['recurring_id']}", headers=hdr(alice),
            json={"amount": 1300.0, "split_mode": "exact",
                  "split_with": {alice_id: 450.0, bob_id: 400.0, carol_id: 450.0}})
check("kuran kisi degistirebiliyor", r.status_code == 200, r.text[:200])
check("yeni tutar yazildi", near(r.json()["recurring"]["amount"], 1300.0))

r = c.patch(f"{API}/recurring/{kira['recurring_id']}", headers=hdr(alice),
            json={"amount": 1500.0})
check("kisiye ozel bolusum varken tutar tek basina degistirilemiyor",
      r.status_code == 400, f"{r.status_code} {r.text[:160]}")


print("\n-- 10. gecmis aylar geri uretilmiyor --")
# Iki ay uygulamayi acmayan bir ev girdiginde alti onay karti cikmasi yardim
# degil gurultu. Yalnizca icinde bulunulan ay bakiliyor.
gecen_ay = (TODAY.replace(day=1) - timedelta(days=1))
gecen = f"{gecen_ay.year:04d}-{gecen_ay.month:02d}"
due_aylar = {d["due_period"] for d in liste(alice)["due"]}
check("due listesinde yalnizca bu ay var", due_aylar <= {BU_AY}, str(due_aylar))
check("gecen ay onay bekleyen yok", gecen not in due_aylar, str(due_aylar))


print("\n-- 11. pasife alma --")
r = c.patch(f"{API}/recurring/{elektrik['recurring_id']}", headers=hdr(bob),
            json={"active": False})
check("pasife alindi", r.status_code == 200 and r.json()["recurring"]["active"] is False)
check("pasif sablon due uretmiyor",
      elektrik["recurring_id"] not in {d["recurring_id"] for d in liste(bob)["due"]})
check("pasif sablon listede duruyor",
      elektrik["recurring_id"] in {x["recurring_id"] for x in liste(bob)["recurring"]})


print("\n-- temizlik --")
for tok in (alice, bob, carol):
    c.post(f"{API}/households/leave", headers=hdr(tok))
    c.post(f"{API}/auth/logout", headers=hdr(tok))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
