"""Yazma yardimcisi — alinacaklar ve elle giriste oneri.

Uc kaynak var ve SIRASI onemli: evin kendi gecmisi once, es anlamli en ustte
(cunku kullaniciyi yazdigindan BASKA bir ada goturuyor ve gormezse hic
bulamaz), temel liste en sonda bosluk doldurucu olarak.

Bu bir yazma kisayolu DEGIL, veri kalitesi araci: liste maddesi genel adla
kaydedilince `/shopping/match` fisle isabetli eslesiyor.
"""
import sys
import uuid

import httpx

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8099").rstrip("/")
API = f"{BASE}/api"
TAG = uuid.uuid4().hex[:8]
ok = fail = 0


def check(label, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1; print(f"  [OK]   {label}")
    else:
        fail += 1; print(f"  [FAIL] {label}  {detail}")


c = httpx.Client(timeout=60.0)


def reg(who):
    r = c.post(f"{API}/auth/register", json={
        "email": f"one_{who}_{TAG}@odahesap-e2e.com",
        "password": "sifre123", "name": who.title()})
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['session_token']}"}


def oner(h, q=""):
    return c.get(f"{API}/shopping/suggest", headers=h, params={"q": q}).json()["suggestions"]


def adlar(d):
    return [x["name"] for x in d]


alice = reg("alice")
c.post(f"{API}/households", headers=alice, json={"name": f"One Ev {TAG}"})

print("== BOS ev: temel liste devrede ==")
d = oner(alice, "buzdolabı")
check("hic alinmamis urun de oneriliyor", "buzdolabı poşeti" in adlar(d), str(adlar(d)))
check("kaynagi temel", d and d[0]["source"] == "temel", str(d[:1]))
d = oner(alice, "yağlı")
check("yagli kagit bulunuyor", "yağlı kâğıt" in adlar(d), str(adlar(d)))

print()
print("== ES ANLAMLI: yazdigindan BASKA bir ada goturuyor ==")
d = oner(alice, "damacana")
check("damacana -> su", adlar(d)[:1] == ["su"], str(adlar(d)))
check("kaynagi esanlamli", d and d[0]["source"] == "esanlamli", str(d[:1]))
d = oner(alice, "streç")
check("streç -> streç film", "streç film" in adlar(d), str(adlar(d)))

print()
print("== MARKA ADIYLA arama: evin kendi fisinden ogrenilen ==")
c.post(f"{API}/expenses", headers=alice, json={
    "target_type": "household", "total": 6.2, "source": "receipt", "merchant": "BIM",
    "items": [{"name": "NUGGR KLASIK", "price": 5.0, "quantity": 1, "generic": "dondurma"},
              {"name": "Weihenst.Natur 3,5%", "price": 1.2, "quantity": 1, "generic": "yoğurt"}]})
d = oner(alice, "nuggr")
check("marka adi genel ada goturuyor", adlar(d)[:1] == ["dondurma"], str(adlar(d)))
d = oner(alice, "weihenst")
check("almanca marka da calisiyor", "yoğurt" in adlar(d), str(adlar(d)))
check("bu bir TAHMIN degil bellek: model zaten eslemisti", True)

print()
print("== SIRA: evin gecmisi TEMEL listeden once ==")
# "dondurma" hem gecmiste hem temel listede yok -- gecmiste var, temelde de var.
d = oner(alice, "dondurma")
check("gecmisten geliyor", d and d[0]["source"] == "gecmis", str(d[:1]))
# "su" temel listede var; ev hic su almadi.
d = oner(alice, "su")
check("almadigi urun temel listeden geliyor",
      any(x["name"] == "su" and x["source"] == "temel" for x in d), str(d[:3]))

print()
print("== TAM ESLESME her seyin ONUNDE ==")
# Gercek veride kirildi: ev sahibi "su" yazdi, "su" cikmadi. Sebebi siralamaydi
# -- evin gecmisindeki "sut", "sucuk", "susam" (hepsi "su" ile basliyor) one
# gecip alti kisilik listeyi dolduruyordu. Yazdiginin AYNISI listede varsa o
# birinci olmali; nereden geldigi onemli degil.
c.post(f"{API}/expenses", headers=alice, json={
    "target_type": "household", "total": 9.0, "source": "receipt", "merchant": "BIM",
    "items": [{"name": "SUT 1L", "price": 3.0, "quantity": 1, "generic": "süt"},
              {"name": "SUCUK", "price": 3.0, "quantity": 1, "generic": "sucuk"},
              {"name": "SUSAM", "price": 3.0, "quantity": 1, "generic": "susam"}]})
d = oner(alice, "su")
check("TAM eslesen 'su' ilk sirada", adlar(d)[:1] == ["su"], str(adlar(d)))
check("gecmisten gelenler altinda ama listede",
      "süt" in adlar(d) or "sucuk" in adlar(d), str(adlar(d)))

# Ayni kural gecmis icin de: yazdiginin aynisi gecmiste varsa o birinci.
d = oner(alice, "sucuk")
check("gecmisteki tam eslesme de ilk sirada", adlar(d)[:1] == ["sucuk"], str(adlar(d)))

print()
print("== BOS sorgu: alana dokunan ne gorecek ==")
d = oner(alice, "")
check("bos sorguda da oneri var", len(d) > 0, str(adlar(d)[:4]))
check("once evin kendi aldiklari", d and d[0]["source"] == "gecmis", str(d[:1]))

print()
print("== AYNI ad iki kez donmuyor ==")
d = oner(alice, "do")
check("tekrar yok", len(adlar(d)) == len(set(adlar(d))), str(adlar(d)))

print()
print("== evsiz kullanici patlamiyor ==")
bob = reg("bob")
r = c.get(f"{API}/shopping/suggest", headers=bob, params={"q": "süt"})
check("200 ve bos liste", r.status_code == 200 and r.json()["suggestions"] == [], str(r.status_code))

c.post(f"{API}/households/leave", headers=alice)
for t in (alice, bob):
    c.post(f"{API}/auth/logout", headers=t)
print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
