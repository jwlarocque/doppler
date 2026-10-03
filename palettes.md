// NOAA NEXRAD

// Pebble 16-color radar palette (draft): 1 transparent + 12 rain + 3 snow
// rain dBZ [10, 70] equal-width, dBZ<start hidden, high clamped
// snow dBZ [5, 35] equal-width, dBZ<start hidden, high clamped
// dither: off
// rain band 0 (pal 1) [10.0, 15.0) raw #00AAFF preview #4cb4db
// rain band 1 (pal 2) [15.0, 20.0) raw #0000FF preview #0068ca
// rain band 2 (pal 3) [20.0, 25.0) raw #00FF00 preview #8ee391
// rain band 3 (pal 4) [25.0, 30.0) raw #00AA00 preview #5e9860
// rain band 4 (pal 5) [30.0, 35.0) raw #005500 preview #2b4a2c
// rain band 5 (pal 6) [35.0, 40.0) raw #FFFF00 preview #ffeeab
// rain band 6 (pal 7) [40.0, 45.0) raw #AAAA00 preview #afa072
// rain band 7 (pal 8) [45.0, 50.0) raw #FFAA00 preview #f1aa86
// rain band 8 (pal 9) [50.0, 55.0) raw #FF0000 preview #e35462
// rain band 9 (pal 10) [55.0, 60.0) raw #AA0000 preview #99353f
// rain band 10 (pal 11) [60.0, 65.0) raw #AA0000 preview #99353f
// rain band 11 (pal 12) [65.0, 70.0] clamp hi raw #FF00FF preview #de83dc
// snow band 0 (pal 13) [5.0, 15.0) raw #AAFFFF preview #c3f9f7
// snow band 1 (pal 14) [15.0, 25.0) raw #55AAFF preview #69b5dd
// snow band 2 (pal 15) [25.0, 35.0] clamp hi raw #0055FF preview #007dce


// Dark Sky

// Pebble 16-color radar palette (draft): 1 transparent + 9 rain + 6 snow
// rain dBZ [15, 55] equal-width, dBZ<start hidden, high clamped
// snow dBZ [10, 35] equal-width, dBZ<start hidden, high clamped
// dither: on, strength 1.00, 2x2 Bayer [[0,2],[3,1]]/4, thresh=(1-s)*0.5+s*t, frac from (dbz-start)/w
// dither low end: p in [-1,0) mixes transparent <-> band 0; p<-1 transparent; p>=count clamps top
// rain band 0 (pal 1) [15.0, 19.4) raw #000055 preview #001e41
// rain band 1 (pal 2) [19.4, 23.9) raw #0000AA preview #004387
// rain band 2 (pal 3) [23.9, 28.3) raw #5500AA preview #40488a
// rain band 3 (pal 4) [28.3, 32.8) raw #AA00AA preview #955694
// rain band 4 (pal 5) [32.8, 37.2) raw #FF0000 preview #e35462
// rain band 5 (pal 6) [37.2, 41.7) raw #FF5500 preview #e66e6b
// rain band 6 (pal 7) [41.7, 46.1) raw #FFAA00 preview #f1aa86
// rain band 7 (pal 8) [46.1, 50.6) raw #FFFF00 preview #ffeeab
// rain band 8 (pal 9) [50.6, 55.0] clamp hi raw #FFFFAA preview #fff6d3
// snow band 0 (pal 10) [10.0, 14.2) raw #55FFFF preview #95f6f2
// snow band 1 (pal 11) [14.2, 18.3) raw #55FFFF preview #95f6f2
// snow band 2 (pal 12) [18.3, 22.5) raw #55AAFF preview #69b5dd
// snow band 3 (pal 13) [22.5, 26.7) raw #00AAFF preview #4cb4db
// snow band 4 (pal 14) [26.7, 30.8) raw #5555FF preview #4180d0
// snow band 5 (pal 15) [30.8, 35.0] clamp hi raw #0055FF preview #007dce

// BW

// BW radar (1-bit draft): shared transparent <-> opaque ramp, opaque = black (white when dark/inverted)
// rain dBZ [10, 50] -> coverage f; snow dBZ [0, 40] -> coverage f
// matrix: 2x2 [[0,2],[3,1]] (same tables as maplibre/sprites/generate_bayer.py), opaque iff M[y%N][x%N] < f*N*N
//     or: 4x4 [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]]
// phases: shared (rain+snow identical)
// degenerate range (end<=start): echo reads solid opaque