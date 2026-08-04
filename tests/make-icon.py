"""KaSa uygulama ikonunu uretir.

Kullanicinin tasarimi: yuvarlak kosell kare, ortada "KaSa" yazisi, etrafinda
dort parcaya bolunmus halka. Sol yarim lacivert, sag yarim yesildi.

Arka plan koyu lacivert olunca lacivert ogeler kaybolacagi icin onlari
kirik beyaza cevirdim; yesil vurgu rengi oldugu gibi kaldi.

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

NAVY = (16, 28, 51)        # arka plan - koyu lacivert
LIGHT = (242, 247, 245)    # laciverdin yerini alan kirik beyaz
GREEN = (95, 192, 141)     # kullanicinin tasarimindaki yesil

S = 1024
CX = CY = S / 2

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\ARLRDBD.TTF",   # Arial Rounded Bold - yumusak geometrik
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
]


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    raise SystemExit("uygun font bulunamadi")


def draw_mark(img: Image.Image, scale: float) -> None:
    """Halka + 'KaSa' yazisini ciz. scale=1.0 tam kare, <1 guvenli alan icin."""
    d = ImageDraw.Draw(img)

    ring_r = 360 * scale
    ring_w = int(46 * scale)
    box = [CX - ring_r, CY - ring_r, CX + ring_r, CY + ring_r]

    # Dort yay. Yatay bosluklar genis tutuldu: yazi tam oradan geciyor,
    # dar birakilirsa son "a" yesil yayin uzerine biniyor.
    for start, end, color in (
        (285, 345, GREEN),   # sag ust
        (15, 75, GREEN),     # sag alt
        (105, 165, LIGHT),   # sol alt
        (195, 255, LIGHT),   # sol ust
    ):
        d.arc(box, start, end, fill=color, width=ring_w)

    # "KaSa" - ilk yarisi acik, ikinci yarisi yesil
    font = load_font(int(258 * scale))
    left, right = "Ka", "Sa"
    wl = d.textlength(left, font=font)
    wr = d.textlength(right, font=font)

    # Dikey ortalama icin gercek harf kutusunu kullan; font metrikleri
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
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=NAVY)
    return img


def main() -> None:
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
