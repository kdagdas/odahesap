"""Hareket akislari: `/expenses?akis=` ile Kasa ekstresi ayni tanimdan besleniyor.

Tur 10'da Kasa'nin ekstre blogu satir satir aciliyor ve bir HAREKET satirina
dokununca Harcamalar sayfasi suzulmus olarak aciliyor. Suzgec once telefonda,
`split_with` alanina bakarak yapiliyordu ve Tur 4 oncesi kayitlari kaciriyordu:
o kayitlarda alan hic yok, `split_of()` yedek yolu ise yalnizca sunucuda
calisiyor. Belirtisi "Senin icin alinanlar 3 EUR" yazip icinin bos acilmasiydi
-- bir gizlilik kurali gibi gorunuyordu, oysa yalnizca eksik veriydi.

Bu takimin korudugu asil sey **degismezlik**: ekstredeki bir satirin tutari ile
o satira dokununca acilan listenin toplami birebir ayni olmali. Ikisi de
`akis_paylari()` okuyor; bu dosya onlarin ayrismadigini kontrol ediyor.
"""
import sys
import uuid
from datetime import date

import httpx

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8001").rstrip("/")
API = f"{BASE}/api"
TAG = uuid.uuid4().hex[:8]
AY = date.today().strftime("%Y-%m")

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
        "email": f"aks_{who}_{TAG}@odahesap-e2e.com",
        "password": "sifre123", "name": f"{who.title()} Test"})
    r.raise_for_status()
    return r.json()["session_token"], r.json()["user"]["user_id"]


alice, alice_id = reg("alice")
bob, bob_id = reg("bob")
carol, carol_id = reg("carol")

print("\n-- ev kurulumu --")
r = c.post(f"{API}/households", headers=hdr(alice), json={"name": f"Akis Ev {TAG}"})
check("ev kuruldu", r.status_code == 200, r.text[:200])
kod = r.json()["household"]["invite_code"]
for jeton, uid in ((bob, bob_id), (carol, carol_id)):
    c.post(f"{API}/households/join", headers=hdr(jeton), json={"invite_code": kod})
    c.post(f"{API}/households/approve", headers=hdr(alice), json={"user_id": uid})
r = c.get(f"{API}/households/me", headers=hdr(alice))
check("uc kisi", len(r.json()["members"]) == 3, str(len(r.json()["members"])))


def harcama(jeton, **kw):
    r = c.post(f"{API}/expenses", headers=hdr(jeton), json=kw)
    r.raise_for_status()
    return r.json()["expense"]["expense_id"]


print("\n-- harcamalar --")
# Ev harcamasi: alice odedi, ucu bolusuyor. Herkes icin 20, alice icin ayrica 60.
ev = harcama(alice, total=60.0, target_type="household", merchant="REWE")
# Bob, carol icin aldi: bob'un borcu dustu, carol'unki artti.
ikili = harcama(bob, total=30.0, target_type="roommate", target_user_id=carol_id,
                merchant="DM")
# Kisisel: bakiyeye hic girmiyor, hicbir akista gorunmemeli.
kisisel = harcama(alice, total=15.0, target_type="self", merchant="Kitapci")
check("uc harcama yazildi", all((ev, ikili, kisisel)))


def suz(jeton, akis):
    r = c.get(f"{API}/expenses?month={AY}&akis={akis}", headers=hdr(jeton))
    r.raise_for_status()
    return r.json()["expenses"]


print("\n-- akis suzgeci: kim neyi goruyor --")
a_pay = suz(alice, "pay")
check("alice · pay: yalniz ev harcamasi", [e["expense_id"] for e in a_pay] == [ev],
      str([e["merchant"] for e in a_pay]))
check("alice · pay tutari 20", a_pay and abs(a_pay[0]["akis_tutar"] - 20.0) < 0.01,
      str(a_pay[:1]))

