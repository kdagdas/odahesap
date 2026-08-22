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

from ortak import odes

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


print("\n-- KIMIN ICIN suzgeci: kategori ALICIDAN BAGIMSIZ --")
# `ev` kategorisi kimin aldigina bakmiyor: listeyi bolusme belirliyor. Ucu de
# ayni ev harcamasini "eve alinanlar"da goruyor -- alan Alice olsa bile.
for jeton, ad in ((alice, "alice"), (bob, "bob"), (carol, "carol")):
    check(f"{ad} · ev: ayni ev harcamasi", [e["expense_id"] for e in suz(jeton, "ev")] == [ev],
          str([e["merchant"] for e in suz(jeton, "ev")]))
check("ev tutari FISIN TAMAMI (60)",
      abs(suz(bob, "ev")[0]["total"] - 60.0) < 0.01, str(suz(bob, "ev")[:1]))
check("ama pay ayrica geliyor (20)",
      abs(suz(bob, "ev")[0]["my_share"] - 20.0) < 0.01, str(suz(bob, "ev")[:1]))

# Alan sen, listede baskasi da var -> "baskasi icin aldiklarin"
b_baskasi = suz(bob, "baskasi")
check("bob · baskasi: carol icin aldigi", [e["expense_id"] for e in b_baskasi] == [ikili])
check("bob · bana bos", suz(bob, "bana") == [])

# Seni iceren alt kume, alan baskasi -> "sana alinanlar"
c_bana = suz(carol, "bana")
check("carol · bana: bob'un onun icin aldigi", [e["expense_id"] for e in c_bana] == [ikili])
check("carol · baskasi bos", suz(carol, "baskasi") == [])

# Alice o ikili harcamada hic yok: gormuyor bile.
check("alice · bana bos", suz(alice, "bana") == [])
check("alice · baskasi bos", suz(alice, "baskasi") == [])

print("\n-- KISI ekseni ile CARPILABILIYOR --")
# "Kemal'in eve aldiklari" = ev + kisi:Kemal. Iki eksen bagimsiz.
r = c.get(f"{API}/expenses?month={AY}&akis=ev&member_id={alice_id}", headers=hdr(bob))
check("ev + kisi:alice -> alice'in eve aldigi",
      [e["expense_id"] for e in r.json()["expenses"]] == [ev], r.text[:200])
r = c.get(f"{API}/expenses?month={AY}&akis=ev&member_id={bob_id}", headers=hdr(bob))
check("ev + kisi:bob -> bos (bob eve bir sey almadi)",
      r.json()["expenses"] == [], r.text[:200])

print("\n-- kisisel harcama kendi kategorisinde --")
a_kendim = suz(alice, "kendim")
check("alice · kendim: kisisel harcama", [e["expense_id"] for e in a_kendim] == [kisisel],
      str([e["merchant"] for e in a_kendim]))
# Baskasinin kisiseli hic gorunmuyor -- gizlilik kurali degismedi.
check("bob · kendim bos", suz(bob, "kendim") == [])
# Ve ev/bana/baskasi kategorilerine SIZMIYOR.
for jeton, ad in ((alice, "alice"), (bob, "bob"), (carol, "carol")):
    hepsi = set()
    for t in ("ev", "bana", "baskasi"):
        hepsi |= {e["expense_id"] for e in suz(jeton, t)}
    check(f"{ad} · kisisel harcama ev/bana/baskasi'nda yok", kisisel not in hepsi)

print("\n-- DEGISMEZLIK: ekstre satirlari ayin degisimini veriyor --")
# Kasa ekstresi bir BAKIYE araci ("borcun nasil olustu"), Harcamalar suzgeci
# bir GOZAT araci ("ne aldik"). Ikisi bilerek ayri eksenler, o yuzden
# tutarlari birebir esitlenmiyor. Ama ekstrenin KENDI icinde tutmasi sart:
# artiran satirlarin toplami eksi azaltanlarin toplami, o ayin deltasidir.
# EV TOPLAMI (son odesmeden bu yana) -- Kasa'daki "Odestik" satirini besliyor.
#
# Kapsam ETIKETTEN degil BOLUSME LISTESINDEN cikiyor, `/stats` ile ayni kural:
# evin tamami listede degilse o harcamayi ev almadi. Bu takimda tek ev
# harcamasi var (60), ikili alim (30) ve kisisel (15) DISARIDA kalmali.
#
# Uc kisinin de ayni sayiyi gormesi sart: ev toplami bir OLGU, kisiye gore
# degismez.
for jeton, ad in ((alice, "alice"), (bob, "bob"), (carol, "carol")):
    st = c.get(f"{API}/balances", headers=hdr(jeton)).json()["statement"]
    check(f"{ad} · ev toplami yalnizca ev harcamasi (60)",
          abs(st.get("ev_toplam", -1) - 60.0) < 0.01, str(st.get("ev_toplam")))

