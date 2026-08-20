"""KaSa uygulama ikonunu uretir.

Tasarim: koyu lacivert yuvarlak kare, ortada "KaSa", etrafinda DORT KOSE
PARANTEZI -- tarama vizoru.

### Neden yay degil parantez

Onceki surumde dort parcaya bolunmus bir HALKA vardi. Guzeldi ama hicbir sey
soylemiyordu: sustu. Dort kose parantezi ise ogrenilmis bir simge -- kamera
odagi, QR okuyucu, belge tarama. Insan tek kelime okumadan "bu uygulama bir
seye bakiyor" diyor. Uygulamanin cekirdek isi fis taramak; ikon artik onu
soyluyor.

Genellik riski var (her tarayici parantez kullaniyor); ayirt edicimiz
parantezlerin ICINDEKI kelime ve rengin ikiye bolunmesi -- sol acik, sag yesil.

### Neden Poppins

Ev sahibinin tarifi: "a harfinin o harfine benzedigi" font. Poppins'in `a`si
bir daire arti bir dikey cizgi; harflerin geometrisi parantezlerin yuvarlak
dirsekleriyle ayni dili konusuyor. SIL Open Font License -- ticari kullanim
serbest. (Century Gothic de uyuyordu ama Monotype'in ticari fontu; Windows'la
gelmesi lisansi bize gecirmiyor.)

Font `frontend/assets/brand/` altinda DEPODA duruyor, makinenin font
klasorunde degil: baska bir makinede uretilemeyen logo, logo degildir.

### Neden cizgi KALIN

Ana ekranda ikon cogunlukla 48-96 piksel. Normal kalinlikta parantezler 48'de
inceliyordu; olcunun agirligi orada, 192 pikselde degil.

### Kose yariciapi %17

Onceden %22'ydi. Daha duz istendi ama %12 fazla kare kaliyor: iceride yuvarlak
dirsekli parantezler var ve cok koseli bir cerceve onlarla kavga ediyor.

Ureten dosyalar:
  icon.png            1024x1024, arka plan gomulu (iOS + eski Android)
  adaptive-icon.png   1024x1024, seffaf on plan (Android adaptive icon).
                      Icerik merkezdeki %66'lik guvenli alanda kalir, yoksa
                      telefonun yuvarlak kirpmasi kenarlari keser.
  splash-image.png    acilis ekrani
  favicon.png         web sekmesi
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

OUT = r"D:\SettleUp\OdaHesap\frontend\assets\images"
FONT = r"D:\SettleUp\OdaHesap\frontend\assets\brand\Poppins-Bold.ttf"

NAVY = (16, 28, 51)        # arka plan - koyu lacivert
LIGHT = (242, 247, 245)    # sol yarim
GREEN = (95, 192, 141)     # sag yarim - uygulamanin vurgu rengi

S = 1024
CX = CY = S // 2

DIS_YARICAP = 0.17         # dis kosenin yariciapi (S'nin orani)
CERCEVE = 640              # parantezlerin olusturdugu karenin kenari
KOSE_R = 150               # parantez dirseginin yariciapi
KALINLIK = 56              # parantez cizgi kalinligi
KOL = 0.30                 # her kolun kenara orani -- ortasi silinen kisim
YAZI = 224                 # "KaSa" punto


def cerceve_ciz(scale: float) -> Image.Image:
    """Tarama vizoru: yalnizca dort kose, dirsekler yuvarlatilmis.

    Once TAM bir yuvarlak dikdortgen konturu ciziliyor, sonra her kenarin
    ORTASI siliniyor. Dort kol da boylece ayni geometriden geliyor; elle
    cizilen yaylarda kacinilmaz olan kalinlik ve aci farki olusmuyor.

    Silme `fill=(0,0,0,0)` ile yapiliyor -- `ImageDraw` piksele dogrudan
    yaziyor, harmanlamiyor, yani gercekten siliyor.
    """
    kenar = int(CERCEVE * scale)
    kose_r = int(KOSE_R * scale)
    kal = max(1, int(KALINLIK * scale))
    kol = int(kenar * KOL)

    maske = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(maske)
    x0, y0 = CX - kenar // 2, CY - kenar // 2
    x1, y1 = CX + kenar // 2, CY + kenar // 2
    d.rounded_rectangle([x0, y0, x1, y1], radius=kose_r,
                        outline=(255, 255, 255, 255), width=kal)
    d.rectangle([x0 + kol, y0 - kal * 2, x1 - kol, y0 + kal * 2], fill=(0, 0, 0, 0))
    d.rectangle([x0 + kol, y1 - kal * 2, x1 - kol, y1 + kal * 2], fill=(0, 0, 0, 0))
    d.rectangle([x0 - kal * 2, y0 + kol, x0 + kal * 2, y1 - kol], fill=(0, 0, 0, 0))
    d.rectangle([x1 - kal * 2, y0 + kol, x1 + kal * 2, y1 - kol], fill=(0, 0, 0, 0))

    # Sol yarim acik, sag yarim yesil. Bolunme YAZIYLA ayni yerden geciyor:
    # "Ka" acik, "Sa" yesil -- iki isaret tek bir cizgiyi paylasiyor.
    renk = Image.new("RGBA", (S, S), LIGHT + (255,))
    sag = Image.new("RGBA", (S, S), GREEN + (255,))
    yarim = Image.new("L", (S, S), 0)
    ImageDraw.Draw(yarim).rectangle([CX, 0, S, S], fill=255)
    renk.paste(sag, (0, 0), yarim)
    renk.putalpha(maske.getchannel("A"))
    return renk


def draw_mark(img: Image.Image, scale: float) -> None:
    """Parantezler + "KaSa". scale=1.0 tam kare, <1 guvenli alan icin."""
    img.alpha_composite(cerceve_ciz(scale))
    d = ImageDraw.Draw(img)

    font = ImageFont.truetype(FONT, max(8, int(YAZI * scale)))
    left, right = "Ka", "Sa"
    wl = d.textlength(left, font=font)
    wr = d.textlength(right, font=font)

    # Dikey ortalama icin gercek harf kutusu kullaniliyor; font metrikleri
    # (ascender/descender) bosluk birakiyor ve yazi asagida duruyor gibi olur.
    bbox = d.textbbox((0, 0), left + right, font=font)
    text_h = bbox[3] - bbox[1]
    x = CX - (wl + wr) / 2
    y = CY - text_h / 2 - bbox[1]

    d.text((x, y), left, font=font, fill=LIGHT)
    d.text((x + wl, y), right, font=font, fill=GREEN)


def rounded_bg() -> Image.Image:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * DIS_YARICAP), fill=NAVY)
    return img


def main() -> None:
    if not os.path.exists(FONT):
        raise SystemExit(f"font bulunamadi: {FONT}")
    os.makedirs(OUT, exist_ok=True)

    # 1) icon.png - arka plan gomulu
    icon = rounded_bg()
    draw_mark(icon, 1.0)
    icon.save(os.path.join(OUT, "icon.png"))
    print("icon.png yazildi")

    # 2) adaptive-icon.png - seffaf on plan, guvenli alanda kucultulmus.
    #    Android bu goruntunun dis %33'unu kirpabilir.
    adaptive = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw_mark(adaptive, 0.62)
    adaptive.save(os.path.join(OUT, "adaptive-icon.png"))
    print("adaptive-icon.png yazildi")

    # 3) splash - acilis ekraninda ortada duracak, arka plani app.json veriyor
    splash = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw_mark(splash, 0.80)
    splash.save(os.path.join(OUT, "splash-image.png"))
    print("splash-image.png yazildi")

    # 4) favicon
    fav = icon.resize((196, 196), Image.LANCZOS)
    fav.save(os.path.join(OUT, "favicon.png"))
    print("favicon.png yazildi")


if __name__ == "__main__":
    sys.exit(main())
