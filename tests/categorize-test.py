"""Check categorize_item on both umlaut spellings and on words that must NOT
collide (Wein/Fleisch/Seife all contain "ei", Fleisch contains "eis")."""
import os
import sys

sys.path.insert(0, r"D:\SettleUp\OdaHesap\backend")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "x")

from server import categorize_item  # noqa: E402

CASES = [
    # (urun, beklenen kategori)
    ("Vollmilch 1L", "sut_urunleri"),
    ("Gouda jung", "sut_urunleri"),
    ("Kaese Gouda", "sut_urunleri"),
    ("Käse Gouda", "sut_urunleri"),
    ("Broetchen", "firin"),
    ("Brötchen", "firin"),
    ("Brot Vollkorn", "firin"),
    ("Spuelmittel", "ev_urunleri"),
    ("Spülmittel", "ev_urunleri"),
    ("Waschmittel", "ev_urunleri"),
    ("Tomaten 500g", "meyve_sebze"),
    ("Möhren", "meyve_sebze"),
    ("Moehren", "meyve_sebze"),
    ("Haehnchenbrust", "et_balik"),
    ("Hähnchenbrust", "et_balik"),
    ("Rinderhack", "et_balik"),
    ("Lachsfilet", "et_balik"),
    # carpisma kontrolu: hepsi "ei" icerir, hicbiri sut_urunleri olmamali
    ("Rotwein trocken", "icecek"),
    ("Weissbier", "icecek"),
    ("Fleischsalat", "et_balik"),
    ("Seife fluessig", "ev_urunleri"),
    ("Schokolade Vollmilch", "atistirmalik"),  # cikolata, sut urunu degil
    ("Kaffee gemahlen", "icecek"),
    ("Mineralwasser", "icecek"),
]

fails = 0
for name, expected in CASES:
    got = categorize_item(name)
    mark = "OK  " if got == expected else "FAIL"
    if got != expected:
        fails += 1
    print(f"  [{mark}] {name:<26} -> {got:<14} (beklenen {expected})")

print(f"\n{len(CASES) - fails}/{len(CASES)} gecti")
sys.exit(1 if fails else 0)