print()
ARTIRAN = ("ev_pay", "bana_pay", "baskasi_pay", "sana_odenen")
for jeton, ad in ((alice, "alice"), (bob, "bob"), (carol, "carol")):
    st = c.get(f"{API}/balances", headers=hdr(jeton)).json()["statement"]
    check(f"{ad} · ekstrede ay var", len(st["months"]) > 0, str(st)[:200])
    for kutu in st["months"]:
        artir = sum(l["tutar"] for l in kutu.get("lines", []) if l["tur"] in ARTIRAN)
        azalt = sum(l["tutar"] for l in kutu.get("lines", []) if l["tur"] not in ARTIRAN)
        check(f"{ad} · {kutu['month']} · satirlarin farki = delta {kutu['delta']}",
              abs((artir - azalt) - kutu["delta"]) < 0.02,
              f"artiran {artir} azaltan {azalt}")
        check(f"{ad} · {kutu['month']} · share - paid = delta",
              abs((kutu["share"] - kutu["paid"]) - kutu["delta"]) < 0.02, str(kutu))

print("\n-- ODESME CIZGISI: kapali donem = odesilmis --")
# Aylik pencereye gecince bir ayin icinde odesilmis ve odesilmemis harcamalar
# yan yana duser oldu (15 Temmuz'da odestiyseniz Temmuz'un yarisi oyle,
# yarisi boyle) ve listede ikisini ayiran hicbir sey yoktu.
onceki = c.get(f"{API}/expenses?month={AY}", headers=hdr(alice)).json()["expenses"]
check("odesmeden once hicbir kayit odesilmis degil",
      all(e.get("odesme") is None for e in onceki),
      str([(e["merchant"], e.get("odesme")) for e in onceki]))

odes(c, API, {alice_id: alice, bob_id: bob, carol_id: carol})

sonra = c.get(f"{API}/expenses?month={AY}", headers=hdr(alice)).json()["expenses"]
eski = {e["expense_id"] for e in onceki}
odesilmis = [e for e in sonra if e["expense_id"] in eski]
check("odestikten sonra eski kayitlar odesilmis",
      odesilmis and all(e.get("odesme") for e in odesilmis),
      str([(e["merchant"], e.get("odesme")) for e in odesilmis]))
check("odesme GUNU yaziyor (YYYY-MM-DD)",
      odesilmis and len(odesilmis[0]["odesme"]) == 10, str(odesilmis[:1]))
check("hepsi ayni gune dusuyor",
      len({e["odesme"] for e in odesilmis}) == 1,
      str({e["odesme"] for e in odesilmis}))

# GEC GIRILEN FIS: odesme cizgisi TARIHE cizilir ama odesilmislik DONEME
# bagli. Odestikten sonra girilen, tarihi eski bir fis cizginin altinda
# kaliyor ama odesilmemis; istemci onu ayrica isaretliyor.
gec = harcama(alice, total=24.0, target_type="household",
              merchant="Gec Fis", expense_date=f"{AY}-01")
liste = c.get(f"{API}/expenses?month={AY}", headers=hdr(alice)).json()["expenses"]
gec_kayit = next(e for e in liste if e["expense_id"] == gec)
check("gec girilen fis ODESILMEMIS", gec_kayit.get("odesme") is None, str(gec_kayit)[:200])
check("ama tarihi cizginin gerisinde", gec_kayit["expense_date"] == f"{AY}-01",
      str(gec_kayit.get("expense_date")))


print("\n-- bilinmeyen akis hicbir sey dondurmez --")
check("akis=uydurma bos liste", suz(alice, "uydurma") == [])

print("\n-- ay disi kalanlar suzuluyor --")
r = c.get(f"{API}/expenses?month=2000-01&akis=pay", headers=hdr(alice))
check("baska ayda kayit yok", r.json()["expenses"] == [])

print(f"\n{ok} gecti, {fail} kaldi")
sys.exit(1 if fail else 0)
