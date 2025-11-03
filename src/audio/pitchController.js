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

function autoCorrelate(buffer, sampleRate) {
  const SIZE = buffer.length;
  const MAX_SAMPLES = Math.floor(SIZE / 2);
  let bestOffset = -1;
  let bestCorrelation = 0;
  let rms = 0;

  for (let i = 0; i < SIZE; i++) {
    const val = buffer[i];
    rms += val * val;
  }
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) {
    return null;
  }

  let lastCorrelation = 1;
  let foundGoodCorrelation = false;
  for (let offset = MIN_PITCH === 0 ? 1 : 0; offset < MAX_SAMPLES; offset++) {
    let correlation = 0;

    for (let i = 0; i < MAX_SAMPLES; i++) {
      correlation += Math.abs(buffer[i] - buffer[i + offset]);
    }
    correlation = 1 - correlation / MAX_SAMPLES;

    if (correlation > 0.9 && correlation > lastCorrelation) {
      foundGoodCorrelation = true;
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = offset;
      }
    } else if (foundGoodCorrelation) {
      const shift = (correlation - lastCorrelation) / bestCorrelation;
      return sampleRate / (bestOffset + 8 * shift);
    }
    lastCorrelation = correlation;
  }

  if (bestCorrelation > 0.01) {
    return sampleRate / bestOffset;
  }

  return null;
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
    this.maxDetections = 7;
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
    const freq = autoCorrelate(this.dataArray, sampleRate);

    let normalized;
    if (freq && freq > 0) {
      const clampedFreq = clamp(freq, this.minPitch, this.maxPitch);
      normalized = (clampedFreq - this.minPitch) / (this.maxPitch - this.minPitch);
      normalized = clamp(normalized, 0, 1);
      this.fallbackTimer = 0;
    } else {
      this.fallbackTimer += 1;
      if (this.fallbackTimer > 10) {
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
      const dynamicSmoothing = delta > 0.25 ? 0.55 : delta > 0.1 ? 0.4 : this.smoothing;

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
