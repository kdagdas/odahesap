"""Yonetici rolu, ev adi degistirme, yoneticilik devri ve donem geri alma testi."""
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
        "email": f"adm_{who}_{TAG}@odahesap-e2e.com", "password": "sifre123", "name": f"{who.title()} Test"})
    r.raise_for_status()
    return r.json()["session_token"], r.json()["user"]["user_id"]


alice, alice_id = reg("alice")   # ev sahibi / yonetici
bob, bob_id = reg("bob")         # normal uye
carol, carol_id = reg("carol")   # katilmak isteyen

print("\n-- ev kurulumu --")
r = c.post(f"{API}/households", headers=hdr(alice), json={"name": f"Admin Ev {TAG}"})
check("ev olusturuldu", r.status_code == 200, r.text[:200])
invite = r.json()["household"]["invite_code"]

r = c.get(f"{API}/households/me", headers=hdr(alice))
check("kurucu yonetici olarak isaretli", r.json().get("is_admin") is True, r.text[:200])

c.post(f"{API}/households/join", headers=hdr(bob), json={"invite_code": invite})
c.post(f"{API}/households/approve", headers=hdr(alice), json={"user_id": bob_id})
r = c.get(f"{API}/households/me", headers=hdr(bob))
check("uye yonetici degil", r.json().get("is_admin") is False, r.text[:200])

print("\n-- onay yetkisi --")
c.post(f"{API}/households/join", headers=hdr(carol), json={"invite_code": invite})
r = c.post(f"{API}/households/approve", headers=hdr(bob), json={"user_id": carol_id})
check("normal uye onaylayamaz (403)", r.status_code == 403, f"got {r.status_code}")
r = c.post(f"{API}/households/reject", headers=hdr(bob), json={"user_id": carol_id})
check("normal uye reddedemez (403)", r.status_code == 403, f"got {r.status_code}")
r = c.post(f"{API}/households/approve", headers=hdr(alice), json={"user_id": carol_id})
check("yonetici onaylayabilir", r.status_code == 200, r.text[:200])

print("\n-- ev adi --")
r = c.patch(f"{API}/households", headers=hdr(bob), json={"name": "Bob'un Evi"})
check("normal uye ad degistiremez (403)", r.status_code == 403, f"got {r.status_code}")
r = c.patch(f"{API}/households", headers=hdr(alice), json={"name": "Yeni Ev Adi"})
check("yonetici ad degistirebilir", r.status_code == 200, r.text[:200])
r = c.get(f"{API}/households/me", headers=hdr(bob))
check("yeni ad herkese yansidi", r.json()["household"]["name"] == "Yeni Ev Adi", r.text[:200])

print("\n-- donem kapatma --")
c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "household", "total": 60.0, "source": "manual",
    "items": [{"name": "Test", "price": 60.0, "quantity": 1, "category": "diger"}]})
r = c.post(f"{API}/periods/close", headers=hdr(bob))
check("normal uye donem kapatamaz (403)", r.status_code == 403, f"got {r.status_code}")
# Tur 10: yonetici bile odesilmeden kapatamiyor. Kural sunucuda, cunku
# sahadaki eski surumlerde kapatma dugmesi hala duruyor.
r = c.post(f"{API}/periods/close", headers=hdr(alice))
check("yonetici de odesilmeden kapatamaz (400)", r.status_code == 400, f"got {r.status_code}")
check("sebep aciklaniyor", "ödeş" in r.text.lower(), r.text[:200])
odes(c, API, {alice_id: alice, bob_id: bob, carol_id: carol})
r = c.get(f"{API}/periods", headers=hdr(alice))
check("odesince 2 donem var", len(r.json()["periods"]) == 2, str(len(r.json()["periods"])))

print("\n-- donem geri alma --")
r = c.post(f"{API}/periods/reopen", headers=hdr(bob))
check("normal uye geri alamaz (403)", r.status_code == 403, f"got {r.status_code}")
r = c.post(f"{API}/periods/reopen", headers=hdr(alice))
check("yonetici geri alabilir", r.status_code == 200, r.text[:200])
r = c.get(f"{API}/periods", headers=hdr(alice))
check("donem sayisi 1'e dondu", len(r.json()["periods"]) == 1, str(len(r.json()["periods"])))
r = c.get(f"{API}/balances", headers=hdr(alice))
body = r.json()
# Harcama geri geldi: Alice'in odedigi 60 hala orada. Bakiye ise SIFIR,
# cunku donem odesildigi icin kapanmisti ve odeme kayitlari da geri geldi.
check("eski harcama geri geldi (Alice 60 odemis)",
      abs(body["totals_paid"].get(alice_id, 0) - 60.0) < 0.01, str(body["totals_paid"]))
check("odemeler de geri geldi (net sifir)",
      all(abs(v) < 0.01 for v in body["net"].values()), str(body["net"]))

print("\n-- dolu doneme geri alma engeli --")
c.post(f"{API}/periods/close", headers=hdr(alice))
c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "household", "total": 15.0, "source": "manual",
    "items": [{"name": "Yeni donem harcamasi", "price": 15.0, "quantity": 1, "category": "diger"}]})
r = c.post(f"{API}/periods/reopen", headers=hdr(alice))
check("dolu donemde geri alma reddedilir (400)", r.status_code == 400, f"got {r.status_code}")
check("hata mesaji sebebi aciklıyor", "harcama" in r.text.lower(), r.text[:200])

print("\n-- yoneticilik devri --")
r = c.post(f"{API}/households/transfer-admin", headers=hdr(bob), json={"user_id": bob_id})
check("normal uye devredemez (403)", r.status_code == 403, f"got {r.status_code}")
r = c.post(f"{API}/households/transfer-admin", headers=hdr(alice), json={"user_id": "user_yok"})
check("uye olmayana devir reddedilir (404)", r.status_code == 404, f"got {r.status_code}")
r = c.post(f"{API}/households/transfer-admin", headers=hdr(alice), json={"user_id": bob_id})
check("yonetici devredebilir", r.status_code == 200, r.text[:200])
r = c.get(f"{API}/households/me", headers=hdr(bob))
check("Bob artik yonetici", r.json().get("is_admin") is True, r.text[:200])
r = c.get(f"{API}/households/me", headers=hdr(alice))
check("Alice artik yonetici degil", r.json().get("is_admin") is False, r.text[:200])
r = c.patch(f"{API}/households", headers=hdr(alice), json={"name": "Geri Al"})
check("eski yonetici yetkisini kaybetti (403)", r.status_code == 403, f"got {r.status_code}")

print("\n-- yonetici evden ayrilirsa --")
c.post(f"{API}/households/leave", headers=hdr(bob))
r = c.get(f"{API}/households/me", headers=hdr(alice))
check("yoneticilik kalan uyeye gecti", r.json().get("is_admin") is True, r.text[:200])

print("\n-- temizlik --")
for t in (alice, carol):
    c.post(f"{API}/households/leave", headers=hdr(t))
    c.post(f"{API}/auth/logout", headers=hdr(t))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
