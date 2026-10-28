let sharedAudioContext: AudioContext | null = null;
let idleCloseTimer: ReturnType<typeof setTimeout> | null = null;
let alarmInterval: ReturnType<typeof setInterval> | null = null;

function getOrCreateAudioContext(): AudioContext | null {
  try {
    if (typeof window === 'undefined') return null;
    if (sharedAudioContext && sharedAudioContext.state !== 'closed') {
      if (sharedAudioContext.state === 'suspended') {
        sharedAudioContext.resume().catch(() => {});
      }
      return sharedAudioContext;
    }
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    sharedAudioContext = new AudioCtx();
    return sharedAudioContext;
  } catch {
    return null;
  }
}

function scheduleIdleClose() {
  if (idleCloseTimer !== null) {
    clearTimeout(idleCloseTimer);
  }
  idleCloseTimer = setTimeout(() => {
    idleCloseTimer = null;
    if (alarmInterval !== null) return;
    if (sharedAudioContext && sharedAudioContext.state !== 'closed') {
      const ctxToClose = sharedAudioContext;
      sharedAudioContext = null;
      ctxToClose.close().catch(() => {});
    }
  }, 5000);
}

function scheduleTone(
  ctx: AudioContext,
  frequency: number,
  startTime: number,
  attackEnd: number,
  stopTime: number,
  peakGain: number
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, startTime);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(peakGain, attackEnd);
  gain.gain.exponentialRampToValueAtTime(0.001, stopTime);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.onended = () => {
    try {
      osc.disconnect();
      gain.disconnect();
    } catch {}
  };
  osc.start(startTime);
  osc.stop(stopTime);
}

export function playNotificationSound(): void {
  try {
    const ctx = getOrCreateAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    scheduleTone(ctx, 659.25, now, now + 0.04, now + 0.5, 0.2);
    scheduleTone(ctx, 987.77, now + 0.12, now + 0.16, now + 0.7, 0.25);

    scheduleIdleClose();
  } catch {}
}

export function startContinuousAlarm(): void {
  try {
    if (alarmInterval !== null) return;
    playNotificationSound();
    alarmInterval = setInterval(() => {
      try {
        playNotificationSound();
      } catch {}
    }, 1500);
  } catch {}
}

export function stopContinuousAlarm(): void {
  try {
    if (alarmInterval !== null) {
      clearInterval(alarmInterval);
      alarmInterval = null;
    }
    scheduleIdleClose();
  } catch {}
}
