#!/usr/bin/env bash
# Assemble the teaser: title card -> gameplay frames (24 fps, captions) -> end card. Output: shots/surprise/yoo_plage_teaser.mp4
set -e
FR=${1:-/tmp/teaser/frames}; OUT=${2:-shots/surprise}; T=/tmp/teaser
python3 tools/teaser_cards.py "$FR" "$T"
FONT=/usr/share/fonts/truetype/sand-box/google/Poppins/Poppins-ExtraBold.ttf
cap() { echo "drawtext=fontfile=$FONT:text='$1':fontsize=30:fontcolor=white:box=1:boxcolor=0xe2569b@0.85:boxborderw=14:x=36:y=h-150:alpha='if(lt(t,$2),0,if(lt(t,$2+0.3),(t-$2)/0.3,if(lt(t,$3-0.3),1,if(lt(t,$3),($3-t)/0.3,0))))'"; }
CAPS="$(cap 'Mon appart' 0.2 2.2),$(cap 'Direction Yoo Plage' 3.5 5.6),$(cap 'On s’installe au soleil' 5.9 8.4),$(cap 'DJ · piste de danse' 8.8 11.2),$(cap 'Coucher de soleil' 11.6 15.2)"
ffmpeg -y -loglevel error -framerate 24 -i "$FR/f%04d.jpg" -vf "$CAPS,format=yuv420p" -c:v libx264 -crf 18 -preset slow -r 24 "$T/game.mp4"
for c in title end; do ffmpeg -y -loglevel error -loop 1 -t 2.2 -i "$T/$c.png" -vf "format=yuv420p" -c:v libx264 -crf 18 -r 24 "$T/$c.mp4"; done
GD=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$T/game.mp4")
ffmpeg -y -loglevel error -i "$T/title.mp4" -i "$T/game.mp4" -i "$T/end.mp4" -filter_complex \
 "[0][1]xfade=transition=fade:duration=0.5:offset=1.7[a];[a][2]xfade=transition=fade:duration=0.5:offset=$(python3 -c "print(1.7+$GD-0.5)"),fade=t=in:st=0:d=0.4,format=yuv420p[v]" \
 -map "[v]" -c:v libx264 -crf 19 -preset slow -movflags +faststart "$OUT/yoo_plage_teaser.mp4"
ffprobe -v error -show_entries format=duration:stream=width,height -of default=nw=1 "$OUT/yoo_plage_teaser.mp4"
cp "$T/title.png" "$OUT/teaser_title.png"
