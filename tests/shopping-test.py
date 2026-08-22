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

print()
print("-- FIYAT IPUCU ve SON ALISVERIS (Tur 12) --")
# IKI HAVUZ, IKI KURAL. Fiyat evin BUTUN harcamalarindan besleniyor (kisisel
# dahil): "sut 0,95" cumlesinde kimse yok, tarih yok, alan yok -- bir OLGU.
# "Son alisveris" ise bir IDDIA ve kullanici onu Harcamalar'da dogrulamak
# ister; gormedigi bir kayda dayanirsa yalan gibi gelir.

# Bob KENDINE bir sey aliyor: Alice bu harcamayi hicbir ekranda goremez.
c.post(f"{API}/expenses", headers=hdr(bob), json={
    "target_type": "self", "total": 4.5, "source": "receipt",
    "merchant": "ROSSMANN", "expense_date": "2026-08-10",
    "items": [{"name": "GIZLI SAMPUAN", "price": 4.5, "quantity": 1,
               "generic": "sampuan", "category": "ev_urunleri"}]})
# Ev alisverisi: herkes gorur.
c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "household", "total": 2.0, "source": "receipt",
    "merchant": "ALDI", "expense_date": "2026-08-12",
    "items": [{"name": "TAM YAGLI SUT", "price": 2.0, "quantity": 1,
               "generic": "sut", "category": "sut_urunleri"}]})

c.post(f"{API}/shopping", headers=hdr(alice),
       json={"text": "sut", "scope": "household"})
c.post(f"{API}/shopping", headers=hdr(alice),
       json={"text": "sampuan", "scope": "household"})
c.post(f"{API}/shopping", headers=hdr(alice),
       json={"text": "hic alinmamis sey", "scope": "household"})

r = c.get(f"{API}/shopping", headers=hdr(alice), params={"scope": "household"}).json()
ipucu = {i["text"]: i.get("last_price") for i in r["items"]}
check("ev alisverisinden fiyat geldi", ipucu.get("sut") == 2.0, str(ipucu))
check("BASKASININ KISISELINDEN de fiyat geliyor (bilincli karar)",
      ipucu.get("sampuan") == 4.5, str(ipucu))
check("alinmamis urunde ipucu YOK, uydurulmuyor",
      ipucu.get("hic alinmamis sey") is None, str(ipucu))
# NITELEYICI TASIYAN MADDE BASKA BIR URUNUN FIYATINI ALMAZ.
#
# Ev sahibi cihazda uc ornekle yakaladi: "yassi seftali" seftalinin fiyatini,
# "tavuk kiyma" (dana) kiymanin fiyatini, "guzel muz" muzun fiyatini
# aliyordu. Sebep iki yonlu iceren esleme idi: urun adi liste maddesinin
# ICINDE gecince de tutuyordu.
#
# Bu satir bir IDDIA ve kimse onaylamiyor -- `/shopping/match` gevsek
# olabilir cunku orada kutu bos aciliyor ve insan onayliyor.
c.post(f"{API}/expenses", headers=hdr(alice), json={
    "target_type": "household", "total": 12.49, "source": "receipt",
    "merchant": "BIZIM", "expense_date": "2026-08-12",
    "items": [{"name": "RINDER HACK", "price": 12.49, "quantity": 1,
               "generic": "kiyma", "category": "et_balik"}]})
for metin in ("kiyma", "tavuk kiyma", "sut kremasi"):
    c.post(f"{API}/shopping", headers=hdr(alice),
           json={"text": metin, "scope": "household"})

r3 = c.get(f"{API}/shopping", headers=hdr(alice), params={"scope": "household"}).json()
ip3 = {i["text"]: i.get("last_price") for i in r3["items"]}
check("tam eslesen madde fiyati aliyor", ip3.get("kiyma") == 12.49, str(ip3))
check("NITELEYICILI madde fiyat ALMIYOR (tavuk kiyma)",
      ip3.get("tavuk kiyma") is None, str(ip3))
check("urun adi maddeyi iceriyor diye de eslesmiyor",
      ip3.get("sut kremasi") is None, str(ip3))

markt = {i["text"]: i.get("last_merchant") for i in r["items"]}
check("market de geliyor", markt.get("sut") == "ALDI", str(markt))

# SON ALISVERIS: Bob'un kisiseli 12 Agustos'takinden DAHA YENI olsaydi bile
# Alice'e gosterilmemeli. Burada ev alisverisi zaten daha yeni; asil kontrol
# kaynagin ev harcamasi olmasi.
son = r.get("last_shopping")
check("son alisveris geldi", son is not None, str(son))
check("EV alisverisini gosteriyor", son and son["day"] == "2026-08-12", str(son))
check("marketi de", son and son["merchant"] == "ALDI", str(son))

# Bob'un KENDI listesinde son alisveris KENDI harcamasi.
r2 = c.get(f"{API}/shopping", headers=hdr(bob), params={"scope": "self"}).json()
son2 = r2.get("last_shopping")
check("Kendim kapsaminda kisinin KENDI alisverisi",
      son2 and son2["day"] == "2026-08-10", str(son2))

# Alice'in kendi listesinde hic kisisel harcamasi yok -> bos.
r3 = c.get(f"{API}/shopping", headers=hdr(alice), params={"scope": "self"}).json()
check("kisisel harcamasi olmayanda son alisveris bos",
      r3.get("last_shopping") is None, str(r3.get("last_shopping")))

print("\n-- temizlik --")
for t in (alice, bob, dave):
    c.post(f"{API}/households/leave", headers=hdr(t))
    c.post(f"{API}/auth/logout", headers=hdr(t))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
