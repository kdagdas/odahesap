"""Odemeyi isaretle + harcama duzenleme testi."""
import sys
import uuid

import httpx

from ortak import kapali_donem, odes

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


def hdr(t):
    return {"Authorization": f"Bearer {t}"}


c = httpx.Client(timeout=90.0)


def reg(who):
    r = c.post(f"{API}/auth/register", json={
        "email": f"se_{who}_{TAG}@odahesap-e2e.com", "password": "sifre123", "name": who.title()})
    r.raise_for_status()
    return r.json()["session_token"], r.json()["user"]["user_id"]


alice, alice_id = reg("alice")
bob, bob_id = reg("bob")
carol, carol_id = reg("carol")

r = c.post(f"{API}/households", headers=hdr(alice), json={"name": f"Odesme Ev {TAG}"})
invite = r.json()["household"]["invite_code"]
for tok, uid in ((bob, bob_id), (carol, carol_id)):
    c.post(f"{API}/households/join", headers=hdr(tok), json={"invite_code": invite})
    c.post(f"{API}/households/approve", headers=hdr(alice), json={"user_id": uid})

print("\n-- baslangic dengesi --")
# Alice 90 EUR ev harcamasi -> kisi basi 30. Alice +60, Bob -30, Carol -30
r = c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "household", "total": 90.0, "source": "manual",
    "merchant": "REWE", "expense_date": "2026-08-01",
    "items": [{"name": "Alisveris", "price": 90.0, "quantity": 1, "category": "diger"}]})
exp_id = r.json()["expense"]["expense_id"]
net = c.get(f"{API}/balances", headers=hdr(alice)).json()["net"]
check("Alice +60", abs(net[alice_id] - 60) < 0.01, str(net))
check("Bob -30", abs(net[bob_id] + 30) < 0.01, str(net))

print("\n-- harcama duzenleme --")
r = c.patch(f"{API}/expenses/{exp_id}", headers=hdr(bob), json={"total": 30.0})
check("baskasi duzenleyemez (403)", r.status_code == 403, f"got {r.status_code}")
r = c.patch(f"{API}/expenses/{exp_id}", headers=hdr(alice), json={"total": 60.0, "merchant": "EDEKA"})
check("sahibi duzenleyebilir", r.status_code == 200, r.text[:200])
check("market guncellendi", r.json()["expense"]["merchant"] == "EDEKA", r.text[:200])
net = c.get(f"{API}/balances", headers=hdr(alice)).json()["net"]
check("denge yeniden hesaplandi (Alice +40)", abs(net[alice_id] - 40) < 0.01, str(net))
r = c.patch(f"{API}/expenses/{exp_id}", headers=hdr(alice), json={"total": -5})
check("negatif tutar reddedilir (400)", r.status_code == 400, f"got {r.status_code}")
r = c.patch(f"{API}/expenses/{exp_id}", headers=hdr(alice), json={"expense_date": "abc"})
check("bozuk tarih reddedilir (400)", r.status_code == 400, f"got {r.status_code}")
r = c.patch(f"{API}/expenses/{exp_id}", headers=hdr(alice), json={"expense_date": "15.08.2026"})
check("GG.AA.YYYY kabul edilir", r.json()["expense"]["expense_date"] == "2026-08-15", r.text[:200])

# 90'a geri al: Alice +60, Bob -30, Carol -30
c.patch(f"{API}/expenses/{exp_id}", headers=hdr(alice), json={"total": 90.0})

print("\n-- odemeyi isaretle --")
r = c.post(f"{API}/settlements", headers=hdr(carol),
           json={"from_user_id": bob_id, "to_user_id": alice_id, "amount": 30.0})
check("ilgisiz kisi isaretleyemez (403)", r.status_code == 403, f"got {r.status_code}")
r = c.post(f"{API}/settlements", headers=hdr(bob),
           json={"from_user_id": bob_id, "to_user_id": bob_id, "amount": 10.0})
check("kendine odeme reddedilir (400)", r.status_code == 400, f"got {r.status_code}")

r = c.post(f"{API}/settlements", headers=hdr(bob),
           json={"from_user_id": bob_id, "to_user_id": alice_id, "amount": 30.0})
check("borclu odemesini isaretleyebilir", r.status_code == 200, r.text[:200])
stl_id = r.json()["settlement"]["settlement_id"]

bal = c.get(f"{API}/balances", headers=hdr(alice)).json()
net = bal["net"]
check("Bob odedi, dengesi sifirlandi", abs(net[bob_id]) < 0.01, str(net))
check("Alice alacagi 30'a dustu", abs(net[alice_id] - 30) < 0.01, str(net))
check("Carol etkilenmedi (-30)", abs(net[carol_id] + 30) < 0.01, str(net))
transfers = bal["transfers"]
check("kalan tek transfer: Carol -> Alice",
      len(transfers) == 1 and transfers[0]["from"] == carol_id
      and abs(transfers[0]["amount"] - 30) < 0.01, str(transfers))
check("settled_paid dondu", abs(bal["settled_paid"][bob_id] - 30) < 0.01, str(bal.get("settled_paid")))

print("\n-- kismi odeme --")
r = c.post(f"{API}/settlements", headers=hdr(alice),
           json={"from_user_id": carol_id, "to_user_id": alice_id, "amount": 10.0})
check("alacakli da isaretleyebilir", r.status_code == 200, r.text[:200])
net = c.get(f"{API}/balances", headers=hdr(alice)).json()["net"]
check("Carol kismi odedi (-20 kaldi)", abs(net[carol_id] + 20) < 0.01, str(net))

print("\n-- odeme kaydini geri alma --")
r = c.delete(f"{API}/settlements/{stl_id}", headers=hdr(carol))
check("taraf olmayan silemez (403)", r.status_code == 403, f"got {r.status_code}")
r = c.delete(f"{API}/settlements/{stl_id}", headers=hdr(bob))
check("taraf silebilir", r.status_code == 200, r.text[:200])
net = c.get(f"{API}/balances", headers=hdr(alice)).json()["net"]
check("Bob'un borcu geri geldi (-30)", abs(net[bob_id] + 30) < 0.01, str(net))

print("\n-- odesilmis donem korumasi --")
# Tur 10: donem elle kapatilmiyor, herkes odesince kendiliginden kapaniyor.
# Yani "kapali donem" artik "odesilmis donem" demek ve dokunulmazligin
# gerekcesi de bu: odesilmis rakamlar sonradan degismemeli.
odes(c, API, {alice_id: alice, bob_id: bob, carol_id: carol})
check("odesince donem kapandi", kapali_donem(c, API, alice) is not None, "kapali donem yok")
r = c.patch(f"{API}/expenses/{exp_id}", headers=hdr(alice), json={"total": 5.0})
check("kapali donemde duzenlenemez (400)", r.status_code == 400, f"got {r.status_code}")
check("sebep aciklaniyor", "dönem" in r.text.lower() or "donem" in r.text.lower(), r.text[:200])
r = c.delete(f"{API}/expenses/{exp_id}", headers=hdr(alice))
check("kapali donemde SILINEMEZ (400)", r.status_code == 400, f"got {r.status_code}")

print("\n-- temizlik --")
for t in (alice, bob, carol):
    c.post(f"{API}/households/leave", headers=hdr(t))
    c.post(f"{API}/auth/logout", headers=hdr(t))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
