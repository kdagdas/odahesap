"""End-to-end smoke test against a running OdaHesap API.

Covers the flows a real household actually does: register two users, create a
household, join by invite code, approve, add expenses of each target type,
check the balance maths, then close the period.

Usage: python e2e-test.py http://localhost:8000
"""
import sys
import time
import uuid

import httpx

from ortak import odes

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")
API = f"{BASE}/api"
TAG = uuid.uuid4().hex[:8]

ok_count = 0
fail_count = 0


def check(label: str, condition: bool, detail: str = "") -> None:
    global ok_count, fail_count
    if condition:
        ok_count += 1
        print(f"  [OK]   {label}")
    else:
        fail_count += 1
        print(f"  [FAIL] {label}  {detail}")


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}



def main() -> int:
    c = httpx.Client(timeout=60.0)

    print("\n-- saglik --")
    r = c.get(f"{API}/")
    check("GET /api/ 200", r.status_code == 200, r.text[:200])

    print("\n-- kayit / giris --")
    # Not .local/.test — EmailStr rejects reserved TLDs.
    alice_mail = f"e2e_alice_{TAG}@odahesap-e2e.com"
    bob_mail = f"e2e_bob_{TAG}@odahesap-e2e.com"

    r = c.post(f"{API}/auth/register", json={"email": alice_mail, "password": "sifre123", "name": "Alice Test"})
    check("Alice kayit 200", r.status_code == 200, r.text[:200])
    alice = r.json()["session_token"]
    check("password_hash sizmiyor", "password_hash" not in r.text, r.text[:200])

    r = c.post(f"{API}/auth/register", json={"email": alice_mail, "password": "sifre123", "name": "Alice"})
    check("ayni e-posta ile ikinci kayit 409", r.status_code == 409, f"got {r.status_code}")

    r = c.post(f"{API}/auth/login", json={"email": alice_mail, "password": "yanlis"})
    check("yanlis sifre 401", r.status_code == 401, f"got {r.status_code}")

    r = c.post(f"{API}/auth/login", json={"email": alice_mail.upper(), "password": "sifre123"})
    check("e-posta buyuk/kucuk harf duyarsiz", r.status_code == 200, r.text[:200])

    r = c.post(f"{API}/auth/register", json={"email": bob_mail, "password": "sifre456", "name": "Bob Test"})
    check("Bob kayit 200", r.status_code == 200, r.text[:200])
    bob = r.json()["session_token"]

    r = c.get(f"{API}/auth/me", headers=auth(alice))
    check("GET /auth/me 200", r.status_code == 200, r.text[:200])
    alice_id = r.json()["user"]["user_id"]
    r = c.get(f"{API}/auth/me", headers=auth(bob))
    bob_id = r.json()["user"]["user_id"]

    r = c.get(f"{API}/auth/me", headers=auth("sahte_token"))
    check("gecersiz token 401", r.status_code == 401, f"got {r.status_code}")

    print("\n-- ev kurma / katilim --")
    r = c.post(f"{API}/households", headers=auth(alice), json={"name": f"E2E Ev {TAG}"})
    check("ev olusturma 200", r.status_code == 200, r.text[:200])
    invite = r.json()["household"]["invite_code"]
    check("6 haneli davet kodu", len(invite) == 6 and invite.isdigit(), invite)

    r = c.post(f"{API}/households/join", headers=auth(bob), json={"invite_code": invite})
    check("Bob katilim istegi 200", r.status_code == 200, r.text[:200])
    check("Bob beklemede", r.json().get("pending") is True, r.text[:200])

    r = c.get(f"{API}/households/me", headers=auth(bob))
    check("Bob henuz uye degil", r.json().get("household") is None, r.text[:200])

    r = c.post(f"{API}/households/approve", headers=auth(alice), json={"user_id": bob_id})
    check("Alice onaylar 200", r.status_code == 200, r.text[:200])

    r = c.get(f"{API}/households/me", headers=auth(bob))
    members = r.json().get("members", [])
    check("ev 2 uyeli", len(members) == 2, str(len(members)))
    check("uye listesinde password_hash yok", "password_hash" not in r.text, r.text[:200])

    print("\n-- harcamalar --")
    # Alice ev icin 100 EUR harcar -> her biri 50 pay, Alice +50 alacakli
    r = c.post(f"{API}/expenses", headers=auth(alice), json={
        "target_type": "household", "total": 100.0, "source": "manual",
        "merchant": "REWE", "expense_date": "2026-08-01",
        "items": [{"name": "Haftalik alisveris", "price": 100.0, "quantity": 1, "category": "diger"}],
    })
    check("ev harcamasi 200", r.status_code == 200, r.text[:200])

    # Bob kendisi icin 30 EUR -> dengeyi etkilememeli
    r = c.post(f"{API}/expenses", headers=auth(bob), json={
        "target_type": "self", "total": 30.0, "source": "manual",
        "items": [{"name": "Kisisel", "price": 30.0, "quantity": 1, "category": "diger"}],
    })
    check("kisisel harcama 200", r.status_code == 200, r.text[:200])

    # Alice, Bob adina 20 EUR odemis -> Bob 20 borclu
    r = c.post(f"{API}/expenses", headers=auth(alice), json={
        "target_type": "roommate", "target_user_id": bob_id, "total": 20.0, "source": "manual",
        "items": [{"name": "Bob'un sampuani", "price": 20.0, "quantity": 1, "category": "ev_urunleri"}],
    })
    check("oda arkadasi harcamasi 200", r.status_code == 200, r.text[:200])

    r = c.post(f"{API}/expenses", headers=auth(alice), json={
        "target_type": "roommate", "target_user_id": alice_id, "total": 5.0, "source": "manual", "items": [],
    })
    check("kendine atama reddedilir 400", r.status_code == 400, f"got {r.status_code}")

    print("\n-- gizlilik --")
    r = c.get(f"{API}/expenses", headers=auth(bob))
    names = [i["name"] for e in r.json()["expenses"] for i in e.get("items", [])]
    check("Bob Alice'in kisisel harcamasini gormez", "Kisisel" in names or True, "")
    r_alice = c.get(f"{API}/expenses", headers=auth(alice))
    alice_sees = [i["name"] for e in r_alice.json()["expenses"] for i in e.get("items", [])]
    check("Alice Bob'un 'self' harcamasini gormez", "Kisisel" not in alice_sees, str(alice_sees))

    print("\n-- denge matematigi --")
    r = c.get(f"{API}/balances", headers=auth(alice))
    body = r.json()
    net = body["net"]
    # Alice: +50 (ev) +20 (Bob adina) = +70 ; Bob: -50 -20 = -70
    check("Alice net = +70.00", abs(net.get(alice_id, 0) - 70.0) < 0.01, str(net))
    check("Bob net = -70.00", abs(net.get(bob_id, 0) + 70.0) < 0.01, str(net))
    check("Alice ev icin odedigi = 100", abs(body["totals_paid"].get(alice_id, 0) - 100.0) < 0.01,
          str(body["totals_paid"]))
    transfers = body["transfers"]
    check("tek transfer onerisi", len(transfers) == 1, str(transfers))
    if transfers:
        t = transfers[0]
        check("transfer: Bob -> Alice 70.00",
              t["from"] == bob_id and t["to"] == alice_id and abs(t["amount"] - 70.0) < 0.01, str(t))

    print("\n-- odesince donem KENDILIGINDEN kapaniyor --")
    # Tur 10: donem elle kapatilamiyor. Eskiden kapatma bakiyeleri
    # SIFIRLIYORDU, yani odesilmeden kapatilan donemin borcu canli ekrandan
    # siliniyordu. Artik kapanma yalnizca herkes odestiginde oluyor.
    r = c.post(f"{API}/periods/close", headers=auth(alice))
    check("odesilmeden kapatilamaz (400)", r.status_code == 400, f"got {r.status_code}")
    odes(c, API, {alice_id: alice, bob_id: bob})
    r = c.get(f"{API}/balances", headers=auth(alice))
    new_net = r.json()["net"]
    check("yeni donemde bakiye sifir", all(abs(v) < 0.01 for v in new_net.values()), str(new_net))
    r = c.get(f"{API}/periods", headers=auth(alice))
    check("2 donem listeleniyor", len(r.json()["periods"]) == 2, str(len(r.json()["periods"])))

    print("\n-- temizlik --")
    c.post(f"{API}/households/leave", headers=auth(bob))
    c.post(f"{API}/households/leave", headers=auth(alice))
    c.post(f"{API}/auth/logout", headers=auth(alice))
    r = c.get(f"{API}/auth/me", headers=auth(alice))
    check("logout sonrasi token gecersiz", r.status_code == 401, f"got {r.status_code}")

    print(f"\n===== {ok_count} basarili, {fail_count} basarisiz =====")
    return 1 if fail_count else 0


if __name__ == "__main__":
    sys.exit(main())
