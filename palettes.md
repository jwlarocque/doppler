// NOAA NEXRAD

// Pebble 16-color radar palette (draft): 1 transparent + 12 rain + 3 snow
// rain dBZ [10, 70] equal-width, dBZ<start hidden, high clamped
// snow dBZ [5, 35] equal-width, dBZ<start hidden, high clamped
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

// Pebble 16-color radar palette (draft): 1 transparent + 10 rain + 5 snow
// rain dBZ [15, 50] equal-width, dBZ<start hidden, high clamped
// snow dBZ [0, 45] equal-width, dBZ<start hidden, high clamped
// NOTE: preview dBZ boost +2.5 dB active — NOT part of export
// rain band 0 (pal 1) [15.0, 18.5) raw #000055 preview #001e41
// rain band 1 (pal 2) [18.5, 22.0) raw #000055 preview #001e41
// rain band 2 (pal 3) [22.0, 25.5) raw #0000AA preview #004387
// rain band 3 (pal 4) [25.5, 29.0) raw #5500AA preview #40488a
// rain band 4 (pal 5) [29.0, 32.5) raw #AA00AA preview #955694
// rain band 5 (pal 6) [32.5, 36.0) raw #FF0000 preview #e35462
// rain band 6 (pal 7) [36.0, 39.5) raw #FF5500 preview #e66e6b
// rain band 7 (pal 8) [39.5, 43.0) raw #FFAA00 preview #f1aa86
// rain band 8 (pal 9) [43.0, 46.5) raw #FFFF00 preview #ffeeab
// rain band 9 (pal 10) [46.5, 50.0] clamp hi raw #FFFFAA preview #fff6d3
// snow band 0 (pal 11) [0.0, 9.0) raw #55FFFF preview #95f6f2
// snow band 1 (pal 12) [9.0, 18.0) raw #55FFFF preview #95f6f2
// snow band 2 (pal 13) [18.0, 27.0) raw #55AAFF preview #69b5dd
// snow band 3 (pal 14) [27.0, 36.0) raw #5555FF preview #4180d0
// snow band 4 (pal 15) [36.0, 45.0] clamp hi raw #0055FF preview #007dce