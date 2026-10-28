const MINUTE_MS = 60000;
const isClient = typeof window !== 'undefined';

function safeParseInterval(val: unknown, defaultVal: number): number {
  if (val === null || val === undefined || val === '') return defaultVal;
  const parsed = typeof val === 'number' ? val : parseFloat(String(val));
  return !Number.isFinite(parsed) || parsed <= 0 ? defaultVal : parsed;
}

function readStorageBoolean(key: string): boolean {
  if (!isClient) return false;
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function readStorageInterval(key: string, defaultVal: number): number {
  if (!isClient) return defaultVal;
  try {
    return safeParseInterval(localStorage.getItem(key), defaultVal);
  } catch {
    return defaultVal;
  }
}

function writeStorage(key: string, value: string): void {
  if (!isClient) return;
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function createHealthStore() {
  let waterEnabled = $state(readStorageBoolean('water_reminder_enabled'));
  let waterInterval = $state(readStorageInterval('water_reminder_interval', 60));
  let nextWaterTime = $state(0);

  let sedentaryEnabled = $state(readStorageBoolean('sedentary_enabled'));
  let sedentaryInterval = $state(readStorageInterval('sedentary_interval', 45));
  let nextSedentaryTime = $state(0);

  let eyeCareEnabled = $state(readStorageBoolean('eyecare_enabled'));
  let eyeCareInterval = $state(readStorageInterval('eyecare_interval', 20));
  let nextEyeCareTime = $state(0);

  return {
    get waterEnabled() {
      return waterEnabled;
    },
    set waterEnabled(val: boolean) {
      const enabled = Boolean(val);
      waterEnabled = enabled;
      writeStorage('water_reminder_enabled', String(enabled));
      nextWaterTime = enabled ? Date.now() + waterInterval * MINUTE_MS : 0;
    },

    get waterInterval() {
      return waterInterval;
    },
    set waterInterval(val: number) {
      const sanitized = safeParseInterval(val, 60);
      waterInterval = sanitized;
      writeStorage('water_reminder_interval', String(sanitized));
      if (waterEnabled) {
        nextWaterTime = Date.now() + sanitized * MINUTE_MS;
      }
    },

    get nextWaterTime() {
      return nextWaterTime;
    },
    set nextWaterTime(val: number) {
      nextWaterTime = Number.isFinite(val) && val >= 0 ? val : 0;
    },

    get sedentaryEnabled() {
      return sedentaryEnabled;
    },
    set sedentaryEnabled(val: boolean) {
      const enabled = Boolean(val);
      sedentaryEnabled = enabled;
      writeStorage('sedentary_enabled', String(enabled));
      nextSedentaryTime = enabled ? Date.now() + sedentaryInterval * MINUTE_MS : 0;
    },

    get sedentaryInterval() {
      return sedentaryInterval;
    },
    set sedentaryInterval(val: number) {
      const sanitized = safeParseInterval(val, 45);
      sedentaryInterval = sanitized;
      writeStorage('sedentary_interval', String(sanitized));
      if (sedentaryEnabled) {
        nextSedentaryTime = Date.now() + sanitized * MINUTE_MS;
      }
    },

    get nextSedentaryTime() {
      return nextSedentaryTime;
    },
    set nextSedentaryTime(val: number) {
      nextSedentaryTime = Number.isFinite(val) && val >= 0 ? val : 0;
    },

    get eyeCareEnabled() {
      return eyeCareEnabled;
    },
    set eyeCareEnabled(val: boolean) {
      const enabled = Boolean(val);
      eyeCareEnabled = enabled;
      writeStorage('eyecare_enabled', String(enabled));
      nextEyeCareTime = enabled ? Date.now() + eyeCareInterval * MINUTE_MS : 0;
    },

    get eyeCareInterval() {
      return eyeCareInterval;
    },
    set eyeCareInterval(val: number) {
      const sanitized = safeParseInterval(val, 20);
      eyeCareInterval = sanitized;
      writeStorage('eyecare_interval', String(sanitized));
      if (eyeCareEnabled) {
        nextEyeCareTime = Date.now() + sanitized * MINUTE_MS;
      }
    },

    get nextEyeCareTime() {
      return nextEyeCareTime;
    },
    set nextEyeCareTime(val: number) {
      nextEyeCareTime = Number.isFinite(val) && val >= 0 ? val : 0;
    },

    init() {
      if (!isClient) return;
      const now = Date.now();
      waterEnabled = readStorageBoolean('water_reminder_enabled');
      waterInterval = readStorageInterval('water_reminder_interval', 60);
      nextWaterTime = waterEnabled ? now + waterInterval * MINUTE_MS : 0;

      sedentaryEnabled = readStorageBoolean('sedentary_enabled');
      sedentaryInterval = readStorageInterval('sedentary_interval', 45);
      nextSedentaryTime = sedentaryEnabled ? now + sedentaryInterval * MINUTE_MS : 0;

      eyeCareEnabled = readStorageBoolean('eyecare_enabled');
      eyeCareInterval = readStorageInterval('eyecare_interval', 20);
      nextEyeCareTime = eyeCareEnabled ? now + eyeCareInterval * MINUTE_MS : 0;
    },
  };
}

export const healthStore = createHealthStore();
