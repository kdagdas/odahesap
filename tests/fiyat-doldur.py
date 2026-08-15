"""Mevcut fis harcamalarindan anonim fiyat kayitlari uretir.

Tur 4'ten sonra her yeni fis kaydedilirken `price_points` otomatik yaziliyor.
Bu betik ayni isi GECMISE donuk yapar -- gecmis fisler geri gelmiyor, o yuzden
bir kez calistirilip birakilir.

Kurallar canli koddaki `record_price_points()` ile ayni: kimlik alani hic
yazilmaz, hafta cozunurlugunde tarih, ham urun adi saklanir.

    cd backend
    .venv/Scripts/python.exe ../tests/fiyat-doldur.py           # sadece gosterir
    .venv/Scripts/python.exe ../tests/fiyat-doldur.py --yaz

Tekrar calistirmak guvenli degildir: ayni kalem iki kez yazilir. Once
--sifirla ile mevcut kayitlari silin.

NOT: `price_points` bilerek kimlik alani tasimadigi icin, uretim veritabanina
karsi test calistirildiginda olusan sahte fiyat kayitlari sonradan ayirt
edilemez. Tek care sifirlayip yeniden uretmektir -- kaynak fisler duruyor,
yani veri kaybi olmuyor. Testleri DB_NAME=odahesap_test ile calistirin.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + "/backend")
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + "/backend")

from dotenv import load_dotenv  # noqa: E402

load_dotenv()
import server  # noqa: E402

YAZ = "--yaz" in sys.argv
SIFIRLA = "--sifirla" in sys.argv


async def main():
    db = server.db

    if SIFIRLA:
        n = await db.price_points.count_documents({})
        if YAZ:
            await db.price_points.delete_many({})
            print(f"{n} fiyat kaydi silindi.\n")
        else:
            print(f"{n} fiyat kaydi silinecek (--yaz ekleyin).\n")

    households = {h["household_id"]: h for h in
                  await db.households.find({}, {"_id": 0}).to_list(500)}
    exps = await db.expenses.find(
        {"source": "receipt", "merchant": {"$ne": None}}, {"_id": 0}
    ).to_list(5000)

    toplam = atlanan = 0
    sinif = {"paketli": 0, "acik": 0, "adet": 0}
    marketler = {}
    for e in exps:
        hh = households.get(e.get("household_id")) or {}
        for item in e.get("items") or []:
            p = server.price_of_item(item)
            if not p:
                atlanan += 1
                continue
            toplam += 1
            sinif[p["pack_type"]] = sinif.get(p["pack_type"], 0) + 1
            marketler[e["merchant"]] = marketler.get(e["merchant"], 0) + 1
        if YAZ:
            await server.record_price_points(e, hh)

    print(f"fis harcamasi     {len(exps)}")
    print(f"fiyat kaydi       {toplam}   (islenmeyen kalem: {atlanan})")
    print(f"  paketli         {sinif.get('paketli', 0)}   birim fiyati kg/lt cinsinden")
    print(f"  acik (tartili)  {sinif.get('acik', 0)}")
    print(f"  adet            {sinif.get('adet', 0)}   birim fiyat uretilemedi")
    print("\nmarketler:")
    for m, n in sorted(marketler.items(), key=lambda x: -x[1]):
        print(f"  {m:24} {n}")

    if YAZ:
        var = await db.price_points.count_documents({})
        print(f"\nYAZILDI. price_points icinde toplam {var} kayit.")
    else:
        print("\nHicbir sey yazilmadi. Yazmak icin --yaz ekleyin.")


asyncio.run(main())
