"""Genel ad sozlugunu GECMIS kalemlere uygular.

Neden gerekli: `generic` alani Tur 8'de eklenmis ama `review.tsx` onu
dusuruyordu ve hata ancak Tur 11'de bulundu. Yani 19 Agustos 2026'ya kadar
girilen kalemlerin HICBIRINDE genel ad yok. Bundan sonra taranan fisler kendi
genel adini getiriyor (olculdu); bu betik yalnizca GECMISI onariyor.

Sozluk elle dolduruldu: 155 ham ad -> 83 genel ad. Otomatik bir esleme
denenmedi ve bu bilerek -- yanlis birlestirmek, birlestirmemekten pahali.

Guvenlik:
  * Varsayilan KURU CALISMA. Yazmak icin `--yaz`.
  * Yalnizca `generic` alani BOS olan kalemlere dokunuyor; elle duzeltilmis
    bir genel adi ezmez.
  * `@` ile baslayan isaretler urun DEGIL demek (`@toplu satir` gibi); onlara
    genel ad yazilmiyor, cunku olmayan bir urun uydurmak sayilari bozar.

Kullanim:
    .venv/Scripts/python.exe ../tests/sozluk-uygula.py           # rapor
    .venv/Scripts/python.exe ../tests/sozluk-uygula.py --yaz     # uygula
"""
import csv
import io
import os
import sys
import collections

from dotenv import load_dotenv
from pymongo import MongoClient

SOZLUK = r"D:\SettleUp\genel-ad-sozluk.csv"
YAZ = "--yaz" in sys.argv

load_dotenv(r"D:\SettleUp\OdaHesap\backend\.env")
db = MongoClient(os.environ["MONGO_URL"])[os.environ.get("DB_NAME") or "odahesap_db"]


def sozlugu_oku():
    """`{ham ad (casefold): genel ad}`. `@` isaretleri ayri donuyor."""
    esleme, urun_degil = {}, {}
    with io.open(SOZLUK, encoding="utf-8-sig") as f:
        for i, satir in enumerate(csv.reader(f, delimiter=";")):
            if i == 0 or len(satir) < 3:
                continue
            onay, onerim, ham = satir[0].strip(), satir[1].strip(), satir[2].strip()
            genel = onay or onerim          # bos birakilan satirda onerim gecerli
            if not ham or not genel:
                continue
            if genel.startswith("@"):
                urun_degil[ham.casefold()] = genel[1:]
            else:
                esleme[ham.casefold()] = genel.lower()
    return esleme, urun_degil


esleme, urun_degil = sozlugu_oku()
print(f"sozluk       : {len(esleme)} ham ad -> {len(set(esleme.values()))} genel ad")
print(f"urun degil   : {len(urun_degil)} satir (dokunulmuyor)")
print()

dokunulan = collections.Counter()
eslesmeyen = collections.Counter()
zaten_var = 0
guncellenecek = []      # (expense_id, yeni items)

for e in db.expenses.find({}, {"_id": 0, "expense_id": 1, "items": 1}):
    items = e.get("items") or []
    if not items:
        continue
    yeni, degisti = [], False
    for it in items:
        ad = (it.get("name") or "").strip()
        mevcut = (it.get("generic") or "").strip()
        if not ad:
            yeni.append(it)
            continue
        if mevcut:
            zaten_var += 1
            yeni.append(it)
            continue
        k = ad.casefold()
        if k in esleme:
            yeni.append({**it, "generic": esleme[k]})
            dokunulan[esleme[k]] += 1
            degisti = True
        else:
            if k not in urun_degil:
                eslesmeyen[ad] += 1
            yeni.append(it)
    if degisti:
        guncellenecek.append((e["expense_id"], yeni))

print(f"genel adi zaten olan kalem : {zaten_var}")
print(f"yazilacak kalem            : {sum(dokunulan.values())}")
print(f"etkilenen harcama          : {len(guncellenecek)}")
print(f"sozlukte olmayan ham ad    : {len(eslesmeyen)}")
if eslesmeyen:
    for ad, n in eslesmeyen.most_common(10):
        print(f"    {n}x  {ad}")

print()
print("EN COK TOPLANAN GENEL ADLAR")
for g, n in dokunulan.most_common(12):
    print(f"  {n:3d}  {g}")

if not YAZ:
    print()
    print("KURU CALISMA -- hicbir sey yazilmadi. Uygulamak icin: --yaz")
    sys.exit(0)

for expense_id, items in guncellenecek:
    db.expenses.update_one({"expense_id": expense_id}, {"$set": {"items": items}})

print()
print(f"YAZILDI: {len(guncellenecek)} harcama guncellendi.")
