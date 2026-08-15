"""Market ismi birlestirme ve ayni fis uyarisi.

Iki ayri sorun, ayni ekranda cikiyor:

- Fis uzerindeki isim her seferinde ayni yazilmiyor. "Bizim Fleisher GmbH" ile
  "Bizim Fleischer" ayni yer ama istatistikte iki satir oluyordu.
- Galeriden ayni fisin iki fotografi secilebiliyor. Dosya karsilastirmasi ise
  yaramaz (iki ayri fotograf), fisin kendisine bakmak gerekiyor.
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

r = c.post(f"{API}/auth/register", json={
    "email": f"mk_{TAG}@odahesap-e2e.com", "password": "sifre123", "name": "Alice"})
alice = r.json()["session_token"]
c.post(f"{API}/households", headers=hdr(alice), json={"name": f"Market Ev {TAG}"})


def ekle(merchant, total=10.0, tarih="2026-03-04"):
    return c.post(f"{API}/expenses", headers=hdr(alice), json={
        "target_type": "household", "total": total, "source": "receipt",
        "merchant": merchant, "expense_date": tarih, "items": []}).json()["expense"]


print("== ticari unvan ekleri ==")
e1 = ekle("Bizim Fleischer", 25.0)
check("ilk kayit oldugu gibi", e1["merchant"] == "Bizim Fleischer", str(e1["merchant"]))

e2 = ekle("Bizim Fleischer GmbH", 31.0)
check("GmbH eki birlestirildi", e2["merchant"] == "Bizim Fleischer", str(e2["merchant"]))

e3 = ekle("BIZIM FLEISCHER", 12.0)
check("buyuk harf birlestirildi", e3["merchant"] == "Bizim Fleischer", str(e3["merchant"]))

print("\n== yazim hatasi ==")
e4 = ekle("Bizim Fleisher gMBH", 18.0)
check("tek harf farki birlestirildi", e4["merchant"] == "Bizim Fleischer", str(e4["merchant"]))

print("\n== Turkiye ==")
t1 = ekle("BİM", 40.0)
t2 = ekle("BİM BİRLEŞİK MAĞAZALAR A.Ş.", 22.0)
check("A.S. eki birlestirildi", t2["merchant"] == "BİM", str(t2["merchant"]))

print("\n== farkli marketler BIRLESMEMELI ==")
f1 = ekle("REWE", 15.0)
check("REWE ayri kaldi", f1["merchant"] == "REWE", str(f1["merchant"]))
f2 = ekle("PENNY", 15.0)
check("PENNY ayri kaldi", f2["merchant"] == "PENNY", str(f2["merchant"]))
f3 = ekle("A101", 15.0)
check("A101 ayri kaldi", f3["merchant"] == "A101", str(f3["merchant"]))

print("\n== duzenlemede de calismali ==")
r = c.patch(f"{API}/expenses/{f1['expense_id']}", headers=hdr(alice),
            json={"merchant": "  rewe gmbh "})
check("duzenlemede birlestirildi", r.json()["expense"]["merchant"] == "REWE",
      str(r.json()["expense"]["merchant"]))

print("\n== istatistikte tek satir ==")
s = c.get(f"{API}/stats", headers=hdr(alice)).json()
adlar = [m["name"] for m in s["merchants"]]
check("Bizim Fleischer tek satir", adlar.count("Bizim Fleischer") == 1, str(adlar))
check("BIM tek satir", adlar.count("BİM") == 1, str(adlar))

print("\n== ayni fis uyarisi ==")
d = c.get(f"{API}/expenses/duplicate-check",
          headers=hdr(alice), params={"total": 25.0, "expense_date": "04.03.2026",
                                      "merchant": "Bizim Fleischer"}).json()
check("ayni fis bulundu", len(d["duplicates"]) >= 1, str(len(d["duplicates"])))

d2 = c.get(f"{API}/expenses/duplicate-check",
           headers=hdr(alice), params={"total": 25.0, "expense_date": "04.03.2026",
                                       "merchant": "Bizim Fleisher GmbH"}).json()
check("farkli yazilan ayni market de yakalandi", len(d2["duplicates"]) >= 1, str(len(d2["duplicates"])))

d3 = c.get(f"{API}/expenses/duplicate-check",
           headers=hdr(alice), params={"total": 999.0, "expense_date": "04.03.2026",
                                       "merchant": "Bizim Fleischer"}).json()
# Olcut tutar DEGIL market+tarih: OCR ayni fisin iki fotografindan farkli kalem
# listesi cikarabiliyor ve toplam birkac kurus kayinca tam eslesme kaciyordu.
check("tutar farkli olsa da ayni market+tarih uyariyor",
      len(d3["duplicates"]) >= 1, str(len(d3["duplicates"])))

d3b = c.get(f"{API}/expenses/duplicate-check",
            headers=hdr(alice), params={"total": 25.0, "expense_date": "04.03.2026",
                                        "merchant": "Hic Gitmedigimiz Market"}).json()
check("farkli market uyarmiyor", d3b["duplicates"] == [], str(d3b["duplicates"]))

d4 = c.get(f"{API}/expenses/duplicate-check",
           headers=hdr(alice), params={"total": 25.0, "expense_date": "09.09.2026",
                                       "merchant": "Bizim Fleischer"}).json()
check("farkli tarih uyarmiyor", d4["duplicates"] == [], str(d4["duplicates"]))

print("\n== baska evin fisi gorunmemeli ==")
r = c.post(f"{API}/auth/register", json={
    "email": f"mk2_{TAG}@odahesap-e2e.com", "password": "sifre123", "name": "Bob"})
bob = r.json()["session_token"]
c.post(f"{API}/households", headers=hdr(bob), json={"name": f"Yabanci {TAG}"})
d5 = c.get(f"{API}/expenses/duplicate-check",
           headers=hdr(bob), params={"total": 25.0, "expense_date": "04.03.2026",
                                     "merchant": "Bizim Fleischer"}).json()
check("yabanci ev hicbir sey gormuyor", d5["duplicates"] == [], str(d5["duplicates"]))

print("\n== temizlik ==")
for t in (alice, bob):
    c.post(f"{API}/households/leave", headers=hdr(t))
    c.post(f"{API}/auth/logout", headers=hdr(t))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