a_odedi = suz(alice, "ev_odedigin")
check("alice · ev_odedigin: ev harcamasi", [e["expense_id"] for e in a_odedi] == [ev])
check("alice · ev_odedigin tutari FISIN TAMAMI (60)",
      a_odedi and abs(a_odedi[0]["akis_tutar"] - 60.0) < 0.01, str(a_odedi[:1]))

check("alice · baskasi_icin bos", suz(alice, "baskasi_icin") == [])
check("alice · senin_icin bos", suz(alice, "senin_icin") == [])

b_baskasi = suz(bob, "baskasi_icin")
check("bob · baskasi_icin: ikili harcama", [e["expense_id"] for e in b_baskasi] == [ikili])
check("bob · baskasi_icin tutari 30", b_baskasi and abs(b_baskasi[0]["akis_tutar"] - 30.0) < 0.01)
check("bob · pay: ev harcamasi", [e["expense_id"] for e in suz(bob, "pay")] == [ev])
check("bob · senin_icin bos", suz(bob, "senin_icin") == [])
check("bob · ev_odedigin bos (odeyen alice)", suz(bob, "ev_odedigin") == [])

c_senin = suz(carol, "senin_icin")
check("carol · senin_icin: ikili harcama", [e["expense_id"] for e in c_senin] == [ikili])
check("carol · senin_icin tutari 30", c_senin and abs(c_senin[0]["akis_tutar"] - 30.0) < 0.01)
check("carol · baskasi_icin bos", suz(carol, "baskasi_icin") == [])

print("\n-- kisisel harcama hicbir akista yok --")
for jeton, ad in ((alice, "alice"), (bob, "bob"), (carol, "carol")):
    hepsi = set()
    for t in ("pay", "ev_odedigin", "baskasi_icin", "senin_icin"):
        hepsi |= {e["expense_id"] for e in suz(jeton, t)}
    check(f"{ad} · kisisel harcama akislarda yok", kisisel not in hepsi)
# Ama sahibi onu normal listede goruyor: gizlenmiyor, yalnizca bakiyeye girmiyor.
r = c.get(f"{API}/expenses?month={AY}", headers=hdr(alice))
check("kisisel harcama sahibinin listesinde duruyor",
      kisisel in {e["expense_id"] for e in r.json()["expenses"]})

print("\n-- DEGISMEZLIK: ekstre satiri == suzulen listenin toplami --")
# Bu takimin varlik sebebi. Iki taraf ayrisirsa kullanici ekranda bir tutar
# gorup dokundugunda baska bir toplam buluyor ve sayilara guveni bitiyor.
FISLI = ("pay", "ev_odedigin", "baskasi_icin", "senin_icin")
for jeton, ad in ((alice, "alice"), (bob, "bob"), (carol, "carol")):
    st = c.get(f"{API}/balances", headers=hdr(jeton)).json()["statement"]
    satir_sayisi = 0
    for kutu in st["months"]:
        for satir in kutu.get("lines", []):
            if satir["tur"] not in FISLI:
                continue
            satir_sayisi += 1
            r = c.get(f"{API}/expenses?month={kutu['month']}&akis={satir['tur']}",
                      headers=hdr(jeton))
            toplam = sum(e["akis_tutar"] for e in r.json()["expenses"])
            check(f"{ad} · {kutu['month']} · {satir['tur']} = {satir['tutar']}",
                  abs(toplam - satir["tutar"]) < 0.02,
                  f"liste {toplam}")
    check(f"{ad} · ekstrede fisli satir var", satir_sayisi > 0, str(satir_sayisi))

print("\n-- bilinmeyen akis hicbir sey dondurmez --")
check("akis=uydurma bos liste", suz(alice, "uydurma") == [])

print("\n-- ay disi kalanlar suzuluyor --")
r = c.get(f"{API}/expenses?month=2000-01&akis=pay", headers=hdr(alice))
check("baska ayda kayit yok", r.json()["expenses"] == [])

print(f"\n{ok} gecti, {fail} kaldi")
sys.exit(1 if fail else 0)
