- perf
    - prv_px_to_trig in frame_strip.c; can we precompute this (either hardcode or at compile time) so we don't have to do a bunch of division at run time
- configuration
    - (done) autoplay on/off
    - (done) 2x2 or 4x4 dither on bw
    - (done) palette (NOAA NEXRAD or Dark Sky)
    - (done) number of past frames (minimum 1 - "live", maximum 12)
    - (done) number of nowcast frames (minimum 0, maximum 6)
    - simple or dither maps (color watches only)
    - playback speed (slider between 200ms and 1000ms?)
- features
    - display status/error line on watch
        - "loading..." when waiting for map or radar layout or frames
        - error when map or radar fetch fails (and fallbacks fail, if any) with brief description
        - error when no phone connection (`connection_service_peek_pebble_app_connection` ? https://developer.repebble.com/docs/c/Foundation/Event_Service/ConnectionService)
    - zoom in/out animation
    - store last zoom level in local storage and return to it after closing and re-opening the app
    - controls: if the user has configured only one radar frame (0 nowcast and 1 past - "live"), simplify the controls to be only zoom in/out (disable two-layer system and play/pause button)
    - (done) zoom level 8
    <can ship beta at this point>
    - dark mode
        - bw: probably just invert
        - color: probably just invert the map, maybe a separate color scheme for radar (?)
    - data sources
        - rainviewer
    - option to hide controls when not in use (layer 1 has a ~2 second timeout just like layer 2)

- stretch goals
    - custom palettes
    - stored locations
        - same behavior, but using a location configured in Clay and selected with a simple menu on the watch, instead of the user's current location
        - top option in menu: current location
    - low memory version for aplite and potentially basalt and chalk
        - disable time display
        - disable all frame strip animations
        - other stuff we can turn off?
    - high contrast mode
        - solid black or white background for action bar
        - two-color position marker
    - labels-on-top
        - extract place (town/city/state/country) labels from raster tiles, removing them from the raster image itself but inheriting the decision of when and where to render them (approximately) as separate data. (Discard other labels, e.g. bodies of water.)
        - transmit raster data and label data to the watch separately
        - render raster map, radar data, then place labels using native/pixel font (so they're visible on top of the radar data)
            - how to best render text "halo"?
    - watchface fork
    - noaa 2-minutely data (mrms?)
    - yet more data sources
        - if byok, error when no key/key invalid
    - (done) consider adding zoom level 8 (generate level 8 map tiles, fetch level 7 radar and 2x upscale _before_ dithering)
    - if librewxr unavailable, then fall back to https://www.rainviewer.com/api/weather-maps-api.html
    - (color only) if insufficient memory for 4bpp radar data, demote temporally furthest frames to 1bpp bw until all frames fit
    - additional configuration
        - map tile server
        - alternate rainview-compatible radar servers

- (DONE) map data acquisition
    - 256px tiles at current zoom level from vt-raster-converter (e.g. http://localhost:8081/tiles/pebble_bw/7/32/47 )
        - bw: crush to 1bpp (e.g. `convert image.png -colorspace gray -monochrome -depth 1 image_bw.png`, but need not use magick)
        - color: crush to 2bpp (e.g. `convert image.png -colorspace gray -dither None -posterize 4 -alpha off -depth 2 image_gray.png`, but need not use magick)
    - store and serve (locally for now)
    - pkjs fetches needed tiles, trims to exact screen dimensions (current location on map centered), lz4 compress (raw image data), and transmits to watch
        - round (chalk) - can we set up the image on the pkjs side so it can easily be written direct to the framebuffer?
        - round 2 (gabbro) - square framebuffer for round screen - the corners will probably compress pretty well
    - store
        - TODO: store efficiently without fragmentation - estimate max size of compressed data and reserve?
    - watch decompresses bits (bw) or writes black/white bytes (color watches), to framebuffer
- (DONE) radar data acquisition
    - start with most recent data
    - fetch 256px tiles at current zoom level needed to cover the screen from https://librewxr.net/docs/doc-viewer?doc=web-integration-guide
    - on bw, 1bit 4x4 Bayer dither (same dithering for rain or snow, black-on-transparent?); on color, convert to Pebble palette (black=transparent, probably only 2bpp), and trim to exact screen dimensions
    - lz4 compress (raw image bits for bw, raw 4bit for color)
        - TODO: can we add a special rle case in the compression for long runs of "transparent" (to save iterating over the pixels)? Maybe use an offset of 0 as a flag (followed by either 0..255 length code or two bytes for 0..65535)? Test compression ratio penalty and rendering speedup on flint hardware.
    - transmit to watch and store - will need to be efficient about packing
    - First time/invalidated fetch: repeat for previous and future ("nowcast", if available) radar data until reaching configured limits or memory is full, prioritizing temporally near data
- (DONE) data invalidation: time
    - When new data becomes available (roughly 11 minutes after timestamp of last "past" radar): replace the next "nowcast", if any, with the latest data. If more space is still needed (or we hit the configured past data limit), discard the temporally furthest data
- (DONE, probably) data invalidation: location
    - pkjs checks current location occasionally (on radar fetch)
    - if current location is more than some distance from center of screen, invalidate cached data and send fresh
- (DONE) data invalidation: zoom
    - if the user request a new zoom level, we need to invalidate cached data and send fresh
    - try to keep data for multiple zoom levels cached on the pkjs side (not preemptively, just if we already needed them), to avoid having to fetch it across the network again
- (DONE) controls
    - up
        - press: previous radar data frame (probably should also pause playback)
        - hold: zoom out
    - select
        - press: play/pause radar playback
    - down
        - press: next radar data frame
        - hold: zoom in


Thanks:
- Logan Head - Ripple
- The Rebble Alliance Discord


aplite: have 2
basalt: have 5
chalk: have 4
diorite: have 17
flint: have 17
emery: have 7
gabbro: have 6