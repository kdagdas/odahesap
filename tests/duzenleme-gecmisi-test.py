"""Harcama duzenleme gecmisi ve bildirimi.

Ev harcamasini yalnizca ekleyen kisi degistirebiliyor. Yani biri girdigi
tutari sonradan buyutup herkesin payini artirabilir ve kimsenin haberi olmaz.
Bu yuzden tutari ya da kime ait oldugunu degistiren her duzenleme kayda
geciyor ve ilgililere bildirim gidiyor.

Bildirimin kendisi FCM'e bagli oldugu icin burada dogrudan olculemez; testin
olctugu sey kayit (revisions) ve kimin ne gordugu.
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
        "email": f"rev_{who}_{TAG}@odahesap-e2e.com",
        "password": "sifre123", "name": who.title()})
    r.raise_for_status()
    return r.json()["session_token"], r.json()["user"]["user_id"]


alice, alice_id = reg("alice")
bob, bob_id = reg("bob")

r = c.post(f"{API}/households", headers=hdr(alice), json={"name": f"Rev Ev {TAG}"})
kod = r.json()["household"]["invite_code"]
c.post(f"{API}/households/join", headers=hdr(bob), json={"invite_code": kod})
c.post(f"{API}/households/approve", headers=hdr(alice), json={"user_id": bob_id})

print("== harcama ekle ==")
r = c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "household", "total": 100.0, "source": "manual",
    "merchant": "REWE", "notes": "ilk not",
    "items": [{"name": "Süt", "price": 100.0, "quantity": 1, "category": "sut_urunleri"}]})
eid = r.json()["expense"]["expense_id"]
check("harcama olustu", r.status_code == 200, r.text[:120])

rev = c.get(f"{API}/expenses/{eid}/revisions", headers=hdr(alice)).json()
check("baslangicta gecmis bos", rev["revisions"] == [], str(rev))

print("\n== onemsiz duzenleme kayda gecmemeli ==")
c.patch(f"{API}/expenses/{eid}", headers=hdr(alice), json={"notes": "duzeltilmis not"})
rev = c.get(f"{API}/expenses/{eid}/revisions", headers=hdr(alice)).json()["revisions"]
check("not degisikligi de kayitli", len(rev) == 1, str(len(rev)))
check("kayitta 'notes' var", "notes" in (rev[0]["changes"] if rev else {}), str(rev[:1]))

print("\n== tutar degisikligi ==")
c.patch(f"{API}/expenses/{eid}", headers=hdr(alice), json={"total": 160.0})
rev = c.get(f"{API}/expenses/{eid}/revisions", headers=hdr(alice)).json()["revisions"]
check("yeni kayit eklendi", len(rev) == 2, str(len(rev)))
son = rev[0]
check("en yeni kayit basta", son["changes"].get("total", {}).get("yeni") == 160.0, str(son["changes"]))
check("eski tutar saklandi", son["changes"].get("total", {}).get("eski") == 100.0, str(son["changes"]))
check("kim degistirdi yazili", son["by"] == alice_id, str(son["by"]))
check("ismi de yazili", son.get("by_name") == "Alice", str(son.get("by_name")))
check("islem tipi edit", son["action"] == "edit", son["action"])

print("\n== degismeyen alan kayda girmemeli ==")
c.patch(f"{API}/expenses/{eid}", headers=hdr(alice), json={"total": 160.0})
rev = c.get(f"{API}/expenses/{eid}/revisions", headers=hdr(alice)).json()["revisions"]
check("ayni tutar yeni kayit acmadi", len(rev) == 2, str(len(rev)))

print("\n== ev arkadasi da gecmisi gorebilmeli ==")
rev_bob = c.get(f"{API}/expenses/{eid}/revisions", headers=hdr(bob)).json()["revisions"]
check("Bob gecmisi goruyor", len(rev_bob) == 2, str(len(rev_bob)))

print("\n== silme ==")
c.delete(f"{API}/expenses/{eid}", headers=hdr(alice))
rev = c.get(f"{API}/expenses/{eid}/revisions", headers=hdr(alice)).json()["revisions"]
check("silme kayda gecti", len(rev) == 3, str(len(rev)))
check("silme kaydinin tipi delete", rev[0]["action"] == "delete", rev[0]["action"])
check("silinen kaydin tamami saklandi",
      (rev[0].get("snapshot") or {}).get("total") == 160.0, str(rev[0].get("snapshot"))[:120])
check("kalemler de saklandi",
      len((rev[0].get("snapshot") or {}).get("items") or []) == 1, str(rev[0].get("snapshot"))[:120])

print("\n== baska evin gecmisi gorunmemeli ==")
carol, carol_id = reg("carol")
c.post(f"{API}/households", headers=hdr(carol), json={"name": f"Yabanci Ev {TAG}"})
rev_c = c.get(f"{API}/expenses/{eid}/revisions", headers=hdr(carol)).json()["revisions"]
check("yabanci hicbir sey gormuyor", rev_c == [], str(rev_c))

print("\n== temizlik ==")
for t in (alice, bob, carol):
    c.post(f"{API}/households/leave", headers=hdr(t))
    c.post(f"{API}/auth/logout", headers=hdr(t))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
