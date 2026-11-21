"""v3: restaurant / promenade from the original; painted depth and small v2 seam fixes. No external art."""
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import numpy as np
from inpaint_v2 import Art

def restaurant(a: Art):
  a.restore((1246, 274, 1445, 333))
  hole=a.capsule('restaurant',3,3)
  a.fill(hole,(1185,215,1500,388),ctx_mask=a.labels_mask(skip=('restaurant',)))
  road=Image.new('L',(a.W,a.H),0); ImageDraw.Draw(road).rectangle((1296,284,1404,298),fill=255)
  a.fill(road,(1236,236,1460,330))
  L,d=a.layer(); a.ellipse(d,(1318,280,1384,291),(70,52,60,70)); a.put(L)
  # original label completely hid the restaurant roof. Rebuild its terracotta hip roof in the facade's perspective,
  # using colours sampled from its surviving edges, a lit main face, dark right hip and a light ridge cap.
  ink=(100,43,22); rows=[]
  for k in range(1,5):
    t=k/5; y=296+t*26; xl=1300-t*23; xr=1406+t*6
    rows.append([(xl,y-3*t),(xr,y+7*t)])
    for x in np.arange(xl+7+(5 if k%2 else 0),xr-2,11): rows.append([(x,y+(x-xl)/(xr-xl)*8*t),(x-1,y+4.5+(x-xl)/(xr-xl)*8*t)])
  a.paint([(1300,296),(1406,296),(1412,329),(1277,319)],(178,91,48),(224,142,80),light=.2,ao=.28,outline=ink,ow=1.5,lines=rows,line_col=(138,66,35),line_alpha=.55,highlight=[(1279,318.4),(1410,328.2)],seed=30)
  a.paint([(1406,296),(1433,315),(1412,329)],(191,99,53),(162,77,37),light=.15,ao=.3,outline=ink,ow=1.3,lines=[[(1410,302),(1426,317)],[(1412,308),(1420,321)]],line_col=(124,56,29),line_alpha=.45,seed=31)
  a.paint([(1300,296),(1406,296),(1406,298.5),(1298,298.5)],(247,176,108),(195,103,55),light=.12,ao=.12,outline=ink,ow=1,tex=4,seed=32)
  a.paint([(1276,319),(1412,329),(1434,315),(1434,319),(1412,333),(1276,323)],(214,130,68),(149,69,32),light=.1,ao=.3,outline=ink,ow=1.2,seed=33)

def promenade(a: Art):
  a.restore((666,590,1018,654))
  hole=a.capsule('promenade',3,3)
  # Lamp / rail ghosts in v1: hide the nearby dangling bits from the context rather than letting LaMa extend them.
  ctx=a.labels_mask(skip=('promenade',)); d=ImageDraw.Draw(ctx)
  d.rectangle((691,580,716,657),fill=255); d.rectangle((720,580,739,653),fill=255)
  d.rectangle((796,578,815,659),fill=255)
  # Keep the main streetlamp, which crosses the removed label, by restoring its stem after repaving.
  a.fill(hole,(630,535,1060,682),ctx_mask=ctx)
  ghost=Image.new('L',(a.W,a.H),0); d=ImageDraw.Draw(ghost)
  for b in ((687,598,709,638),(718,597,739,636),(792,601,818,641),(831,600,852,639),(923,602,945,639)):
    d.rectangle(b,fill=255)
  a.fill(ghost,(646,551,1036,682))
  # rebuild only the interrupted black lamp pole, slightly tapered and lit on its left (no text/signs)
  a.paint([(801.5,596),(805.5,596),(805,612),(802,612)],(58,58,64),(40,38,42),light=.28,ao=.12,outline=(29,29,34),ow=.6,tex=1.5,grain=1,seed=34)
  a.paint([(799.5,611),(807.5,611),(808,616),(799,616)],(70,70,78),(34,33,38),light=.25,ao=.15,outline=(29,29,34),ow=.7,tex=1.5,grain=1,seed=35)


