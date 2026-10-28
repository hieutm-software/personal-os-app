<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import {
    Sun,
    Moon,
    Cloud,
    CloudDrizzle,
    CloudRain,
    Snowflake,
    CloudLightning,
    MapPin,
    ChevronDown,
    CloudOff
  } from "lucide-svelte";
  import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "../../shared/ui/dropdown";

  const CITIES = [
    "Auto Detect",
    "Hanoi",
    "Ho Chi Minh City",
    "Thanh Hóa",
    "Đà Nẵng",
    "Hải Phòng",
    "Cần Thơ",
    "Nghệ An",
    "Huế",
    "Nha Trang",
    "Đà Lạt",
    "Quảng Ninh"
  ] as const;

  const CITY_COORDS: Readonly<Record<string, { lat: number; lon: number }>> = Object.freeze({
    "Hanoi": { lat: 21.0285, lon: 105.8542 },
    "Ho Chi Minh City": { lat: 10.8231, lon: 106.6297 },
    "Thanh Hóa": { lat: 19.8067, lon: 105.7852 },
    "Đà Nẵng": { lat: 16.0544, lon: 108.2022 },
    "Hải Phòng": { lat: 20.8449, lon: 106.6881 },
    "Cần Thơ": { lat: 10.0452, lon: 105.7469 },
    "Nghệ An": { lat: 18.6734, lon: 105.6811 },
    "Huế": { lat: 16.4637, lon: 107.5909 },
    "Nha Trang": { lat: 12.2388, lon: 109.1967 },
    "Đà Lạt": { lat: 11.9404, lon: 108.4583 },
    "Quảng Ninh": { lat: 20.9505, lon: 107.0734 }
  });

  const DEFAULT_TEMP_STYLE = Object.freeze({
    text: "text-cyan-700 dark:text-cyan-400",
    bg: "from-cyan-500/10"
  });

  const SHORT_DAY_FORMATTER = new Intl.DateTimeFormat(undefined, { weekday: "short" });
  const LONG_DAY_FORMATTER = new Intl.DateTimeFormat(undefined, { weekday: "long" });
  const TIME_HM_FORMATTER = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });

  function getWeatherInfo(code: number, isDay: boolean = true) {
    try {
      if (code === 0) {
        return {
          Icon: isDay ? Sun : Moon,
          color: isDay ? "text-amber-500 fill-amber-500/20 dark:text-yellow-400 dark:fill-yellow-400/20" : "text-blue-500 fill-blue-500/20 dark:text-blue-300 dark:fill-blue-300/20",
          desc: "Clear"
        };
      }
      if (code === 1 || code === 2) {
        return {
          Icon: isDay ? Sun : Moon,
          color: isDay ? "text-amber-500/80 dark:text-yellow-400/80" : "text-blue-500/80 dark:text-blue-300/80",
          desc: "Partly cloudy"
        };
      }
      if (code === 3) {
        return { Icon: Cloud, color: "text-slate-500 fill-slate-500/20 dark:text-slate-400 dark:fill-slate-400/20", desc: "Mostly cloudy" };
      }
      if (code >= 51 && code <= 67) {
        return { Icon: CloudDrizzle, color: "text-blue-600 fill-blue-600/20 dark:text-blue-400 dark:fill-blue-400/20", desc: "Rainy" };
      }
      if (code >= 71 && code <= 77) {
        return { Icon: Snowflake, color: "text-sky-600 dark:text-blue-200", desc: "Snowy" };
      }
      if (code >= 80 && code <= 82) {
        return { Icon: CloudRain, color: "text-blue-600 fill-blue-600/20 dark:text-blue-500 dark:fill-blue-500/20", desc: "Showers" };
      }
      if (code >= 95) {
        return { Icon: CloudLightning, color: "text-purple-600 fill-purple-600/20 dark:text-purple-400 dark:fill-purple-400/20", desc: "Thunderstorm" };
      }
      return {
        Icon: isDay ? Sun : Moon,
        color: isDay ? "text-amber-500 dark:text-yellow-400" : "text-blue-500 dark:text-blue-300",
        desc: "Clear"
      };
    } catch {
      return { Icon: Sun, color: "text-amber-500 dark:text-yellow-400", desc: "Unknown" };
    }
  }

  function getTempStyle(temp: number) {
    try {
      if (temp < 10) return { text: "text-cyan-500 dark:text-cyan-400", bg: "from-cyan-500/10" };
      if (temp < 20) return { text: "text-blue-500 dark:text-blue-400", bg: "from-blue-500/10" };
      if (temp < 28) return { text: "text-emerald-500 dark:text-emerald-400", bg: "from-emerald-500/10" };
      if (temp < 35) return { text: "text-orange-500 dark:text-orange-400", bg: "from-orange-500/10" };
      return { text: "text-red-500 dark:text-red-400", bg: "from-red-500/10" };
    } catch {
      return DEFAULT_TEMP_STYLE;
    }
  }

  function isValidCoord(lat: number, lon: number): boolean {
    return Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lon) && lon >= -180 && lon <= 180;
  }

  function sanitizeLocationName(value: unknown, fallback: string): string {
    if (typeof value !== "string") return fallback;
    const trimmed = value.trim().slice(0, 80);
    return trimmed.length > 0 ? trimmed : fallback;
  }

  function getBrowserCoords(): Promise<{ lat: number; lon: number } | null> {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, 5000);

      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (!settled) {
              settled = true;
              clearTimeout(timeoutId);
              const lat = pos?.coords?.latitude;
              const lon = pos?.coords?.longitude;
              if (typeof lat === "number" && typeof lon === "number" && isValidCoord(lat, lon)) {
                resolve({ lat, lon });
              } else {
                resolve(null);
              }
            }
          },
          () => {
            if (!settled) {
              settled = true;
              clearTimeout(timeoutId);
              resolve(null);
            }
          },
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 300000 }
        );
      } catch {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          resolve(null);
        }
      }
    });
  }

  interface WeatherData {
    current: {
      temp: number;
      humidity: number;
      precipitation: number;
      windSpeed: number;
      code: number;
      isDay: boolean;
    };
    daily: {
      time: string[];
      code: number[];
      maxTemp: number[];
      minTemp: number[];
    };
    location: string;
  }

  let weather = $state<WeatherData | null>(null);
  let time = $state(new Date());
  let selectedCity = $state("Hanoi");
  let loading = $state(true);
  let error = $state<string | null>(null);

  let timer: ReturnType<typeof setInterval> | null = null;
  let weatherTimer: ReturnType<typeof setInterval> | null = null;
  let isMounted = true;
  let activeAbortController: AbortController | null = null;
  let latestRequestId = 0;

  function cleanup() {
    try {
      isMounted = false;
      if (activeAbortController) {
        activeAbortController.abort();
        activeAbortController = null;
      }
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      if (weatherTimer !== null) {
        clearInterval(weatherTimer);
        weatherTimer = null;
      }
    } catch {}
  }

  onMount(() => {
    try {
      if (typeof window !== "undefined") {
        const storedCity = localStorage.getItem("weather_city");
        if (storedCity && (CITIES as readonly string[]).includes(storedCity)) {
          selectedCity = storedCity;
        }
      }

      timer = setInterval(() => {
        try {
          if (isMounted) {
            time = new Date();
          }
        } catch {}
      }, 10000);

      weatherTimer = setInterval(() => {
        if (isMounted) {
          fetchWeather().catch(() => {});
        }
      }, 1800000);

      return cleanup;
    } catch {
      return cleanup;
    }
  });

  onDestroy(cleanup);

  $effect(() => {
    try {
      if (selectedCity && isMounted) {
        fetchWeather().catch(() => {});
      }
    } catch {}
  });

  function pruneAndReadCache(cacheKey: string): WeatherData | null {
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith("weather_cache_") && key !== cacheKey) {
          sessionStorage.removeItem(key);
        }
      }

      const cached = sessionStorage.getItem(cacheKey);
      if (!cached) return null;
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed.timestamp === "number" && Date.now() - parsed.timestamp < 1800000 && parsed.data) {
        return parsed.data as WeatherData;
      }
    } catch {}
    return null;
  }

  async function fetchWeather() {
    if (!isMounted) return;
    const requestId = ++latestRequestId;

    if (activeAbortController) {
      activeAbortController.abort();
    }
    const controller = new AbortController();
    activeAbortController = controller;
    const { signal } = controller;

    loading = true;
    error = null;

    try {
      let lat = 21.0285;
      let lon = 105.8542;
      let city = "Hanoi";

      if (selectedCity === "Auto Detect") {
        let useSaved = false;
        try {
          const savedCoordsStr = localStorage.getItem("weather_auto_coords");
          if (savedCoordsStr) {
            const saved = JSON.parse(savedCoordsStr);
            const savedLat = Number(saved?.lat);
            const savedLon = Number(saved?.lon);
            const savedTs = Number(saved?.timestamp);
            if (
              Number.isFinite(savedTs) &&
              Date.now() - savedTs < 3600000 &&
              isValidCoord(savedLat, savedLon)
            ) {
              lat = savedLat;
              lon = savedLon;
              city = sanitizeLocationName(saved.city, "Current Location");
              useSaved = true;
            }
          }
        } catch {}

        if (!useSaved) {
          let locationFetched = false;

          // 1. Try High-Accuracy Hardware / OS Geolocation first (Windows Location / Wi-Fi Triangulation)
          try {
            const browserCoords = await getBrowserCoords();
            if (!isMounted || requestId !== latestRequestId) return;
            if (browserCoords) {
              lat = browserCoords.lat;
              lon = browserCoords.lon;
              locationFetched = true;

              // Reverse geocode to get true administrative province / city name
              try {
                const geoRes = await fetch(
                  `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&localityLanguage=vi`,
                  { signal }
                );
                if (geoRes.ok) {
                  const geoData = await geoRes.json();
                  const placeName = geoData?.city || geoData?.principalSubdivision || geoData?.locality;
                  if (placeName) {
                    city = sanitizeLocationName(placeName, "Current Location");
                  }
                }
              } catch {}
            }
          } catch {}

          // 2. Fall back to IP Geolocation if hardware/browser geolocation was unavailable or denied
          if (!locationFetched) {
            try {
              const ipRes = await fetch("https://get.geojs.io/v1/ip/geo.json", { signal });
              if (!isMounted || requestId !== latestRequestId) return;
              if (ipRes.ok) {
                const ipData = await ipRes.json();
                if (!isMounted || requestId !== latestRequestId) return;
                const parsedLat = Number.parseFloat(ipData?.latitude);
                const parsedLon = Number.parseFloat(ipData?.longitude);
                if (isValidCoord(parsedLat, parsedLon)) {
                  lat = parsedLat;
                  lon = parsedLon;
                  city = sanitizeLocationName(ipData?.city || ipData?.region, "Current Location");
                  locationFetched = true;
                }
              }
            } catch (geoErr: any) {
              if (geoErr?.name === "AbortError") return;
            }
          }

          if (!locationFetched) {
            try {
              const ipapiRes = await fetch("https://ipapi.co/json/", { signal });
              if (!isMounted || requestId !== latestRequestId) return;
              if (ipapiRes.ok) {
                const ipapiData = await ipapiRes.json();
                if (!isMounted || requestId !== latestRequestId) return;
                const parsedLat = Number(ipapiData?.latitude);
                const parsedLon = Number(ipapiData?.longitude);
                if (isValidCoord(parsedLat, parsedLon)) {
                  lat = parsedLat;
                  lon = parsedLon;
                  city = sanitizeLocationName(ipapiData?.city, "Current Location");
                }
              }
            } catch (fallbackErr: any) {
              if (fallbackErr?.name === "AbortError") return;
            }
          }

          try {
            localStorage.setItem(
              "weather_auto_coords",
              JSON.stringify({ lat, lon, timestamp: Date.now(), city })
            );
          } catch {}
        }
      } else {
        city = selectedCity;
        const coords = CITY_COORDS[city];
        if (coords) {
          lat = coords.lat;
          lon = coords.lon;
        }
      }

      const cacheKey = `weather_cache_${lat}_${lon}`;
      const cachedWeather = pruneAndReadCache(cacheKey);
      if (cachedWeather) {
        if (isMounted && requestId === latestRequestId) {
          weather = cachedWeather;
          loading = false;
        }
        return;
      }

      const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`;
      const res = await fetch(url, { signal });
      if (!isMounted || requestId !== latestRequestId) return;
      if (!res.ok) throw new Error("Weather fetch failed");

      const data = await res.json();
      if (!isMounted || requestId !== latestRequestId) return;

      if (!data?.current || !data?.daily || !Array.isArray(data.daily.time)) {
        throw new Error("Invalid weather data format");
      }

      const newWeather: WeatherData = {
        current: {
          temp: Number(data.current.temperature_2m) || 0,
          humidity: Number(data.current.relative_humidity_2m) || 0,
          precipitation: Number(data.current.precipitation) || 0,
          windSpeed: Number(data.current.wind_speed_10m) || 0,
          code: Number(data.current.weather_code) || 0,
          isDay: data.current.is_day === 1
        },
        daily: {
          time: data.daily.time.slice(0, 7).map(String),
          code: Array.isArray(data.daily.weather_code) ? data.daily.weather_code.slice(0, 7).map(Number) : [],
          maxTemp: Array.isArray(data.daily.temperature_2m_max) ? data.daily.temperature_2m_max.slice(0, 7).map(Number) : [],
          minTemp: Array.isArray(data.daily.temperature_2m_min) ? data.daily.temperature_2m_min.slice(0, 7).map(Number) : []
        },
        location: city
      };

      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data: newWeather }));
      } catch {}

      weather = newWeather;
    } catch (err: any) {
      if (err?.name === "AbortError" || !isMounted || requestId !== latestRequestId) return;
      error = err instanceof Error ? err.message : "Failed to fetch weather data";
    } finally {
      if (isMounted && requestId === latestRequestId) {
        loading = false;
      }
    }
  }

  function handleCitySelect(city: string) {
    try {
      if (city !== selectedCity) loading = true;
      if (city === "Auto Detect") {
        localStorage.removeItem("weather_auto_coords");
      }
      selectedCity = city;
      localStorage.setItem("weather_city", city);
    } catch {}
  }

  let tempStyle = $derived(weather ? getTempStyle(weather.current.temp) : DEFAULT_TEMP_STYLE);
  let currentWeatherInfo = $derived(weather ? getWeatherInfo(weather.current.code, weather.current.isDay) : null);
  let formattedDateTime = $derived.by(() => {
    try {
      return `${LONG_DAY_FORMATTER.format(time)} ${TIME_HM_FORMATTER.format(time)}`;
    } catch {
      return "";
    }
  });

  let dailyForecast = $derived.by(() => {
    if (!weather) return [];
    try {
      const { time: times, code: codes, maxTemp, minTemp } = weather.daily;
      const len = Math.min(times.length, 7);
      const items = new Array(len);
      for (let i = 0; i < len; i++) {
        const dateStr = times[i];
        const dayDate = new Date(dateStr);
        const dayName = i === 0 ? "Today" : Number.isNaN(dayDate.getTime()) ? dateStr : SHORT_DAY_FORMATTER.format(dayDate);
        const dayWeather = getWeatherInfo(codes[i] ?? 0, true);
        items[i] = {
          dayName,
          DayIcon: dayWeather.Icon,
          color: dayWeather.color,
          max: Math.round(maxTemp[i] ?? 0),
          min: Math.round(minTemp[i] ?? 0)
        };
      }
      return items;
    } catch {
      return [];
    }
  });
</script>

<div class="card-aura-responsive p-3 sm:p-4 flex flex-col relative w-full overflow-visible z-20 shrink-0 transition-colors duration-1000 will-change-[transform,opacity,background-color]">
  {#if loading && !weather}
    <div class="flex-1 flex items-center justify-center min-h-32 relative z-overlay">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  {:else if weather}
    <div class="flex flex-col h-full relative z-overlay">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2">
        <div class="flex flex-col gap-1.5 relative">
          <div class="relative z-20 inline-flex">
            <DropdownMenu>
              <DropdownMenuTrigger>
                <button
                  class="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors outline-none w-max -ml-1 px-1 py-1 rounded-md"
                  title="Select region"
                >
                  <MapPin class="w-4 h-4 shrink-0" />
                  <span class="truncate max-w-50">
                    {weather.location}
                  </span>
                  <ChevronDown class="w-3.5 h-3.5 opacity-60" />
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="start" class="w-52 max-h-72 overflow-y-auto bg-card border-premium-border shadow-2xl">
                {#each CITIES as city (city)}
                  <DropdownMenuItem
                    onclick={() => handleCitySelect(city)}
                    class="w-full text-left px-3.5 py-2 text-sm flex items-center justify-between {city === selectedCity ? 'bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 font-medium' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
                  >
                    <span>{city}</span>
                    {#if city === selectedCity}
                      <span class="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0"></span>
                    {/if}
                  </DropdownMenuItem>
                {/each}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div class="flex items-center gap-6 mt-1">
            <div class="flex items-start gap-4">
              {#if currentWeatherInfo}
                {@const CurrentIcon = currentWeatherInfo.Icon}
                <CurrentIcon class={`w-14 h-14 shrink-0 drop-shadow-md ${currentWeatherInfo.color}`} />
              {/if}

              <div class={`flex items-start transition-colors duration-1000 ${tempStyle.text}`}>
                <span class="text-6xl font-medium tracking-tighter tabular-nums leading-[0.8] mt-1">
                  {Math.round(weather.current.temp)}
                </span>
                <div class="flex flex-col ml-1.5 mt-1 font-medium text-lg">
                  <span>°C</span>
                </div>
              </div>
            </div>

            <div class="hidden sm:flex flex-col gap-0.5 text-xs text-muted-foreground justify-center ml-2">
              <span>Precipitation: <span class="text-foreground/80">{weather.current.precipitation} mm</span></span>
              <span>Humidity: <span class="text-foreground/80">{weather.current.humidity}%</span></span>
              <span>Wind: <span class="text-foreground/80">{weather.current.windSpeed} km/h</span></span>
            </div>
          </div>
        </div>

        <div class="flex flex-col text-left sm:text-right relative z-overlay">
          <span class={`text-lg font-semibold tracking-tight transition-colors duration-1000 ${tempStyle.text}`}>Weather</span>
          <span class="text-sm text-muted-foreground mt-0.5">
            {formattedDateTime}
          </span>
          {#if currentWeatherInfo}
            <span class="text-sm text-muted-foreground mt-0.5">
              {currentWeatherInfo.desc}
            </span>
          {/if}
        </div>
      </div>

      <div class="flex justify-between text-xs text-muted-foreground mb-4 sm:hidden border-t border-premium-border pt-3">
        <div class="flex flex-col gap-1">
          <span>Precipitation</span>
          <span class="font-medium text-foreground">{weather.current.precipitation} mm</span>
        </div>
        <div class="flex flex-col gap-1 text-center">
          <span>Humidity</span>
          <span class="font-medium text-foreground">{weather.current.humidity}%</span>
        </div>
        <div class="flex flex-col gap-1 text-right">
          <span>Wind</span>
          <span class="font-medium text-foreground">{weather.current.windSpeed} km/h</span>
        </div>
      </div>

      <div class="mt-auto pt-4 border-t border-premium-border">
        <div class="flex justify-between items-end gap-2 overflow-x-auto pb-2 scrollbar-none">
          {#each dailyForecast as item, index (index)}
            {@const DayIcon = item.DayIcon}
            <div class="flex flex-col items-center min-w-12.5 gap-2">
              <span class="text-xs font-medium text-foreground">{item.dayName}</span>
              <DayIcon class={`w-6 h-6 my-1 ${item.color}`} />
              <div class="flex items-center gap-1.5 text-xs">
                <span class="font-medium text-foreground">{item.max}°</span>
                <span class="text-muted-foreground">{item.min}°</span>
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>
  {:else}
    <div class="flex-1 flex flex-col items-center justify-center text-muted-foreground text-sm relative z-overlay">
      <CloudOff class="w-8 h-8 mb-2 opacity-50" />
      <p>{error || "No weather data available."}</p>
    </div>
  {/if}
</div>
