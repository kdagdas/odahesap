"""Yeni 5 sekmeli alt menuyu onizle."""
import json
import os

from PIL import Image, ImageDraw, ImageFont

FDIR = r"D:\SettleUp\OdaHesap\frontend\node_modules\@expo\vector-icons\build\vendor\react-native-vector-icons"
ion = json.load(open(os.path.join(FDIR, "glyphmaps", "Ionicons.json"), encoding="utf-8"))
TTF = os.path.join(FDIR, "Fonts", "Ionicons.ttf")

BRAND = (14, 165, 165)
BRAND_SOFT = (207, 242, 239)
INACTIVE = (122, 141, 143)
TEXT_DARK = (15, 42, 46)
WHITE = (255, 255, 255)
PANEL = (241, 251, 249)
S = 3


def glyph(name, size, color):
    f = ImageFont.truetype(TTF, size)
    ch = chr(ion[name])
    img = Image.new("RGBA", (size + 16, size + 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    b = d.textbbox((0, 0), ch, font=f)
    d.text((-b[0] + 8, -b[1] + 8), ch, font=f, fill=color)
    return img


def label(d, xy, text, size, color, anchor="mm"):
    f = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", size)
    d.text(xy, text, font=f, fill=color, anchor=anchor)


def bar(active_index: int, title: str):
    W, H = 430 * S, 118 * S
    img = Image.new("RGB", (W, H), WHITE)
    d = ImageDraw.Draw(img)
    label(d, (12 * S, 14 * S), title, 12 * S, TEXT_DARK, anchor="lm")
    d.line([(0, 30 * S), (W, 30 * S)], fill=(232, 240, 239), width=2)

    tabs = [
        ("home", "home-outline", "Anasayfa"),
        ("receipt", "receipt-outline", "Harcamalar"),
        ("scan", "scan", "Fiş Tara"),
        ("wallet", "wallet-outline", "Kasa"),
        ("person-circle", "person-circle-outline", "Profil"),
    ]
    slot = W / len(tabs)
    for i, (on, off, txt) in enumerate(tabs):
        cx = slot * (i + 0.5)
        active = i == active_index
        color = BRAND if active else INACTIVE

        if i == 2:  # merkez: dairesel vurgu, digerlerinden buyuk
            r = 24 * S
            cy = 58 * S
            fill = BRAND if active else BRAND_SOFT
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)
            ico = glyph("scan", 26 * S, WHITE if active else BRAND)
            img.paste(ico, (int(cx - ico.width / 2), int(cy - ico.height / 2)), ico)
            label(d, (cx, 92 * S), txt, 10 * S, color)
        else:
            ico = glyph(on if active else off, 22 * S, color)
            img.paste(ico, (int(cx - ico.width / 2), int(52 * S)), ico)
            label(d, (cx, 92 * S), txt, 10 * S, color)
    return img


bars = [
    bar(0, "Anasayfa seçili"),
    bar(2, "Fiş Tara seçili — ortada ve büyük"),
    bar(3, "Kasa seçili — cüzdan dolu hâle geçiyor"),
    bar(4, "Profil seçili — ayarlar artık burada"),
]
gap = 16 * S
W = max(b.width for b in bars)
H = sum(b.height for b in bars) + gap * (len(bars) + 1)
sheet = Image.new("RGB", (W, H), PANEL)
y = gap
for b in bars:
    sheet.paste(b, (0, y))
    y += b.height + gap
out = r"D:\SettleUp\build-tools\tmp\yeni-alt-menu.png"
sheet.save(out)
print("yazildi:", out, sheet.size)
