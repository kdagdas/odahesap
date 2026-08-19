"""Aktivite kaydi.

Bildirim gelip kacirildiginda geriye bakacak bir yer yoktu. Telefonu kapali
olan ya da bildirimleri kapatmis biri olan bitenden habersiz kaliyordu.

Kritik nokta: kayit push'tan BAGIMSIZ yaziliyor. Bu testte FCM hic
yapilandirilmamis olabilir; kayit yine de olusmali.
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
        "email": f"akt_{who}_{TAG}@odahesap-e2e.com",
        "password": "sifre123", "name": who.title()})
    r.raise_for_status()
    return r.json()["session_token"], r.json()["user"]["user_id"]


alice, alice_id = reg("alice")
bob, bob_id = reg("bob")

print("== baslangicta bos ==")
n = c.get(f"{API}/notifications", headers=hdr(alice)).json()
check("liste bos", n["notifications"] == [], str(n))
check("okunmamis 0", n["unread"] == 0, str(n["unread"]))

print("== katilma istegi yoneticiye kayit birakiyor ==")
r = c.post(f"{API}/households", headers=hdr(alice), json={"name": f"Akt Ev {TAG}"})
kod = r.json()["household"]["invite_code"]
c.post(f"{API}/households/join", headers=hdr(bob), json={"invite_code": kod})

n = c.get(f"{API}/notifications", headers=hdr(alice)).json()
check("yoneticiye kayit dustu", n["unread"] == 1, str(n["unread"]))
check("turu join_request", n["notifications"][0]["kind"] == "join_request",
      str(n["notifications"][0]["kind"]))
check("Bob'un adi gecti", "Bob" in n["notifications"][0]["body"],
      n["notifications"][0]["body"])

print("\n== onay isteyene kayit birakiyor ==")
c.post(f"{API}/households/approve", headers=hdr(alice), json={"user_id": bob_id})
nb = c.get(f"{API}/notifications", headers=hdr(bob)).json()
check("Bob onay kaydi aldi", nb["unread"] == 1, str(nb["unread"]))

print("\n== ev harcamasi digerlerine gidiyor, ekleyene gitmiyor ==")
c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "household", "total": 60.0, "source": "manual",
    "merchant": "REWE", "items": []})
nb = c.get(f"{API}/notifications", headers=hdr(bob)).json()
check("Bob harcama kaydi aldi", nb["unread"] == 2, str(nb["unread"]))
na = c.get(f"{API}/notifications", headers=hdr(alice)).json()
check("Alice kendi harcamasindan kayit almadi", na["unread"] == 1, str(na["unread"]))

print("\n== kisisel harcama kimseye gitmiyor ==")
c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "self", "total": 25.0, "source": "manual", "items": []})
nb = c.get(f"{API}/notifications", headers=hdr(bob)).json()
check("kisisel harcama kayit uretmedi", nb["unread"] == 2, str(nb["unread"]))

print("\n== okundu isaretleme ==")
c.post(f"{API}/notifications/read", headers=hdr(bob))
nb = c.get(f"{API}/notifications", headers=hdr(bob)).json()
check("okunmamis sifirlandi", nb["unread"] == 0, str(nb["unread"]))
check("kayitlar duruyor", len(nb["notifications"]) == 2, str(len(nb["notifications"])))
check("hepsi okundu isaretli", all(x["read"] for x in nb["notifications"]),
      str([x["read"] for x in nb["notifications"]]))

print("\n== en yeni ustte ==")
c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "household", "total": 12.0, "source": "manual",
    "merchant": "ALDI", "items": []})
nb = c.get(f"{API}/notifications", headers=hdr(bob)).json()
check("yeni kayit basta", "ALDI" in nb["notifications"][0]["body"],
      nb["notifications"][0]["body"])
check("yalnizca yeni olan okunmamis", nb["unread"] == 1, str(nb["unread"]))

print("\n== baskasinin kaydi gorunmuyor ==")
carol, carol_id = reg("carol")
nc = c.get(f"{API}/notifications", headers=hdr(carol)).json()
check("yabanci hicbir sey gormuyor", nc["notifications"] == [], str(nc))

print()
print("== bildirim GIDECEGI YERI tasiyor ==")
# Bildirime dokunanin ilk sorusu "benim icin ne aldi" -- cevabin bulundugu fis
# `data`da yaziyor. `ay` de sart: Harcamalar ekrani AY bazli calisiyor, ay
# yazilmazsa geriye tarihli bir fis bugunun listesinde bulunamaz.
r = c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "household", "total": 33.0, "source": "manual",
    "merchant": "LIDL", "expense_date": "2026-06-14", "items": []})
exp_id = r.json()["expense"]["expense_id"]
nb = c.get(f"{API}/notifications", headers=hdr(bob)).json()
son = nb["notifications"][0]
check("data alani geliyor", isinstance(son.get("data"), dict), str(son.get("data")))
check("expense_id yaziyor", son["data"].get("expense_id") == exp_id, str(son["data"]))
check("ay FISIN ayi, bugunun degil", son["data"].get("ay") == "2026-06", str(son["data"]))

print()
print("== silinen harcamanin bildirimi de fisi tasiyor ==")
c.delete(f"{API}/expenses/{exp_id}", headers=hdr(alice))
nb = c.get(f"{API}/notifications", headers=hdr(bob)).json()
sil = nb["notifications"][0]
check("silme bildirimi geldi", sil["kind"] == "expense_edit", sil["kind"])
check("silinen fisin kimligi duruyor", sil["data"].get("expense_id") == exp_id,
      str(sil["data"]))

print()
print("== tek bildirim silme ==")
onceki = len(nb["notifications"])
hedef = nb["notifications"][0]["notification_id"]
r = c.delete(f"{API}/notifications/{hedef}", headers=hdr(bob))
check("silme 200", r.status_code == 200, str(r.status_code))
nb = c.get(f"{API}/notifications", headers=hdr(bob)).json()
check("satir gitti", len(nb["notifications"]) == onceki - 1, str(len(nb["notifications"])))
check("silinen artik yok",
      all(x["notification_id"] != hedef for x in nb["notifications"]))

print()
print("== baskasinin bildirimi silinemiyor ==")
na = c.get(f"{API}/notifications", headers=hdr(alice)).json()
alice_ntf = na["notifications"][0]["notification_id"]
r = c.delete(f"{API}/notifications/{alice_ntf}", headers=hdr(bob))
check("yabanci 404 aliyor", r.status_code == 404, str(r.status_code))
na = c.get(f"{API}/notifications", headers=hdr(alice)).json()
check("Alice'in kaydi duruyor",
      any(x["notification_id"] == alice_ntf for x in na["notifications"]))

print()
print("== topluca temizleme YALNIZCA okunmuslari siliyor ==")
c.post(f"{API}/notifications/read", headers=hdr(bob))
c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "household", "total": 9.0, "source": "manual",
    "merchant": "EDEKA", "items": []})
nb = c.get(f"{API}/notifications", headers=hdr(bob)).json()
okunmus = sum(1 for x in nb["notifications"] if x["read"])
check("temizlemeden once okunmus var", okunmus > 0, str(okunmus))
r = c.post(f"{API}/notifications/clear-read", headers=hdr(bob))
check("temizleme 200", r.status_code == 200, str(r.status_code))
check("silinen sayisi bildiriliyor", r.json().get("deleted") == okunmus, str(r.json()))
nb = c.get(f"{API}/notifications", headers=hdr(bob)).json()
check("okunmus kalmadi", all(not x["read"] for x in nb["notifications"]),
      str([x["read"] for x in nb["notifications"]]))
check("okunmamis HAYATTA", nb["unread"] == 1, str(nb["unread"]))
check("okunmamis EDEKA", "EDEKA" in nb["notifications"][0]["body"],
      nb["notifications"][0]["body"])

print()
print("== Alice'in kayitlari etkilenmedi ==")
na = c.get(f"{API}/notifications", headers=hdr(alice)).json()
check("Alice hala kayitli", len(na["notifications"]) > 0, str(len(na["notifications"])))

print()
print("\n== temizlik ==")
for t in (alice, bob, carol):
    c.post(f"{API}/households/leave", headers=hdr(t))
    c.post(f"{API}/auth/logout", headers=hdr(t))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
