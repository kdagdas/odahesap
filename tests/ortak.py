"""Test takimlarinin paylastigi yardimcilar.

Tek isi var: **odesmek.**

Tur 10'da donem elle kapatilamaz oldu; yalnizca herkes odestiginde
kendiliginden kapaniyor (bkz. SIRADAKI-TUR.md, KARAR 1). Eskiden testler
harcama girip dogrudan `/periods/close` cagiriyordu ve bu, uretimde de var
olan hatanin ta kendisiydi: odesilmeden kapatilan donemin borcu canli
ekrandan siliniyordu.

Dosyalar bilerek bagimsiz kaldi -- her takim tek basina calistirilabiliyor.
Burada yalnizca her takimda birebir ayni olan bu tek islem duruyor.
"""
import httpx


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def odes(c: httpx.Client, api: str, jetonlar: dict) -> None:
    """Onerilen transferleri kaydederek herkesi odestirir.

    `jetonlar`: `{user_id: token}`. Odemeyi yalnizca TARAFLARI
    kaydedebildigi icin her transfer, odeyenin jetonuyla yaziliyor.

    Son odeme kaydedilince sunucu donemi kendiliginden kapatiyor -- bu
    cagridan sonra `/periods/close` cagirmaya GEREK YOK.
    """
    bir = next(iter(jetonlar.values()))
    bal = c.get(f"{api}/balances", headers=_h(bir)).json()
    for t in bal.get("transfers", []):
        jeton = jetonlar.get(t["from"]) or jetonlar.get(t["to"])
        if not jeton:
            continue
        c.post(f"{api}/settlements", headers=_h(jeton), json={
            "from_user_id": t["from"],
            "to_user_id": t["to"],
            "amount": round(float(t["amount"]), 2),
        })


def kapali_donem(c: httpx.Client, api: str, token: str):
    """En son kapanan donemin kimligi.

    Eskiden `/periods/close` yanitindaki `closed_period_id` okunuyordu.
    Kapanma artik bir yanit degil bir YAN ETKI oldugu icin kimlik listeden
    aliniyor; `/periods` yeniden eskiye siralandigindan ilk kapali olan en
    sonuncusudur.
    """
    r = c.get(f"{api}/periods", headers=_h(token))
    for p in r.json().get("periods", []):
        if p.get("status") == "closed":
            return p["period_id"]
    return None
