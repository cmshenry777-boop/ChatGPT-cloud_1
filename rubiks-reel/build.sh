#!/usr/bin/env bash
# Full pipeline: cue sheet → soundtrack → 900 frames → graded H.264 master.
set -euo pipefail
cd "$(dirname "$0")"

node render.mjs --cues                 # sound cues exported from the picture timeline
python3 audio/synth.py                 # → out/audio.wav
node render.mjs --all --workers 1      # → out/frames/f0000…f0899.png (skips existing)

mkdir -p dist
ffmpeg -y -v error -stats \
  -framerate 60 -i out/frames/f%04d.png -i out/audio.wav \
  -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,noise=c0s=3:c0f=t" \
  -c:v libx264 -preset slow -crf 21 -profile:v high -level 4.2 -g 60 -maxrate 22M -bufsize 30M \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  -c:a aac -b:a 256k -ar 48000 \
  -movflags +faststart -shortest dist/rubiks_cube_reel.mp4

ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height,r_frame_rate -of compact dist/rubiks_cube_reel.mp4
