"""Build a contact sheet of the application's actual Canvas captures.
Run the browser suite first. Requires Pillow; fonts are used, never distributed.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'tests/generated/scenes-validation/browser'
OUT=ROOT/'tests/generated/scenes-validation/aquatic-cards.png'
font_path=Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
if not font_path.exists():
    font_path=Path('C:/Windows/Fonts/segoeui.ttf')
def font(size):
    return ImageFont.truetype(str(font_path),size) if font_path.exists() else ImageFont.load_default(size=size)
items=[('island','\u00cele oc\u00e9anique'),('archipelago','Archipel'),('coast','C\u00f4te & criques'),
       ('estuary','Estuaire'),('fjord','Fjord'),('lagoon','Lagune c\u00f4ti\u00e8re'),
       ('atoll','Atoll'),('lake','Lac de vall\u00e9e'),('craterlake','Lac de crat\u00e8re')]
tile=354;gap=20;pad=28;header=100;caption=36
width=pad*2+3*tile+2*gap;height=header+3*(tile+caption+gap)+30
sheet=Image.new('RGB',(width,height),'#1e1d1b');draw=ImageDraw.Draw(sheet)
draw.text((pad,24),'Cartes en eau',font=font(28),fill='#e6e3dd')
draw.text((pad,62),'9 nouvelles familles  /  Captures du moteur de simulation',font=font(14),fill='#96938a')
for index,(key,title) in enumerate(items):
    x=pad+(index%3)*(tile+gap);y=header+(index//3)*(tile+caption+gap)
    image=Image.open(SRC/f'{key}.png').convert('RGB').resize((tile,tile),Image.Resampling.LANCZOS)
    sheet.paste(image,(x,y));draw.text((x,y+tile+9),title,font=font(16),fill='#e6e3dd')
draw.text((pad,height-30),'Eau initiale r\u00e9elle. Pluie et sources propres \u00e0 chaque carte.',font=font(12),fill='#96938a')
sheet.save(OUT)
print(OUT)
