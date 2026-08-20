"""Evin saat dilimi — "bugun" hangi gun?

Sunucu her yerde `now_utc().date()` kullaniyordu. Belirtisi geceleri
goruluyordu: Almanya yaz saatinde UTC+2, yani yerel saat 01:00'de UTC hala
"dun". Ayin 1'inde gece yarisindan sonra uygulamayi acan biri Anasayfa'da
GECEN AYIN rakamlarini goruyordu.

Bu takim saatten bagimsiz calisir: beklenen degeri kendisi de ayni saat
diliminden hesaplar, yani gece yarisi civarinda da dogru sonuc verir.
"""
import sys
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import httpx

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8099").rstrip("/")
API = f"{BASE}/api"
TAG = uuid.uuid4().hex[:8]

TZ = {"DE": ZoneInfo("Europe/Berlin"), "TR": ZoneInfo("Europe/Istanbul")}

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


def yerel(ulke):
    return datetime.now(timezone.utc).astimezone(TZ[ulke]).date()


c = httpx.Client(timeout=90.0)


def dondurulmus_saat_kontrolu():
    """SAATTEN BAGIMSIZ kontrol -- asagidaki HTTP testleri bunu veremiyor.

    HTTP tarafi sunucunun gercek saatine bagli: su anda UTC ile Berlin ayni
    gunde olabilir ve o zaman ESKI kod da testi gecerdi. Yani yesil olmasi
    hicbir sey kanitlamiyor. Burada saat donduruluyor ve hatanin tam olarak
    gorundugu ana bakiliyor.

    30 Eylul 22:30 UTC: UTC hala EYLUL diyor ama Almanya ve Turkiye coktan
    EKIM'e gecti. Eski kodla Anasayfa o saatte gecen ayin rakamlarini
    gosteriyordu -- ay sinirinda bir gun degil, KOCA BIR AY kayiyordu.
    """
    import os
    from datetime import datetime, timezone as _tz
    from unittest.mock import patch
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
    try:
        import server  # noqa: PLC0415
    except Exception as e:  # noqa: BLE001
        print(f"  [ATLA] sunucu modulu yuklenemedi ({type(e).__name__}) -- HTTP testleri devam ediyor")
        return
    an = datetime(2026, 9, 30, 22, 30, tzinfo=_tz.utc)
    with patch.object(server, "now_utc", lambda: an):
        check("UTC EYLUL derken DE evi EKIM'de",
              server.ev_bugun({"country": "DE"}).isoformat() == "2026-10-01",
              str(server.ev_bugun({"country": "DE"})))
        check("UTC EYLUL derken TR evi EKIM'de",
              server.ev_bugun({"country": "TR"}).isoformat() == "2026-10-01",
              str(server.ev_bugun({"country": "TR"})))
        check("eski davranis (UTC) gercekten farkliydi", an.date().isoformat() == "2026-09-30")
    # Turkiye yaz saati uygulamiyor, Almanya uyguluyor: kis ortasinda ikisi
    # bir saat AYRI, yazin da bir saat ayri ama ofsetler farkli. Ocakta
    # Berlin UTC+1, Istanbul UTC+3 -- iki saat fark.
    kis = datetime(2026, 1, 15, 22, 30, tzinfo=_tz.utc)
    with patch.object(server, "now_utc", lambda: kis):
        check("kis saatinde DE hala 15 Ocak",
              server.ev_bugun({"country": "DE"}).isoformat() == "2026-01-15",
              str(server.ev_bugun({"country": "DE"})))
        check("kis saatinde TR coktan 16 Ocak",
              server.ev_bugun({"country": "TR"}).isoformat() == "2026-01-16",
              str(server.ev_bugun({"country": "TR"})))
    check("bilinmeyen ulke patlamiyor", server.ev_bugun({"country": "XX"}) is not None)
    check("ev yokken de bir cevap var", server.ev_bugun(None) is not None)


print("== DONDURULMUS SAAT: hatanin tam gorundugu an ==")
dondurulmus_saat_kontrolu()
print()


def ev_kur(who, ulke):
    r = c.post(f"{API}/auth/register", json={
        "email": f"tz_{who}_{TAG}@odahesap-e2e.com",
        "password": "sifre123", "name": who.title()})
    r.raise_for_status()
    tok = r.json()["session_token"]
    r = c.post(f"{API}/households", headers=hdr(tok),
               json={"name": f"TZ {ulke} {TAG}", "country": ulke})
    r.raise_for_status()
    return tok


de = ev_kur("dieter", "DE")
tr = ev_kur("tuna", "TR")

print("== tarih verilmeyen harcama EVIN bugunune yaziliyor ==")
for tok, ulke in ((de, "DE"), (tr, "TR")):
    r = c.post(f"{API}/expenses", headers=hdr(tok), json={
        "target_type": "household", "total": 10.0, "source": "manual", "items": []})
    r.raise_for_status()
    gelen = r.json()["expense"]["expense_date"]
    beklenen = yerel(ulke).isoformat()
    check(f"{ulke} evi bugunu dogru yaziyor", gelen == beklenen,
          f"gelen={gelen} beklenen={beklenen} utc={datetime.now(timezone.utc).date()}")

