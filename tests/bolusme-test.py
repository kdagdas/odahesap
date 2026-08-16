"""Bolusme testi: `split_with` ile kisi bazli paylar.

Tur 4'te uc ozel durum (household / self / roommate) tek mekanizmaya indi:
her harcama kendi katilimci listesini tasiyor.

    split_mode "equal" -> split_with = {user_id: agirlik}
    split_mode "exact" -> split_with = {user_id: tutar}

Bu takim dort seyi koruyor:
  1. Liste parayi dogru bolusturuyor mu (secili kisiler, kisiye ozel tutarlar)
  2. Liste gorunurlugu de belirliyor mu (listede olmayan gormemeli)
  3. Liste kayit aninda **donuyor** mu (sonradan katilan pay ustlenmiyor)
  4. Eski kayitlar (split_with alani hic yazilmamis) aynen calisiyor mu

Dorduncusu en onemlisi: uretimdeki 288 harcamanin hicbirinde bu alan yok.
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


def near(a, b, tol=0.02):
    return abs(float(a) - float(b)) <= tol


def hdr(t):
    return {"Authorization": f"Bearer {t}"}


c = httpx.Client(timeout=90.0)


def reg(who):
    r = c.post(f"{API}/auth/register", json={
        "email": f"bol_{who}_{TAG}@odahesap-e2e.com",
        "password": "sifre123", "name": who.title()})
    r.raise_for_status()
    return r.json()["session_token"], r.json()["user"]["user_id"]


def add(tok, **body):
    body.setdefault("source", "manual")
    return c.post(f"{API}/expenses", headers=hdr(tok), json=body)


def net_of(tok):
    return c.get(f"{API}/balances", headers=hdr(tok)).json()["net"]


alice, alice_id = reg("alice")
bob, bob_id = reg("bob")
carol, carol_id = reg("carol")
dave, dave_id = reg("dave")

r = c.post(f"{API}/households", headers=hdr(alice), json={"name": f"Bolusme Ev {TAG}"})
invite = r.json()["household"]["invite_code"]
for tok, uid in ((bob, bob_id), (carol, carol_id)):
    c.post(f"{API}/households/join", headers=hdr(tok), json={"invite_code": invite})
    c.post(f"{API}/households/approve", headers=hdr(alice), json={"user_id": uid})
print(f"3 kisilik ev kuruldu ({TAG})")


print("\n-- 1. secili kisiler (esit) --")
# Fisteki yumurta: sadece Alice ve Bob bolusuyor, Carol'in isi yok.
r = add(alice, split_mode="equal", split_with={alice_id: 1, bob_id: 1}, total=30.0,
        items=[{"name": "YUMURTA", "price": 30.0, "quantity": 1, "category": "sut_urunleri"}])
check("secili kisiler kaydedildi", r.status_code == 200, r.text[:200])
exp1 = r.json()["expense"]
check("etiket 'custom' turetildi", exp1["target_type"] == "custom", exp1["target_type"])

n = net_of(alice)
check("Alice +15", near(n[alice_id], 15.0), n)
check("Bob -15", near(n[bob_id], -15.0), n)
check("Carol'a hic dokunmadi", near(n[carol_id], 0.0), n)


print("\n-- 2. kisiye ozel tutarlar (kira) --")
# 1200 EUR kirayi Bob odedi, uc kisinin odalari farkli buyuklukte.
r = add(bob, split_mode="exact",
        split_with={alice_id: 350.0, bob_id: 400.0, carol_id: 450.0}, total=1200.0,
        category="Kira", items=[{"name": "KIRA", "price": 1200.0, "quantity": 1, "category": "diger"}])
check("kisiye ozel tutarlar kaydedildi", r.status_code == 200, r.text[:200])
kira = r.json()["expense"]
check("herkes listede -> etiket 'household'", kira["target_type"] == "household", kira["target_type"])

n = net_of(alice)
check("Alice +15 - 350 = -335", near(n[alice_id], 15 - 350), n)
check("Bob -15 + (1200-400) = +785", near(n[bob_id], 785.0), n)
check("Carol -450", near(n[carol_id], -450.0), n)
check("toplam sifir", near(sum(n.values()), 0.0), n)


print("\n-- 3. gorunurluk listeden okunuyor --")
vis = lambda tok: {e["expense_id"] for e in c.get(f"{API}/expenses", headers=hdr(tok)).json()["expenses"]}
check("Alice yumurtayi goruyor (listede)", exp1["expense_id"] in vis(alice))
check("Bob yumurtayi goruyor (listede)", exp1["expense_id"] in vis(bob))
check("Carol yumurtayi GORMUYOR", exp1["expense_id"] not in vis(carol))
check("Carol kirayi goruyor", kira["expense_id"] in vis(carol))


print("\n-- 4. eski uc durum ayni sonucu veriyor --")
r = add(carol, split_mode="equal", split_with={alice_id: 1, bob_id: 1, carol_id: 1}, total=90.0)
check("herkes esit -> 'household'", r.json()["expense"]["target_type"] == "household")
r = add(carol, split_mode="exact", split_with={carol_id: 40.0}, total=40.0)
check("sadece kendisi -> 'self'", r.json()["expense"]["target_type"] == "self")
kisisel = r.json()["expense"]["expense_id"]
r = add(carol, split_mode="exact", split_with={alice_id: 18.0}, total=18.0)
check("tek baskasi -> 'roommate'", r.json()["expense"]["target_type"] == "roommate")
check("roommate'te target_user_id listeden dolduruldu",
      r.json()["expense"]["target_user_id"] == alice_id)
check("kisisel harcamayi Alice gormuyor", kisisel not in vis(alice))

n = net_of(alice)
# yumurta(+15) + kira(-350) + ev 90 (-30) + Carol'un Alice icin aldigi 18 (-18)
check("kisisel harcama dengeye girmedi", near(n[alice_id], 15 - 350 - 30 - 18), n)
check("toplam hala sifir", near(sum(n.values()), 0.0), n)


print("\n-- 5. gecersiz bolusum reddediliyor --")
r = add(alice, split_mode="exact", split_with={alice_id: 400.0, bob_id: 350.0}, total=1200.0)
check("toplami tutmayan tutarlar reddedildi", r.status_code == 400, r.text[:120])
r = add(alice, split_mode="equal", split_with={dave_id: 1}, total=10.0)
check("ev disindan kisi reddedildi", r.status_code == 400, r.text[:120])
r = add(alice, split_mode="equal", split_with={}, total=10.0)
check("bos liste reddedildi", r.status_code == 400, r.text[:120])
r = add(alice, split_mode="exact",
        split_with={alice_id: 333.33, bob_id: 333.33, carol_id: 333.34}, total=1000.0)
check("kurus farki tolere edildi", r.status_code == 200, r.text[:120])
c.delete(f"{API}/expenses/{r.json()['expense']['expense_id']}", headers=hdr(alice))


print("\n-- 6. liste kayit aninda donuyor --")
# Dave sonradan katiliyor. Yukaridaki harcamalarin hicbirinde adi gecmiyor,
# dolayisiyle payini ustlenmemeli. Eski modelde ustlenirdi.
before = net_of(alice)
c.post(f"{API}/households/join", headers=hdr(dave), json={"invite_code": invite})
c.post(f"{API}/households/approve", headers=hdr(alice), json={"user_id": dave_id})
after = net_of(alice)
check("Dave'in bakiyesi sifir", near(after.get(dave_id, 0), 0.0), after)
for uid, label in ((alice_id, "Alice"), (bob_id, "Bob"), (carol_id, "Carol")):
    check(f"{label} katilimdan etkilenmedi", near(before[uid], after[uid]),
          f"{before[uid]} -> {after[uid]}")

# Dave katildiktan SONRA eklenen ev harcamasi dorde bolunmeli.
r = add(alice, split_mode="equal",
        split_with={alice_id: 1, bob_id: 1, carol_id: 1, dave_id: 1}, total=40.0)
check("yeni harcama dorde bolundu", near(net_of(alice)[dave_id], -10.0), net_of(alice))


print("\n-- 6b. 'gecmise de kat' secenegi --")
# Kisi donem basindan beri fiziksel olarak evde, uygulamaya sonradan katildi.
# Yonetici onaylarken acik donemin ev harcamalarini da ustlenmesini secebiliyor.
e3, e3_id = reg("kat")
r = c.post(f"{API}/households", headers=hdr(e3), json={"name": f"Kat Ev {TAG}"})
inv3 = r.json()["household"]["invite_code"]
g3, g3_id = reg("katdost")
add(e3, split_mode="equal", split_with={e3_id: 1}, total=60.0)  # tek kisilik ev
before_count = c.get(f"{API}/households/me", headers=hdr(e3)).json()["open_expense_count"]
check("acik donem ev harcamasi sayiliyor", before_count == 1, before_count)

c.post(f"{API}/households/join", headers=hdr(g3), json={"invite_code": inv3})
r = c.post(f"{API}/households/approve", headers=hdr(e3),
           json={"user_id": g3_id, "include_open_period": True})
check("gecmise kat secenegi kabul edildi", r.status_code == 200, r.text[:160])
check("1 harcamaya eklendi", r.json().get("joined_expenses") == 1, r.text[:160])
n = net_of(e3)
check("60 EUR ikiye bolundu", near(n[e3_id], 30.0) and near(n[g3_id], -30.0), n)

# Ayni ev, ikinci katilim: bu kez katilmasin.
h3, h3_id = reg("katdost2")
c.post(f"{API}/households/join", headers=hdr(h3), json={"invite_code": inv3})
r = c.post(f"{API}/households/approve", headers=hdr(e3),
           json={"user_id": h3_id, "include_open_period": False})
check("katilmasin secenegi kabul edildi", r.status_code == 200, r.text[:160])
n = net_of(e3)
check("ucuncu kisi gecmise girmedi", near(n.get(h3_id, 0), 0.0), n)
check("ilk ikisinin payi degismedi", near(n[e3_id], 30.0) and near(n[g3_id], -30.0), n)


print("\n-- 7. duzenleme --")
r = c.patch(f"{API}/expenses/{kira['expense_id']}", headers=hdr(bob), json={
    "split_mode": "exact", "split_with": {alice_id: 300.0, bob_id: 400.0, carol_id: 500.0}})
check("bolusum duzenlenebiliyor", r.status_code == 200, r.text[:200])
n = net_of(alice)
# yumurta +15 | kira -300 | ev 90 -30 | Carol'un aldigi -18 | ev 40 (+40-10)
check("Alice'in payi 350 -> 300 dustu", near(n[alice_id], 15 - 300 - 30 - 18 + 30), n)
# kira -500 | ev 90 (+90-30) | Alice icin aldigi +18 | ev 40 -10
check("Carol'un payi 450 -> 500 cikti", near(n[carol_id], -500 + 60 + 18 - 10), n)
check("duzenleme sonrasi toplam sifir", near(sum(n.values()), 0.0), n)

# Kisiye ozel bolusum varken tutari tek basina degistirmek sessizce yanlis
# borc uretir; sunucu reddetmeli.
r = c.patch(f"{API}/expenses/{kira['expense_id']}", headers=hdr(bob), json={"total": 1300.0})
check("tutar tek basina degistirilemedi", r.status_code == 400, r.text[:160])
r = c.patch(f"{API}/expenses/{kira['expense_id']}", headers=hdr(bob), json={
    "total": 1300.0, "split_mode": "exact",
    "split_with": {alice_id: 400.0, bob_id: 400.0, carol_id: 500.0}})
check("tutar + bolusum birlikte degistirilebildi", r.status_code == 200, r.text[:160])


print("\n-- 7b. bolusum degisince kime ne yaziliyor --")
# Duzenleme fiilen yeni bir bolusum demek. Uc ayri kitle var ve ucune ayni
# cumleyi yazmak en onemli ikisini gizler: eklenenin borcu artti, cikarilanin
# dustu. "artik 90 EUR" mesaji ikisine de yanlis okunuyor.
def titles(tok):
    r = c.get(f"{API}/notifications", headers=hdr(tok)).json()
    return [n["title"] for n in r.get("notifications", [])]

r = add(alice, split_mode="equal", split_with={alice_id: 1, bob_id: 1}, total=60.0,
        category="BILDIRIM")
bildirim = r.json()["expense"]["expense_id"]
before_c = len(titles(carol))
# Carol eklendi, Bob cikarildi, Alice (ekleyen) hicbir sey almamali.
r = c.patch(f"{API}/expenses/{bildirim}", headers=hdr(alice), json={
    "split_mode": "equal", "split_with": {alice_id: 1, carol_id: 1}})
check("bolusum degistirildi", r.status_code == 200, r.text[:160])
check("eklenen kisiye 'eklendin' yazildi",
      titles(carol)[0:1] == ["Bir harcamaya eklendin"], str(titles(carol)[:2]))
check("cikarilan kisiye 'cikarildin' yazildi",
      titles(bob)[0:1] == ["Bir harcamadan cikarildin"] or
      titles(bob)[0:1] == ["Bir harcamadan çıkarıldın"], str(titles(bob)[:2]))
check("ekleyene bildirim gitmedi",
      "Bir harcamaya eklendin" not in titles(alice), str(titles(alice)[:3]))
c.delete(f"{API}/expenses/{bildirim}", headers=hdr(alice))
check("silinince de listedekilere gidiyor",
      titles(carol)[0:1] == ["Harcama silindi"], str(titles(carol)[:2]))


print("\n-- 8. eski kayitlar (split_with alani yok) --")
# Eski APK'nin gonderdigi bicim: sadece target_type. Sunucu listeyi turetiyor.
e2, e2_id = reg("eski")
r = c.post(f"{API}/households", headers=hdr(e2), json={"name": f"Eski Ev {TAG}"})
inv2 = r.json()["household"]["invite_code"]
f2, f2_id = reg("eskidost")
c.post(f"{API}/households/join", headers=hdr(f2), json={"invite_code": inv2})
c.post(f"{API}/households/approve", headers=hdr(e2), json={"user_id": f2_id})

add(e2, target_type="household", total=100.0)
add(e2, target_type="roommate", target_user_id=f2_id, total=20.0)
add(e2, target_type="self", total=50.0)
n = net_of(e2)
check("eski household ikiye bolundu", near(n[e2_id], 50 + 20), n)
check("eski roommate hedefe yazildi", near(n[f2_id], -50 - 20), n)
check("eski self dengeye girmedi", near(sum(n.values()), 0.0), n)


print("\n-- 9. coklu ev altyapisi --")
# `get_user_household()` artik `active_household_id` alanini okuyor. Bugun
# davranis ayni cikmali: alan bos oldugu icin uyesi olunan tek ev bulunuyor.
# Bu altyapi erken kuruldu cunku maliyeti zamanla artiyordu -- cagri sayisi
# v18'de 24, bugun 31; her tur birkac tane daha ekliyor.
r = c.get(f"{API}/households/me", headers=hdr(alice)).json()
check("ev bulunuyor (alan bosken eski davranis)",
      r.get("household", {}).get("name", "").startswith("Bolusme Ev"), str(r)[:120])
check("uyeler eksiksiz", len(r.get("members", [])) == 4, str(len(r.get("members", []))))
# Evden ayrilanin evi gorunmemeli
tmp, tmp_id = reg("gecici")
check("evsiz kullanicida ev yok",
      c.get(f"{API}/households/me", headers=hdr(tmp)).json().get("household") is None)
c.post(f"{API}/auth/logout", headers=hdr(tmp))


print("\n-- temizlik --")
for tok in (alice, bob, carol, dave, e2, f2, e3, g3, h3):
    c.post(f"{API}/households/leave", headers=hdr(tok))
    c.post(f"{API}/auth/logout", headers=hdr(tok))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
