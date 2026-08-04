"""Uyeyi evden cikarma testi.

Kritik nokta: cikarilan kisinin gecmis donemdeki payi buharlasmamali.
3 kisilik evde 90 EUR ortak harcama -> kisi basi 30. Carol cikarildiktan
sonra o kapali donem hala 3'e bolunmus gorunmeli, 2'ye degil.
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


def hdr(t):
    return {"Authorization": f"Bearer {t}"}


c = httpx.Client(timeout=90.0)


def reg(who):
    r = c.post(f"{API}/auth/register", json={
        "email": f"rm_{who}_{TAG}@odahesap-e2e.com", "password": "sifre123", "name": f"{who.title()}"})
    r.raise_for_status()
    return r.json()["session_token"], r.json()["user"]["user_id"]


alice, alice_id = reg("alice")
bob, bob_id = reg("bob")
carol, carol_id = reg("carol")

r = c.post(f"{API}/households", headers=hdr(alice), json={"name": f"Cikarma Ev {TAG}"})
invite = r.json()["household"]["invite_code"]
for tok, uid in ((bob, bob_id), (carol, carol_id)):
    c.post(f"{API}/households/join", headers=hdr(tok), json={"invite_code": invite})
    c.post(f"{API}/households/approve", headers=hdr(alice), json={"user_id": uid})

print("\n-- yetki --")
r = c.post(f"{API}/households/remove-member", headers=hdr(bob), json={"user_id": carol_id})
check("normal uye cikaramaz (403)", r.status_code == 403, f"got {r.status_code}")
r = c.post(f"{API}/households/remove-member", headers=hdr(alice), json={"user_id": alice_id})
check("yonetici kendini cikaramaz (400)", r.status_code == 400, f"got {r.status_code}")
r = c.post(f"{API}/households/remove-member", headers=hdr(alice), json={"user_id": "user_yok"})
check("uye olmayan icin 404", r.status_code == 404, f"got {r.status_code}")

print("\n-- acik donemde harcamasi varken --")
c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "household", "total": 90.0, "source": "manual",
    "items": [{"name": "Ortak alisveris", "price": 90.0, "quantity": 1, "category": "diger"}]})
c.post(f"{API}/expenses", headers=hdr(carol), json={
    "target_type": "household", "total": 30.0, "source": "manual",
    "items": [{"name": "Carol'un aldigi", "price": 30.0, "quantity": 1, "category": "diger"}]})
r = c.post(f"{API}/households/remove-member", headers=hdr(alice), json={"user_id": carol_id})
check("harcamasi varken cikarilamaz (400)", r.status_code == 400, f"got {r.status_code}")
check("hata mesaji sebebi soyluyor", "harcama" in r.text.lower(), r.text[:200])

print("\n-- kapali donemin dogrulugu --")
r = c.get(f"{API}/balances", headers=hdr(alice))
onceki_net = r.json()["net"]
# Ev toplami 120, 3 kisi -> kisi basi 40. Alice +50, Bob -40, Carol -10.
check("Alice +50 (kapatmadan once)", abs(onceki_net.get(alice_id, 0) - 50.0) < 0.01, str(onceki_net))
check("Carol -10 (kapatmadan once)", abs(onceki_net.get(carol_id, 0) + 10.0) < 0.01, str(onceki_net))

r = c.post(f"{API}/periods/close", headers=hdr(alice))
check("donem kapatildi", r.status_code == 200, r.text[:200])
kapali_id = r.json()["closed_period_id"]

print("\n-- cikarma --")
r = c.post(f"{API}/households/remove-member", headers=hdr(alice), json={"user_id": carol_id})
check("donem kapaninca cikarilabiliyor", r.status_code == 200, r.text[:200])
r = c.get(f"{API}/households/me", headers=hdr(alice))
uyeler = [m["user_id"] for m in r.json()["members"]]
check("Carol uye listesinde yok", carol_id not in uyeler, str(uyeler))
check("ev 2 uyeli", len(uyeler) == 2, str(len(uyeler)))

print("\n-- cikarilan kisinin erisimi --")
r = c.get(f"{API}/households/me", headers=hdr(carol))
check("Carol artik evi gormuyor", r.json().get("household") is None, r.text[:200])
r = c.get(f"{API}/expenses", headers=hdr(carol))
check("Carol harcamalari gormuyor", len(r.json().get("expenses", [])) == 0, r.text[:200])

print("\n-- GECMIS DONEM BOZULMADI MI --")
r = c.get(f"{API}/balances?period_id={kapali_id}", headers=hdr(alice))
sonraki_net = r.json()["net"]
check("Alice hala +50 (3'e bolunmus)", abs(sonraki_net.get(alice_id, 0) - 50.0) < 0.01, str(sonraki_net))
check("Bob hala -40", abs(sonraki_net.get(bob_id, 0) + 40.0) < 0.01, str(sonraki_net))
check("Carol'un payi kayitta duruyor (-10)", abs(sonraki_net.get(carol_id, 0) + 10.0) < 0.01, str(sonraki_net))
isimler = {m["user_id"]: m["name"] for m in r.json().get("members", [])}
check("Carol'un ismi hala cozulebiliyor", carol_id in isimler, str(isimler))

print("\n-- temizlik --")
for t in (alice, bob, carol):
    c.post(f"{API}/households/leave", headers=hdr(t))
    c.post(f"{API}/auth/logout", headers=hdr(t))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
