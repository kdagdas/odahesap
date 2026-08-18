"""'Odestik' dugmesi, uyelik gunlugu ve ayrilma bildirimi.

Tur 10'da donem elle kapatilamaz oldu: yalnizca herkes odestiginde
kendiliginden kapaniyor. Ama odeme kaydini yalnizca TARAFLARI girebildigi
icin bu, kapanmayi herkesin tek tek uygulamayi acmasina baglamis oluyordu --
uc kisilik gercek evde bugune kadar HIC odeme isaretlenmemisti, yani o
kapanma hicbir zaman gerceklesmezdi.

`POST /settlements/all` eski "Donemi kapat" dugmesinin yerini aliyor ama isi
tam tersi: o bakiyeleri SILIYORDU, bu KAYDEDIYOR. Nakit odesen bir ev icin
tek jest, defterde kimin kime ne odedigi yazili kaliyor.

Ayrica: donem sinirinin tasidigi "bu donemde uc kisiydik" bilgisi kalkinca,
kimin ne zaman ayrildigi `member_log`'dan okunuyor.
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
        "email": f"ods_{who}_{TAG}@odahesap-e2e.com",
        "password": "sifre123", "name": f"{who.title()} Test"})
    r.raise_for_status()
    return r.json()["session_token"], r.json()["user"]["user_id"]


alice, alice_id = reg("alice")
bob, bob_id = reg("bob")
carol, carol_id = reg("carol")

print("\n-- ev kurulumu --")
r = c.post(f"{API}/households", headers=hdr(alice), json={"name": f"Odestik Ev {TAG}"})
check("ev kuruldu", r.status_code == 200, r.text[:200])
kod = r.json()["household"]["invite_code"]
for tok, uid in ((bob, bob_id), (carol, carol_id)):
    c.post(f"{API}/households/join", headers=hdr(tok), json={"invite_code": kod})
    c.post(f"{API}/households/approve", headers=hdr(alice), json={"user_id": uid})

print("\n-- borc yokken --")
r = c.post(f"{API}/settlements/all", headers=hdr(alice))
check("odesilecek borc yoksa 400", r.status_code == 400, f"got {r.status_code}")

print("\n-- harcama --")
c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "household", "total": 90.0, "source": "manual",
    "items": [{"name": "Ortak", "price": 90.0, "quantity": 1, "category": "diger"}]})
bal = c.get(f"{API}/balances", headers=hdr(alice)).json()
check("Alice +60", abs(bal["net"][alice_id] - 60.0) < 0.01, str(bal["net"]))
check("2 transfer onerisi", len(bal["transfers"]) == 2, str(bal["transfers"]))

print("\n-- yetki --")
r = c.post(f"{API}/settlements/all", headers=hdr(bob))
check("normal uye odestik diyemez (403)", r.status_code == 403, f"got {r.status_code}")

print("\n-- odestik --")
r = c.post(f"{API}/settlements/all", headers=hdr(alice))
check("yonetici odestik diyebilir", r.status_code == 200, r.text[:200])
check("2 odeme kaydedildi", r.json().get("count") == 2, r.text[:200])

# Asil fark burada: bakiye SILINMEDI, odeme olarak KAYDEDILDI.
#
# `all_periods` sart: odesme donemi kapattigi icin kayitlar artik kapali
# donemde duruyor ve varsayilan gorunum -- tam da ilgilenilen anda -- bos
# liste donuyordu. Odeme gecmisi donemleri asmali.
bos = c.get(f"{API}/settlements", headers=hdr(alice)).json().get("settlements", [])
check("acik donemde odeme yok (kapali donemde kaldilar)", len(bos) == 0, str(len(bos)))
stl = c.get(f"{API}/settlements?all_periods=true",
            headers=hdr(alice)).json().get("settlements", [])
check("gecmis donemleri asiyor", len(stl) == 2, str(len(stl)))
check("kim kime odedigi yazili",
      all(s.get("from_user_id") and s.get("to_user_id") for s in stl), str(stl)[:200])
toplam = sum(float(s["amount"]) for s in stl)
check("kaydedilen toplam 60", abs(toplam - 60.0) < 0.01, str(toplam))

print("\n-- donem kendiliginden kapandi --")
per = c.get(f"{API}/periods", headers=hdr(alice)).json()["periods"]
check("2 donem var", len(per) == 2, str(len(per)))
check("biri kapali", any(p["status"] == "closed" for p in per), str([p["status"] for p in per]))
yeni = c.get(f"{API}/balances", headers=hdr(alice)).json()
check("yeni donem bos", all(abs(v) < 0.01 for v in yeni["net"].values()), str(yeni["net"]))

print("\n-- geri alinabiliyor --")
# Son odemeyi silmek, onun tetikledigi kapanmayi da geri almali; yoksa
# yanlis kaydedilmis bir "odestik" hicbir zaman duzeltilemezdi.
r = c.delete(f"{API}/settlements/{stl[0]['settlement_id']}", headers=hdr(alice))
check("odeme silinebiliyor", r.status_code == 200, r.text[:200])
per2 = c.get(f"{API}/periods", headers=hdr(alice)).json()["periods"]
check("donem geri acildi (1 donem)", len(per2) == 1, str(len(per2)))
check("acik donem", per2[0]["status"] == "active", str(per2[0]["status"]))
geri = c.get(f"{API}/balances", headers=hdr(alice)).json()
check("silinen odemenin borcu geri geldi",
      any(abs(v) > 0.01 for v in geri["net"].values()), str(geri["net"]))

print("\n-- uyelik gunlugu --")
c.post(f"{API}/households/leave", headers=hdr(carol))
hh = c.get(f"{API}/households/me", headers=hdr(alice)).json()["household"]
log = hh.get("member_log") or []
check("gunluge yazildi", len(log) >= 1, str(log)[:200])
ayrilanlar = [e for e in log if e.get("eylem") == "ayrildi" and e.get("user_id") == carol_id]
check("Carol'un ayrilisi kayitli", len(ayrilanlar) == 1, str(log)[:200])
check("tarihi var", bool(ayrilanlar and ayrilanlar[0].get("at")), str(ayrilanlar)[:200])
katilanlar = [e for e in log if e.get("eylem") == "katildi"]
check("katilmalar da kayitli", len(katilanlar) == 2, str(katilanlar)[:200])

print("\n-- ayrilan kisinin borcu yasiyor --")
son = c.get(f"{API}/balances", headers=hdr(alice)).json()
check("Carol hala bakiyede", carol_id in son["net"], str(son["net"]))
uyeler = [m["user_id"] for m in c.get(f"{API}/households/me", headers=hdr(alice)).json()["members"]]
check("ama uye listesinde degil", carol_id not in uyeler, str(uyeler))

print("\n-- ayrildiktan sonra kalanlara bolunuyor --")
c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "household", "total": 40.0, "source": "manual", "items": []})
harc = c.get(f"{API}/expenses", headers=hdr(alice)).json()["expenses"]
yeni_h = [e for e in harc if abs(float(e["total"]) - 40.0) < 0.01][0]
check("yeni harcama 2 kisiye bolundu", len(yeni_h.get("split_with") or {}) == 2,
      str(yeni_h.get("split_with")))
check("Carol yeni harcamada yok", carol_id not in (yeni_h.get("split_with") or {}),
      str(yeni_h.get("split_with")))
eski_h = [e for e in harc if abs(float(e["total"]) - 90.0) < 0.01][0]
check("eski harcama 3 kisilik kaldi", len(eski_h.get("split_with") or {}) == 3,
      str(eski_h.get("split_with")))

print("\n-- temizlik --")
for t in (alice, bob, carol):
    c.post(f"{API}/households/leave", headers=hdr(t))
    c.post(f"{API}/auth/logout", headers=hdr(t))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