print()
print("== aylik istatistigin varsayilan ayi EVIN ayi ==")
for tok, ulke in ((de, "DE"), (tr, "TR")):
    s = c.get(f"{API}/stats/monthly", headers=hdr(tok)).json()
    beklenen = yerel(ulke).strftime("%Y-%m")
    check(f"{ulke} varsayilan ay", s["month"] == beklenen,
          f'{s["month"]} != {beklenen}')

print()
print("== 'ayin kacinci gunu' EVIN takviminden ==")
# Trend satiri bu sayiya dayaniyor: gecen ayin AYNI gunune kadarki toplamla
# karsilastiriliyor. Bir gun geri kalmasi yuzdeyi bozuyordu.
for tok, ulke in ((de, "DE"), (tr, "TR")):
    s = c.get(f"{API}/stats/monthly", headers=hdr(tok)).json()
    check(f"{ulke} gecen gun sayisi", s.get("elapsed_days") == yerel(ulke).day,
          f'{s.get("elapsed_days")} != {yerel(ulke).day}')

print()
print("== iki ulke ayni anda FARKLI gunde olabilir ==")
# Berlin 23:00 = Istanbul 00:00 (ertesi gun). O bir saatlik pencerede iki ev
# farkli tarihlere yaziyor olmali; disinda ayni. Test her iki durumda da
# gecerli -- kosul saate gore degil, saat diliminin kendisine gore kuruluyor.
d_de, d_tr = yerel("DE"), yerel("TR")
sde = c.get(f"{API}/stats/monthly", headers=hdr(de)).json()
str_ = c.get(f"{API}/stats/monthly", headers=hdr(tr)).json()
if d_de != d_tr:
    check("gunler ayrisiyor ve sunucu bunu goruyor",
          sde["month"] != str_["month"] or sde["elapsed_days"] != str_["elapsed_days"],
          f"{sde} / {str_}")
    print(f"  (not: su an Almanya {d_de}, Turkiye {d_tr} -- ayrisma penceresi)")
else:
    check("ayni gundeyken iki ev de ayni gunu bildiriyor",
          sde["elapsed_days"] == str_["elapsed_days"],
          f'{sde.get("elapsed_days")} / {str_.get("elapsed_days")}')

print()
print("== zaman damgalari UTC KALIYOR ==")
# `created_at` bir ANI kaydediyor ve anin saat dilimi yok. Yalnizca "bugun
# hangi gun" sorusu eve ait; damgalara dokunulmadi.
r = c.get(f"{API}/expenses", headers=hdr(de)).json()
dmg = r["expenses"][0]["created_at"]
check("created_at hala UTC (Z ya da +00:00)",
      dmg.endswith("Z") or "+00:00" in dmg or dmg.count(":") >= 2, str(dmg))

print()
print("== ulke harcamadan SONRA degistirilemiyor ==")
# Ilk yazilan bu testti: "ulkeyi TR yap, takvim de degissin". Sunucu 400
# dondu ama test YINE GECTI -- o saatte Berlin ile Istanbul ayni gundeydi ve
# karsilastirma bir sey olcmuyordu. Yanlis sebeple yesil bir test, kirmizi
# testten tehlikeli: koruma sandigimiz sey hicbir sey korumuyordu.
#
# Gercek davranis su: ulke ve para birimi yalnizca HIC HARCAMA YAPILMAMIS
# evlerde degisebiliyor (gecmis tutarlar eski para biriminde okunur). Saat
# diliminin ulkeyi izledigi ise yukaridaki dondurulmus saat testinde
# olculuyor -- orada Ocak ayinda DE ile TR farkli gunlere dusuyor.
r = c.patch(f"{API}/households", headers=hdr(de), json={"country": "TR"})
check("harcamasi olan ev ulke degistiremiyor", r.status_code == 400, str(r.status_code))

# Harcamasi olmayan taze bir evde degisiyor -- ve takvim onu izliyor.
taze = ev_kur("timo", "DE")
r = c.patch(f"{API}/households", headers=hdr(taze), json={"country": "TR"})
check("bos ev ulke degistirebiliyor", r.status_code == 200, r.text[:120])
hh = c.get(f"{API}/households/me", headers=hdr(taze)).json()
check("ulke TR olarak kaydedildi",
      (hh.get("household") or {}).get("country") == "TR", str(hh.get("household", {}).get("country")))
r = c.post(f"{API}/expenses", headers=hdr(taze), json={
    "target_type": "household", "total": 5.0, "source": "manual", "items": []})
check("yeni harcama artik TR takvimine yaziliyor",
      r.json()["expense"]["expense_date"] == yerel("TR").isoformat(),
      f'{r.json()["expense"]["expense_date"]} != {yerel("TR").isoformat()}')

print()
print("== temizlik ==")
for t in (de, tr, taze):
    c.post(f"{API}/households/leave", headers=hdr(t))
    c.post(f"{API}/auth/logout", headers=hdr(t))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
