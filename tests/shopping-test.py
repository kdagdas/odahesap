"""Alinacaklar listesi testi — ozellikle gizlilik.

Kritik: "kendi" listesi sahibinden baskasina asla gorunmemeli, ev listesi
ise evdeki herkese gorunmeli ve herkes isaretleyebilmeli.
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
        "email": f"shop_{who}_{TAG}@odahesap-e2e.com", "password": "sifre123", "name": who.title()})
    r.raise_for_status()
    return r.json()["session_token"], r.json()["user"]["user_id"]


alice, alice_id = reg("alice")
bob, bob_id = reg("bob")
dave, dave_id = reg("dave")   # baska bir evde - hicbir sey gormemeli

r = c.post(f"{API}/households", headers=hdr(alice), json={"name": f"Liste Ev {TAG}"})
invite = r.json()["household"]["invite_code"]
c.post(f"{API}/households/join", headers=hdr(bob), json={"invite_code": invite})
c.post(f"{API}/households/approve", headers=hdr(alice), json={"user_id": bob_id})
c.post(f"{API}/households", headers=hdr(dave), json={"name": f"Dave Ev {TAG}"})

print("\n-- ekleme --")
r = c.post(f"{API}/shopping", headers=hdr(alice), json={"text": "EV_SUT", "scope": "household"})
check("ev kalemi eklendi", r.status_code == 200, r.text[:200])
ev_item = r.json()["item"]["item_id"]
r = c.post(f"{API}/shopping", headers=hdr(alice), json={"text": "ALICE_OZEL", "scope": "self"})
check("kisisel kalem eklendi", r.status_code == 200, r.text[:200])
ozel_item = r.json()["item"]["item_id"]
c.post(f"{API}/shopping", headers=hdr(bob), json={"text": "EV_EKMEK", "scope": "household"})
c.post(f"{API}/shopping", headers=hdr(bob), json={"text": "BOB_OZEL", "scope": "self"})


def gorunen(token, scope=None):
    url = f"{API}/shopping" + (f"?scope={scope}" if scope else "")
    return {i["text"] for i in c.get(url, headers=hdr(token)).json()["items"]}


print("\n-- gizlilik --")
a, b, d = gorunen(alice), gorunen(bob), gorunen(dave)
check("Alice kendi ozelini gorur", "ALICE_OZEL" in a, str(a))
check("Bob, Alice'in ozelini GOREMEZ", "ALICE_OZEL" not in b, str(b))
check("Alice, Bob'un ozelini GOREMEZ", "BOB_OZEL" not in a, str(a))
check("ev kalemlerini ikisi de gorur",
      {"EV_SUT", "EV_EKMEK"} <= a and {"EV_SUT", "EV_EKMEK"} <= b, f"{a} / {b}")
check("baska evdeki Dave hicbirini gormez", not (a | b) & d, str(d))

print("\n-- sekme filtreleri --")
check("scope=self sadece kendi", gorunen(alice, "self") == {"ALICE_OZEL"}, str(gorunen(alice, "self")))
check("scope=household sadece ev",
      gorunen(alice, "household") == {"EV_SUT", "EV_EKMEK"}, str(gorunen(alice, "household")))

print("\n-- isaretleme --")
r = c.patch(f"{API}/shopping/{ev_item}", headers=hdr(bob), json={"done": True})
check("Bob ev kalemini isaretleyebilir", r.status_code == 200, r.text[:200])
check("isaretleyen kaydedildi", r.json()["item"]["done_by"] == bob_id, r.text[:200])
r = c.patch(f"{API}/shopping/{ozel_item}", headers=hdr(bob), json={"done": True})
check("Bob, Alice'in ozelini isaretleyemez (404)", r.status_code == 404, f"got {r.status_code}")
r = c.patch(f"{API}/shopping/{ev_item}", headers=hdr(dave), json={"done": True})
check("Dave ev kalemine dokunamaz (404)", r.status_code == 404, f"got {r.status_code}")

print("\n-- siralama --")
items = c.get(f"{API}/shopping?scope=household", headers=hdr(alice)).json()["items"]
check("isaretlenenler sona atiliyor", items[-1]["text"] == "EV_SUT", str([i["text"] for i in items]))

print("\n-- silme ve temizleme --")
r = c.delete(f"{API}/shopping/{ev_item}", headers=hdr(dave))
check("Dave silemez (404)", r.status_code == 404, f"got {r.status_code}")
c.patch(f"{API}/shopping/{ozel_item}", headers=hdr(alice), json={"done": True})
r = c.post(f"{API}/shopping/clear-done?scope=self", headers=hdr(alice))
check("kendi listesinde bitenler temizlendi", r.json()["deleted"] == 1, r.text[:200])
check("temizlik sonrasi kendi listesi bos", gorunen(alice, "self") == set(), str(gorunen(alice, "self")))
check("ev listesi etkilenmedi", "EV_EKMEK" in gorunen(alice, "household"), str(gorunen(alice, "household")))

print("\n-- temizlik --")
for t in (alice, bob, dave):
    c.post(f"{API}/households/leave", headers=hdr(t))
    c.post(f"{API}/auth/logout", headers=hdr(t))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
