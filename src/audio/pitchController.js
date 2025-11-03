const MIN_PITCH = 110;
const MAX_PITCH = 550;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
};

const hannWindow = (buffer) => {
  const windowed = new Float32Array(buffer.length);
  const factor = 2 * Math.PI / (buffer.length - 1);
  for (let i = 0; i < buffer.length; i++) {
    windowed[i] = buffer[i] * (0.5 - 0.5 * Math.cos(factor * i));
  }
  return windowed;
};

function yinPitch(buffer, sampleRate, minFrequency, maxFrequency) {
  const threshold = 0.12;
  const probabilityThreshold = 0.1;
  const windowedBuffer = hannWindow(buffer);
  const bufferSize = windowedBuffer.length;

  let tauMin = Math.max(2, Math.floor(sampleRate / maxFrequency));
  let tauMax = Math.min(Math.floor(sampleRate / minFrequency), bufferSize - 1);

  if (tauMin >= tauMax) {
    return null;
  }

  const yinBuffer = new Float32Array(tauMax);
  let runningSum = 0;

  for (let tau = 1; tau < tauMax; tau++) {
    let difference = 0;
    for (let i = 0; i < bufferSize - tau; i++) {
      const delta = windowedBuffer[i] - windowedBuffer[i + tau];
      difference += delta * delta;
    }
    yinBuffer[tau] = difference;
    runningSum += difference;
  }

  if (runningSum < 1e-9) {
    return null;
  }

  let cumulativeSum = 0;
  for (let tau = 1; tau < tauMax; tau++) {
    cumulativeSum += yinBuffer[tau];
    yinBuffer[tau] = cumulativeSum ? (yinBuffer[tau] * tau) / cumulativeSum : 1;
  }

  let tauEstimate = -1;
  for (let tau = tauMin; tau < tauMax; tau++) {
    if (yinBuffer[tau] < threshold) {
      while (tau + 1 < tauMax && yinBuffer[tau + 1] < yinBuffer[tau]) {
        tau++;
      }
      tauEstimate = tau;
      break;
    }
  }

  if (tauEstimate === -1) {
    return null;
  }

  const probability = 1 - yinBuffer[tauEstimate];
  if (probability < probabilityThreshold) {
    return null;
  }

  let betterTau = tauEstimate;
  if (tauEstimate > 1 && tauEstimate < tauMax - 1) {
    const s0 = yinBuffer[tauEstimate - 1];
    const s1 = yinBuffer[tauEstimate];
    const s2 = yinBuffer[tauEstimate + 1];
    const denominator = s0 + s2 - 2 * s1;
    if (denominator !== 0) {
      betterTau = tauEstimate + (s0 - s2) / (2 * denominator);
    }
  }

  const frequency = sampleRate / betterTau;
  if (!isFinite(frequency)) {
    return null;
  }

  return {
    frequency,
    probability,
  };
}

export class PitchController {
  constructor({ onValue, minPitch = MIN_PITCH, maxPitch = MAX_PITCH, smoothing = 0.25 } = {}) {
    this.onValue = onValue;
    this.minPitch = minPitch;
    this.maxPitch = maxPitch;
    this.smoothing = smoothing;

    this.audioContext = null;
    this.analyser = null;
    this.dataArray = null;
    this.isRunning = false;
    this.normalizedValue = 0.5;
    this.fallbackTimer = 0;
    this.recentDetections = [];
    this.maxDetections = 5;
    this.lastFrequency = null;
    this.silenceFrames = 0;
  }

  async start() {
    if (this.isRunning) return;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = this.audioContext.createMediaStreamSource(stream);

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.dataArray = new Float32Array(this.analyser.fftSize);

    source.connect(this.analyser);
    this.isRunning = true;
    this.processAudio();
  }

  stop() {
    this.isRunning = false;
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  processAudio() {
    if (!this.isRunning || !this.analyser) return;

    this.analyser.getFloatTimeDomainData(this.dataArray);
    const sampleRate = this.audioContext.sampleRate;
    const detection = yinPitch(this.dataArray, sampleRate, this.minPitch, this.maxPitch);

    let normalized;
    if (detection) {
      const clampedFreq = clamp(detection.frequency, this.minPitch, this.maxPitch);
      normalized = (clampedFreq - this.minPitch) / (this.maxPitch - this.minPitch);
      normalized = clamp(normalized, 0, 1);
      this.lastFrequency = clampedFreq;
      this.silenceFrames = 0;
      this.fallbackTimer = 0;
    } else if (this.lastFrequency && this.silenceFrames < 6) {
      this.silenceFrames += 1;
      normalized = (this.lastFrequency - this.minPitch) / (this.maxPitch - this.minPitch);
      normalized = clamp(normalized, 0, 1);
    } else {
      this.silenceFrames += 1;
      this.fallbackTimer += 1;
      if (this.fallbackTimer > 12) {
        this.lastFrequency = null;
        normalized = 0.5;
      }
    }

    if (typeof normalized === 'number') {
      this.recentDetections.push(normalized);
      if (this.recentDetections.length > this.maxDetections) {
        this.recentDetections.shift();
      }

      const stabilized = median(this.recentDetections);
      const delta = Math.abs(stabilized - this.normalizedValue);
      const dynamicSmoothing =
        delta > 0.4 ? 0.85 : delta > 0.15 ? 0.55 : Math.max(this.smoothing, 0.18);

      this.normalizedValue = this.normalizedValue + (stabilized - this.normalizedValue) * dynamicSmoothing;
      if (this.onValue) {
        this.onValue(this.normalizedValue);
      }
    } else if (this.onValue) {
      this.onValue(this.normalizedValue);
    }

    requestAnimationFrame(() => this.processAudio());
  }
}
