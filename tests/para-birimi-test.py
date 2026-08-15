"""Ulke ve para birimi.

Bir ev = bir para birimi. Karisirsa toplama islemi anlamsizlasir: 40 EUR ile
500 TL toplanamaz, bolunemez, "kim kime borclu" hesaplanamaz. Bu yuzden para
birimi harcamanin degil EVIN ozelligi; fisten okunan sembol kaynak degil,
denetim olarak kullaniliyor.
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
        "email": f"cur_{who}_{TAG}@odahesap-e2e.com",
        "password": "sifre123", "name": who.title()})
    r.raise_for_status()
    return r.json()["session_token"], r.json()["user"]["user_id"]


print("== varsayilan: Almanya / EUR ==")
alice, alice_id = reg("alice")
r = c.post(f"{API}/households", headers=hdr(alice), json={"name": f"DE Ev {TAG}"})
hh = r.json()["household"]
check("ulke DE", hh.get("country") == "DE", str(hh.get("country")))
check("para birimi EUR", hh.get("currency") == "EUR", str(hh.get("currency")))

print("\n== Turkiye secilince TRY ==")
bob, bob_id = reg("bob")
r = c.post(f"{API}/households", headers=hdr(bob), json={"name": f"TR Ev {TAG}", "country": "TR"})
hh2 = r.json()["household"]
check("ulke TR", hh2.get("country") == "TR", str(hh2.get("country")))
check("para birimi TRY", hh2.get("currency") == "TRY", str(hh2.get("currency")))

print("\n== harcama evin para birimini aliyor ==")
r = c.post(f"{API}/expenses", headers=hdr(bob), json={
    "target_type": "household", "total": 500.0, "source": "manual",
    "currency": "EUR",   # istemci ne gonderirse gondersin
    "items": []})
check("harcama TRY olarak kaydedildi", r.json()["expense"]["currency"] == "TRY",
      str(r.json()["expense"]["currency"]))

print("\n== ayarlardan degistirme ==")
r = c.patch(f"{API}/households", headers=hdr(alice), json={"country": "TR"})
check("ulke degisti", r.json()["household"]["country"] == "TR", str(r.json()["household"]))
check("para birimi de degisti", r.json()["household"]["currency"] == "TRY", str(r.json()["household"]))

r = c.patch(f"{API}/households", headers=hdr(alice), json={"currency": "EUR"})
check("para birimi ayrica secilebiliyor", r.json()["household"]["currency"] == "EUR",
      str(r.json()["household"]["currency"]))
check("ulke degismedi", r.json()["household"]["country"] == "TR",
      str(r.json()["household"]["country"]))

print("\n== ad degistirme hala calisiyor ==")
r = c.patch(f"{API}/households", headers=hdr(alice), json={"name": "Yeni Ad"})
check("ad degisti", r.json()["household"]["name"] == "Yeni Ad", str(r.json()["household"]["name"]))
check("para birimi bozulmadi", r.json()["household"]["currency"] == "EUR",
      str(r.json()["household"]["currency"]))

print("\n== gecersiz degerler reddediliyor ==")
r = c.patch(f"{API}/households", headers=hdr(alice), json={"country": "FR"})
check("bilinmeyen ulke reddedildi", r.status_code == 422, str(r.status_code))
r = c.patch(f"{API}/households", headers=hdr(alice), json={})
check("bos istek reddedildi", r.status_code == 400, str(r.status_code))

print("\n== yonetici olmayan degistiremez ==")
carol, carol_id = reg("carol")
kod = c.get(f"{API}/households/me", headers=hdr(alice)).json()["household"]["invite_code"]
c.post(f"{API}/households/join", headers=hdr(carol), json={"invite_code": kod})
c.post(f"{API}/households/approve", headers=hdr(alice), json={"user_id": carol_id})
r = c.patch(f"{API}/households", headers=hdr(carol), json={"currency": "TRY"})
check("uye para birimini degistiremiyor", r.status_code == 403, str(r.status_code))

print("\n== temizlik ==")
for t in (alice, bob, carol):
    c.post(f"{API}/households/leave", headers=hdr(t))
    c.post(f"{API}/auth/logout", headers=hdr(t))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
