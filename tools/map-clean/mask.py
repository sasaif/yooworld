"""Mask of baked text/labels/buttons on alessandro_map_v1.png (1672x941), measured by hand on a 50 px grid."""
from PIL import Image, ImageDraw
import sys
BOXES = {  # name: (x0, y0, x1, y1) full-res px
  'title': (12, 4, 528, 100), 'q_residentiel': (196, 110, 482, 164), 'mon_appart': (406, 200, 598, 250),
  'ferme': (114, 300, 245, 348), 'cafe': (535, 325, 693, 378), 'musee': (724, 192, 838, 237),
  'place': (718, 275, 938, 328), 'culture': (732, 48, 1012, 107), 'jardins': (116, 452, 248, 494),
  'nature': (264, 452, 384, 505), 'parc': (928, 197, 1107, 240), 'minigolf': (1152, 214, 1277, 255),
  'q_travail': (1330, 77, 1629, 138), 'close': (1592, 8, 1662, 72), 'usine': (1414, 205, 1540, 258),
  'restaurant': (1278, 280, 1430, 325), 'hotel': (1497, 300, 1620, 346), 'club': (947, 319, 1210, 381),
  'depot': (1360, 417, 1555, 461), 'atelier': (396, 507, 599, 555), 'festivals': (704, 515, 970, 565),
  'camping': (66, 547, 204, 591), 'promenade': (686, 599, 998, 648), 'zoo': (148, 632, 349, 678),
  'plage': (544, 747, 754, 803), 'zoom': (14, 797, 80, 910), 'disco': (1200, 505, 1415, 553), 'ponton': (1200, 742, 1435, 788),
}
def mask(pad=4):
  m = Image.new('L', (1672, 941), 0); d = ImageDraw.Draw(m)
  for (x0, y0, x1, y1) in BOXES.values(): d.rounded_rectangle((x0 - pad, y0 - pad, x1 + pad, y1 + pad), radius=18, fill=255)
  return m
if __name__ == '__main__': mask().save(sys.argv[1])