def depot_seam(a: Art):
  """v2 left a double white trim + smeared slats where the cloned dépôt roof meets the neighbour's roof. Repaint that
     wedge as the neighbour's grey slat roof, then one crisp white hip trim down into the original V valley."""
  wedge = [(1499.6, 436.4), (1540, 446.5), (1540, 458), (1517, 471), (1508.6, 458)]
  a.paint(wedge, (128, 130, 146), (104, 106, 124), light=.12, ao=.18, outline=None, ow=0, tex=4, grain=1.6, seed=40,
          lines=[[(1503 + k * 5.5, 437), (1515 + k * 5.5, 471)] for k in range(1, 7)], line_col=(78, 80, 96), line_alpha=.75)
  L, d = a.layer()
  a.line(d, [(1503.4, 438.2), (1516.6, 471)], (112, 114, 132, 255), 3.2)       # trim shadow side
  a.line(d, [(1502.2, 437.4), (1515.6, 470.4)], (244, 246, 252, 255), 1.9)     # lit hip trim
  a.line(d, [(1503, 437), (1540, 446.8)], (236, 238, 246, 255), 1.4)       # neighbour roof's top edge
  a.put(L)

def place_edge(a: Art):
  """Place centrale: LaMa again on the patchy grass edge only, then a crisp painted top rail on the left bench
     (v2 left its top soft) ending on the bench's right post."""
  m=Image.new('L',(a.W,a.H),0); d=ImageDraw.Draw(m)
  d.polygon([(752,286),(803,279),(862,280),(907,289),(907,298),(859,291),(804,291),(752,299)],fill=255)
  a.fill(m,(674,240,982,348))
  m=Image.new('L',(a.W,a.H),0); ImageDraw.Draw(m).polygon([(711,288),(757,281),(758,299),(711,311)],fill=255)
  a.fill(m,(660,230,820,350))
  wood=(96,46,22)
  a.paint([(703,311.5),(761,298.2),(761.5,305),(703.5,318.5)],(216,140,66),(150,76,30),light=.14,ao=.22,outline=wood,ow=.8,tex=3,grain=1.3,
          highlight=[(704,312),(760,299)],seed=42,lines=[[(704,315.4),(761,302.2)]],line_col=(120,58,24),line_alpha=.35)
  a.paint([(758.5,298),(764,297.6),(764.5,329),(759,329.5)],(206,126,58),(132,66,28),light=.18,ao=.22,outline=wood,ow=.8,tex=3,grain=1.3,seed=43)
  L,d=a.layer(); a.ellipse(d,(758.6,293.8,764.2,299.4),(246,214,168,255),wood+(255,),.7); a.put(L)

def sky_edge(a: Art):
  # v2 feathered the clone into the old art at x=0-40 and left a haze. Same mirrored patch, but opaque right to the
  # left canvas edge. Feather only along the far edge (the forest already matches v2).
  src=a.out.crop((1130,0,1672,122)).transpose(Image.Transpose.FLIP_LEFT_RIGHT)
  m=Image.new('L',(a.W,a.H),0); ImageDraw.Draw(m).rectangle((-25,-25,60,105),fill=255)
  m=m.filter(ImageFilter.GaussianBlur(5)); a.out.paste(src,(0,0),m.crop((0,0,542,122)))
  # the mirrored source's own right edge is hazy, so the left 0-50 px came out pale. Grade it back towards the
  # forest at x=60 (saturation, value, local contrast), ramped out to x=60 and feathered top/bottom.
  import cv2
  box=(0,30,64,108); c=np.array(a.out.crop(box)).astype(np.float32)
  hsv=cv2.cvtColor(c.astype(np.uint8),cv2.COLOR_RGB2HSV).astype(np.float32)
  xs=np.arange(c.shape[1])[None,:]; ys=np.arange(c.shape[0])[:,None]
  f=np.clip((58-xs)/52,0,1)*np.clip(np.minimum(ys-2,c.shape[0]-1-ys)/12,0,1)
  hsv[...,1]=np.clip(hsv[...,1]*(1+.22*f),0,255); hsv[...,2]=np.clip(hsv[...,2]*(1-.08*f),0,255)
  g=cv2.cvtColor(hsv.astype(np.uint8),cv2.COLOR_HSV2RGB).astype(np.float32)
  g=g+(g-cv2.GaussianBlur(g,(0,0),2.5))*(.6*f)[...,None]
  a.out.paste(Image.fromarray(np.clip(g,0,255).astype(np.uint8)),box[:2])

AREAS={'restaurant':restaurant,'promenade':promenade,'depot_seam':depot_seam,'place_edge':place_edge,'sky_edge':sky_edge}
