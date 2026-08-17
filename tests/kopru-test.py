"""Alinacaklar <-> fis koprusu.

Fisi tarayip kaydettikten sonra, fisteki kalemler bekleyen alinacaklar
listesiyle eslestiriliyor. Uc kural korunuyor:

  1. Sunucu yalnizca ONERIR, hicbir seyi isaretlemez. Liste PAYLASILAN bir sey;
     ev arkadasinin yazdigi maddeyi haber vermeden silmek uygulamanin en cok
     guven kaybedecegi yer olurdu.
  2. Kesin eslesme `sure=True` doner (kutu isaretli acilir), iceren eslesme
     `sure=False` (kutu bos acilir). Yanlis dusurmek, dusurmemekten pahali.
  3. Zaten alinmis maddeler ve BASKASININ kisisel listesi hic bakilmaz.

Eslestirme Tur 8'in genel urun adi isinin uzerine kuruluyor: fiste
"SAHNE 200G" yaziyor, listede "Krema" -- ikisi de ayni anahtara dusuyor.

    cd backend
    .venv/Scripts/python.exe ../tests/kopru-test.py http://127.0.0.1:8099

Sunucuyu AYRI veritabaniyla baslatin: DB_NAME=odahesap_test
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
        "email": f"kpr_{who}_{TAG}@odahesap-e2e.com",
        "password": "sifre123", "name": who.title()})
    r.raise_for_status()
    return r.json()["session_token"], r.json()["user"]["user_id"]


alice, alice_id = reg("alice")
bob, bob_id = reg("bob")
r = c.post(f"{API}/households", headers=hdr(alice), json={"name": f"Köprü {TAG}"})
kod = r.json()["household"]["invite_code"]
c.post(f"{API}/households/join", headers=hdr(bob), json={"invite_code": kod})
c.post(f"{API}/households/approve", headers=hdr(alice), json={"user_id": bob_id})
print(f"2 kisilik ev kuruldu ({TAG})")


def ekle(tok, metin, scope="household"):
    r = c.post(f"{API}/shopping", headers=hdr(tok), json={"text": metin, "scope": scope})
    r.raise_for_status()
    return r.json()["item"]["item_id"]


def eslestir(tok, adlar):
    r = c.post(f"{API}/shopping/match", headers=hdr(tok), json={"names": adlar})
    r.raise_for_status()
    return r.json()["matches"]


print("\n-- liste hazirlaniyor --")
krema = ekle(alice, "Krema")
kori = ekle(bob, "Köri")              # Bob yazdi, Alice dusurebilmeli
yagli = ekle(alice, "Yağlı kağıt")
kisisel = ekle(alice, "Tıraş köpüğü", scope="self")
alinmis = ekle(alice, "Buzluk")
c.patch(f"{API}/shopping/{alinmis}", headers=hdr(alice), json={"done": True})
check("liste kuruldu", all([krema, kori, yagli, kisisel, alinmis]))


print("\n-- 1. birebir eslesme: isaretli gelir --")
m = eslestir(alice, ["Krema", "SUCUK 250G"])
esles = {x["item_id"]: x for x in m}
check("Krema eslesti", krema in esles, str(m))
check("kesin eslesme sure=True", esles.get(krema, {}).get("sure") is True, str(m))
check("fisteki ad da donuyor", esles.get(krema, {}).get("receipt_name") == "Krema", str(m))
check("eslesmeyen kalem oneri uretmiyor", len(m) == 1, str(m))


print("\n-- 2. iceren eslesme: kutu BOS gelir --")
sut = ekle(alice, "Süt")
m = eslestir(alice, ["TAM YAĞLI SÜT 1L"])
e = {x["item_id"]: x for x in m}
check("Süt eslesti", sut in e, str(m))
check("emin degil -> sure=False", e.get(sut, {}).get("sure") is False, str(m))


print("\n-- 3. baskasinin yazdigi madde de eslesir --")
m = eslestir(alice, ["Köri"])
check("Bob'un maddesi Alice'e onerildi",
      any(x["item_id"] == kori for x in m), str(m))


print("\n-- 4. ALINMIS madde ve KISISEL liste hic bakilmaz --")
m = eslestir(alice, ["Buzluk", "Tıraş köpüğü"])
check("alinmis madde onerilmiyor", not any(x["item_id"] == alinmis for x in m), str(m))
check("kisisel liste onerilmiyor", not any(x["item_id"] == kisisel for x in m), str(m))


print("\n-- 5. sunucu HICBIR SEYI isaretlemiyor --")
# Yukarida bircok kez eslestirdik; liste hala oldugu gibi durmali.
liste = c.get(f"{API}/shopping", headers=hdr(alice)).json()["items"]
bekleyen = {i["item_id"] for i in liste if not i["done"]}
check("Krema hala bekliyor", krema in bekleyen, str(bekleyen))
check("Köri hala bekliyor", kori in bekleyen, str(bekleyen))
check("Süt hala bekliyor", sut in bekleyen, str(bekleyen))


print("\n-- 6. onay: isaretlemeyi ISTEMCI yapiyor --")
c.patch(f"{API}/shopping/{krema}", headers=hdr(alice), json={"done": True})
liste = c.get(f"{API}/shopping", headers=hdr(alice)).json()["items"]
kayit = next(i for i in liste if i["item_id"] == krema)
check("Krema alindi olarak isaretlendi", kayit["done"] is True, str(kayit))
check("kimin isaretledigi yazildi", kayit.get("done_by") == alice_id, str(kayit))
# Isaretlenen madde artik onerilmiyor.
m = eslestir(alice, ["Krema"])
check("alinan madde tekrar onerilmiyor", not any(x["item_id"] == krema for x in m), str(m))


print("\n-- 7. bos istek dusurmuyor --")
check("bos ad listesi bos sonuc", eslestir(alice, []) == [])
check("evsiz kullanici da dusurmuyor",
      c.post(f"{API}/shopping/match", headers=hdr(reg("carol")[0]),
             json={"names": ["Krema"]}).json()["matches"] == [])


print("\n-- temizlik --")
for tok in (bob, alice):
    c.post(f"{API}/households/leave", headers=hdr(tok))
    c.post(f"{API}/auth/logout", headers=hdr(tok))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
