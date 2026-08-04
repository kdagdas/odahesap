"""Gizlilik testi: kimin hangi harcamayi gorebildigi.

Kurallar:
  self      -> sadece alan kisi gorur (kisisel harcama)
  roommate  -> sadece alan + adina alinan kisi gorur (ikili harcama)
  household -> evdeki herkes gorur

Ucuncu bir ev arkadasi (Carol) ikili harcamayi ne listede, ne uye detayinda,
ne de kalem dokumunde gorebilmeli.
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
        "email": f"prv_{who}_{TAG}@odahesap-e2e.com", "password": "sifre123", "name": f"{who.title()}"})
    r.raise_for_status()
    return r.json()["session_token"], r.json()["user"]["user_id"]


alice, alice_id = reg("alice")
bob, bob_id = reg("bob")
carol, carol_id = reg("carol")

r = c.post(f"{API}/households", headers=hdr(alice), json={"name": f"Gizlilik Ev {TAG}"})
invite = r.json()["household"]["invite_code"]
for tok, uid in ((bob, bob_id), (carol, carol_id)):
    c.post(f"{API}/households/join", headers=hdr(tok), json={"invite_code": invite})
    c.post(f"{API}/households/approve", headers=hdr(alice), json={"user_id": uid})

print("\n-- harcamalar olusturuluyor --")
# Alice sadece kendisi icin
c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "self", "total": 25.0, "source": "manual",
    "items": [{"name": "ALICE_KISISEL", "price": 25.0, "quantity": 1, "category": "diger"}]})
# Alice sadece Bob icin (kullanicinin tarif ettigi ikili durum)
c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "roommate", "target_user_id": bob_id, "total": 18.0, "source": "manual",
    "items": [{"name": "BOB_ICIN_SAMPUAN", "price": 18.0, "quantity": 1, "category": "ev_urunleri"}]})
# Herkes icin
c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "household", "total": 90.0, "source": "manual",
    "items": [{"name": "EV_ALISVERISI", "price": 90.0, "quantity": 1, "category": "diger"}]})
print("  3 harcama eklendi: kisisel / ikili / ev")


def gorunen_kalemler(token):
    """Kullanicinin hem listede hem uye detayinda gorebildigi tum kalem adlari."""
    adlar = set()
    r = c.get(f"{API}/expenses", headers=hdr(token))
    for e in r.json()["expenses"]:
        for it in e.get("items", []):
            adlar.add(it["name"])
    # Uye detayi (Denge ekranindaki tiklama) ayri bir uc - o da sizdirmamali
    for mid in (alice_id, bob_id, carol_id):
        r = c.get(f"{API}/members/{mid}/expenses", headers=hdr(token))
        if r.status_code == 200:
            for e in r.json()["expenses"]:
                for it in e.get("items", []):
                    adlar.add(it["name"])
    return adlar


a_gorur = gorunen_kalemler(alice)
b_gorur = gorunen_kalemler(bob)
c_gorur = gorunen_kalemler(carol)

print("\n-- kisisel harcama (self) --")
check("Alice kendi kisisel harcamasini gorur", "ALICE_KISISEL" in a_gorur, str(a_gorur))
check("Bob, Alice'in kisiselini GOREMEZ", "ALICE_KISISEL" not in b_gorur, str(b_gorur))
check("Carol, Alice'in kisiselini GOREMEZ", "ALICE_KISISEL" not in c_gorur, str(c_gorur))

print("\n-- ikili harcama (roommate) --")
check("Alice ikili harcamayi gorur (alan taraf)", "BOB_ICIN_SAMPUAN" in a_gorur, str(a_gorur))
check("Bob ikili harcamayi gorur (adina alinan)", "BOB_ICIN_SAMPUAN" in b_gorur, str(b_gorur))
check("Carol ikili harcamayi GOREMEZ", "BOB_ICIN_SAMPUAN" not in c_gorur, str(c_gorur))

print("\n-- ev harcamasi (household) --")
for ad, gorur in (("Alice", a_gorur), ("Bob", b_gorur), ("Carol", c_gorur)):
    check(f"{ad} ev harcamasini gorur", "EV_ALISVERISI" in gorur, str(gorur))

print("\n-- dengeye etkisi --")
r = c.get(f"{API}/balances", headers=hdr(carol))
net = r.json()["net"]
# Ev: 90/3 = 30 pay. Alice +60, Bob -30, Carol -30.
# Ikili 18: Alice +18, Bob -18. Kisisel 25: hicbir etkisi yok.
check("Alice net = +78.00", abs(net.get(alice_id, 0) - 78.0) < 0.01, str(net))
check("Bob net = -48.00", abs(net.get(bob_id, 0) + 48.0) < 0.01, str(net))
check("Carol net = -30.00 (kisisel/ikili onu etkilemez)", abs(net.get(carol_id, 0) + 30.0) < 0.01, str(net))

print("\n-- temizlik --")
for t in (alice, bob, carol):
    c.post(f"{API}/households/leave", headers=hdr(t))
    c.post(f"{API}/auth/logout", headers=hdr(t))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
