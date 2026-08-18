"""Kapanmis donem donuyor mu?

Test edilen hata: kapali bir donemin bakiyeleri her istekte bastan
hesaplaniyordu ve hesap evin BUGUNKU uye listesini kullaniyordu. Yani

  - donem kapandiktan SONRA eve katilan biri, o kapali donemin bolusmesine
    geriye donuk olarak giriyor ve kisi basi tutar degisiyordu,
  - donem boyunca uye olan ama hic harcama yapmamis birisi cikarilinca o
    donemden tamamen dusuyor ve payi kalanlara dagiliyordu.

Ikisi de sessizce yanlis rakam uretiyordu; kimse fark etmeden gecmis
hesaplasmalar degisiyordu.
"""
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
        "email": f"fr_{who}_{TAG}@odahesap-e2e.com",
        "password": "sifre123", "name": who.title()})
    r.raise_for_status()
    return r.json()["session_token"], r.json()["user"]["user_id"]


def katil(token, uid, kod, yonetici):
    c.post(f"{API}/households/join", headers=hdr(token), json={"invite_code": kod})
    c.post(f"{API}/households/approve", headers=hdr(yonetici), json={"user_id": uid})


print("== kurulum: 2 kisilik ev, 100 EUR ortak harcama ==")
alice, alice_id = reg("alice")
bob, bob_id = reg("bob")
carol, carol_id = reg("carol")
dave, dave_id = reg("dave")

r = c.post(f"{API}/households", headers=hdr(alice), json={"name": f"Donma Ev {TAG}"})
kod = r.json()["household"]["invite_code"]
katil(bob, bob_id, kod, alice)

c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "household", "total": 100.0, "source": "manual", "items": []})

bal = c.get(f"{API}/balances", headers=hdr(alice)).json()
check("acik donemde Alice +50", abs(bal["net"][alice_id] - 50) < 0.01, str(bal["net"]))
check("acik donemde Bob -50", abs(bal["net"][bob_id] + 50) < 0.01, str(bal["net"]))

print("\n== odesiliyor, donem KENDILIGINDEN kapaniyor ==")
# Tur 10: donem elle kapatilamiyor. Bakiye sifira deginceye kadar acik
# kaliyor, degince kendiliginden kapaniyor -- boylece kapanista kaybolan
# bir borc olmuyor.
odes(c, API, {alice_id: alice, bob_id: bob})
kapali = kapali_donem(c, API, alice)
check("odesince donem kapandi", kapali is not None, "kapali donem bulunamadi")
acik = c.get(f"{API}/balances", headers=hdr(alice)).json()
check("yeni donem bos", all(abs(v) < 0.01 for v in acik["net"].values()), str(acik["net"]))

don = c.get(f"{API}/balances?period_id={kapali}", headers=hdr(alice)).json()
# Yeni modelde kapali donem = ODESILMIS donem, yani net her zaman sifir.
# Sifirin kendisi iyi bir parmak izi: uye listesi sonradan degisseydi paylar
# da degisirdi ve kaydedilmis olan 50'lik odeme bakiyeyi sifira goturmezdi.
# Odenen toplam ise odesmeden etkilenmiyor, ikinci capa o.
check("kapali donem odesmis", all(abs(v) < 0.01 for v in don["net"].values()), str(don["net"]))
check("kapali donemde 2 kisi var", len(don["net"]) == 2, str(don["net"]))
check("Alice'in odedigi 100", abs(don["totals_paid"][alice_id] - 100) < 0.01,
      str(don["totals_paid"]))

print("\n== SONRADAN katilan biri gecmisi degistirmemeli ==")
katil(carol, carol_id, kod, alice)

don2 = c.get(f"{API}/balances?period_id={kapali}", headers=hdr(alice)).json()
check("kapali donem hala 2 kisilik", len(don2["net"]) == 2, str(don2["net"]))
check("Carol kapali doneme girmedi", carol_id not in don2["net"], str(don2["net"]))
check("kapali donem hala odesmis (33.33'e bolunmedi)",
      all(abs(v) < 0.01 for v in don2["net"].values()), str(don2["net"]))
check("Alice'in odedigi hala 100", abs(don2["totals_paid"][alice_id] - 100) < 0.01,
      str(don2["totals_paid"]))

akt = c.get(f"{API}/balances", headers=hdr(alice)).json()
check("Carol AKTIF doneme girdi", carol_id in akt["net"], str(akt["net"]))

print("\n== hic harcama yapmamis uye cikarilinca payi kaybolmamali ==")
# Dave aktif doneme katiliyor, hic harcama yapmiyor, sonra cikariliyor.
katil(dave, dave_id, kod, alice)
akt = c.get(f"{API}/balances", headers=hdr(alice)).json()
check("Dave aktif donemde", dave_id in akt["net"], str(akt["net"]))

c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "household", "total": 120.0, "source": "manual", "items": []})
akt = c.get(f"{API}/balances", headers=hdr(alice)).json()
# 4 kisi (Alice, Bob, Carol, Dave) -> kisi basi 30
check("4 kisiye bolundu, Alice +90", abs(akt["net"][alice_id] - 90) < 0.01, str(akt["net"]))

r = c.post(f"{API}/households/remove-member", headers=hdr(alice), json={"user_id": dave_id})
check("hic harcamasi olmayan uye cikarilabildi", r.status_code == 200, r.text[:120])

akt = c.get(f"{API}/balances", headers=hdr(alice)).json()
check("Dave donemde kaldi (payi buharlasmadi)", dave_id in akt["net"], str(akt["net"]))
check("Alice hala +90 (3'e bolunmedi)", abs(akt["net"][alice_id] - 90) < 0.01, str(akt["net"]))
check("Dave -30 borclu", abs(akt["net"][dave_id] + 30) < 0.01, str(akt["net"]))

print("\n== temizlik ==")
for t in (alice, bob, carol):
    c.post(f"{API}/households/leave", headers=hdr(t))
    c.post(f"{API}/auth/logout", headers=hdr(t))
c.post(f"{API}/auth/logout", headers=hdr(dave))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
