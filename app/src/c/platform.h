#pragma once

// cut some functionality on platforms with low memory/modest memory and high
// requirements for radar data
#if defined(PBL_PLATFORM_APLITE) || defined(PBL_PLATFORM_BASALT) || defined(PBL_PLATFORM_CHALK)
#define DOPPLER_LOW_MEMORY 1
#endif

// on aplite, also drop the frame time text and font
#ifdef PBL_PLATFORM_APLITE
#define DOPPLER_NO_FRAME_TIME 1
#endif

#define DOPPLER_DEBUG_LOGS 0

#if DOPPLER_DEBUG_LOGS
#define DOPPLER_LOG(level, ...) APP_LOG(level, __VA_ARGS__)
#else
#define DOPPLER_LOG(level, ...) do {} while (0)
#endif
