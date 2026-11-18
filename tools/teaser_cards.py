"""Title / end cards for the Yoo Plage teaser (PIL). Usage: python3 tools/teaser_cards.py <frames_dir> <out_dir>"""
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont
frames, out = sys.argv[1], sys.argv[2]
F = '/usr/share/fonts/truetype/sand-box/google/Poppins/Poppins-'
def font(w, s): return ImageFont.truetype(F + w + '.ttf', s)
def card(src, lines, name):
    bg = Image.open(src).convert('RGB').resize((1280, 720)).filter(ImageFilter.GaussianBlur(9))
    ov = Image.new('RGBA', bg.size); d = ImageDraw.Draw(ov)
    for y in range(720):  # warm vertical veil
        a = int(120 + 60 * (y / 720)); d.line([(0, y), (1280, y)], fill=(90, 40, 110, a))
    img = Image.alpha_composite(bg.convert('RGBA'), ov); d = ImageDraw.Draw(img)
    y = sum(l[2] for l in lines); y = (720 - y) // 2
    for text, f, h, col in lines:
        w = d.textlength(text, font=f); x = (1280 - w) / 2
        d.text((x + 3, y + 4), text, font=f, fill=(40, 10, 50, 140)); d.text((x, y), text, font=f, fill=col); y += h
    img.convert('RGB').save(f'{out}/{name}.png')
card(f'{frames}/f0360.jpg', [('YooWorld', font('Black', 120), 150, (255, 255, 255)), ('— Yoo Plage —', font('ExtraBold', 62), 96, (255, 205, 120)),
     ('Nouveau lieu : ponton · café · DJ · coucher de soleil', font('SemiBold', 30), 50, (255, 235, 245))], 'title')
card(f'{frames}/f0250.jpg', [('Yoo Plage', font('Black', 96), 124, (255, 255, 255)), ('Menu Lieux · Yoo Plage', font('ExtraBold', 44), 70, (255, 205, 120)),
     ('Rendu temps réel du jeu · sans faux joueurs · assets 100 % procéduraux', font('Medium', 26), 44, (255, 235, 245))], 'end')
