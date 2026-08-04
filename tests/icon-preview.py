"""Alt menu ikon secenegini onizle - uygulamaya hicbir sey kurmadan.

Gercek ikon fontlarindan, uygulamadaki boyut ve renklerle ciziyor.
"""
import json
import os

from PIL import Image, ImageDraw, ImageFont

FDIR = r"D:\SettleUp\OdaHesap\frontend\node_modules\@expo\vector-icons\build\vendor\react-native-vector-icons"
GLYPHS = os.path.join(FDIR, "glyphmaps")
FONTS = os.path.join(FDIR, "Fonts")

BRAND = (14, 165, 165)        # aktif sekme rengi
INACTIVE = (122, 141, 143)    # pasif sekme rengi
TEXT_DARK = (15, 42, 46)
BG = (255, 255, 255)
PANEL = (241, 251, 249)

ion_map = json.load(open(os.path.join(GLYPHS, "Ionicons.json"), encoding="utf-8"))
mci_map = json.load(open(os.path.join(GLYPHS, "MaterialCommunityIcons.json"), encoding="utf-8"))

SCALE = 3  # netlik icin buyuk ciz


def icon_img(family: str, name: str, size: int, color) -> Image.Image:
    mapping = ion_map if family == "ion" else mci_map
    ttf = "Ionicons.ttf" if family == "ion" else "MaterialCommunityIcons.ttf"
    ch = chr(mapping[name])
    f = ImageFont.truetype(os.path.join(FONTS, ttf), size)
    img = Image.new("RGBA", (size + 12, size + 12), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    bbox = d.textbbox((0, 0), ch, font=f)
    d.text((-bbox[0] + 6, -bbox[1] + 6), ch, font=f, fill=color)
    return img


def label(d, xy, text, size, color, anchor="mm"):
    try:
        f = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", size)
    except Exception:
        f = ImageFont.load_default()
    d.text(xy, text, font=f, fill=color, anchor=anchor)


def tab_bar(kasa_family: str, kasa_icon: str, title: str) -> Image.Image:
    """Dort sekmeli alt menuyu ciz; Kasa sekmesi aktif."""
    W, H = 420 * SCALE, 110 * SCALE
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    label(d, (12 * SCALE, 14 * SCALE), title, 13 * SCALE, TEXT_DARK, anchor="lm")
    d.line([(0, 30 * SCALE), (W, 30 * SCALE)], fill=(232, 240, 239), width=2)

    tabs = [
        ("ion", "home-outline", "Anasayfa", False),
        ("ion", "receipt-outline", "Harcamalar", False),
        ("ion", "scan", "Fiş Tara", False),
        (kasa_family, kasa_icon, "Kasa", True),
    ]
    slot = W / len(tabs)
    for i, (fam, name, txt, active) in enumerate(tabs):
        cx = slot * (i + 0.5)
        color = BRAND if active else INACTIVE
        ico = icon_img(fam, name, 22 * SCALE, color)
        img.paste(ico, (int(cx - ico.width / 2), int(48 * SCALE)), ico)
        label(d, (cx, 84 * SCALE), txt, 11 * SCALE, color)
    return img


def main() -> None:
    options = [
        ("mci", "safe", "SEÇENEK 1 — safe (birebir kasa)"),
        ("mci", "safe-square-outline", "SEÇENEK 2 — safe-square-outline (ince kasa)"),
        ("ion", "wallet-outline", "SEÇENEK 3 — wallet-outline (cüzdan, diğerleriyle aynı aile)"),
        ("ion", "wallet", "SEÇENEK 4 — wallet (dolu cüzdan)"),
    ]
    bars = [tab_bar(f, n, t) for f, n, t in options]

    gap = 18 * SCALE
    W = max(b.width for b in bars)
    H = sum(b.height for b in bars) + gap * (len(bars) + 1)
    sheet = Image.new("RGB", (W, H), PANEL)
    y = gap
    for b in bars:
        sheet.paste(b, (0, y))
        y += b.height + gap

    out = r"D:\SettleUp\build-tools\tmp\kasa-ikon-secenekleri.png"
    sheet.save(out)
    print("yazildi:", out, sheet.size)


if __name__ == "__main__":
    main()
