class Pcm16CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const requestedRate = options?.processorOptions?.targetSampleRate;
    this.targetSampleRate = Number.isFinite(requestedRate) ? requestedRate : 16000;
    this.ratio = sampleRate / this.targetSampleRate;
    this.totalInputSamples = 0;
    this.nextOutputPosition = 0;
    this.lastSample = 0;
    this.packetSize = Math.max(320, Math.round(this.targetSampleRate * 0.1));
    this.packet = new Int16Array(this.packetSize);
    this.packetOffset = 0;
    this.levelCounter = 0;
  }

  emitSample(value) {
    const clamped = Math.max(-1, Math.min(1, value));
    this.packet[this.packetOffset++] = clamped < 0
      ? Math.round(clamped * 32768)
      : Math.round(clamped * 32767);

    if (this.packetOffset === this.packet.length) {
      const buffer = this.packet.buffer;
      this.port.postMessage({ type: 'pcm', buffer }, [buffer]);
      this.packet = new Int16Array(this.packetSize);
      this.packetOffset = 0;
    }
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (output) output.fill(0);
    if (!input || input.length === 0) return true;

    let sumSquares = 0;
    for (let i = 0; i < input.length; i += 1) {
      sumSquares += input[i] * input[i];
    }

    const blockStart = this.totalInputSamples;
    const blockEnd = blockStart + input.length;

    while (this.nextOutputPosition < blockEnd) {
      const index = Math.floor(this.nextOutputPosition);
      const fraction = this.nextOutputPosition - index;
      const nextIndex = index + 1;
      if (nextIndex >= blockEnd) break;

      const sample0 = index < blockStart
        ? this.lastSample
        : input[index - blockStart];
      const sample1 = input[nextIndex - blockStart];
      this.emitSample(sample0 + (sample1 - sample0) * fraction);
      this.nextOutputPosition += this.ratio;
    }

    this.totalInputSamples = blockEnd;
    this.lastSample = input[input.length - 1];

    this.levelCounter += 1;
    if (this.levelCounter >= 24) {
      this.levelCounter = 0;
      this.port.postMessage({
        type: 'level',
        value: Math.min(1, Math.sqrt(sumSquares / input.length) * 4)
      });
    }

    return true;
  }
}

registerProcessor('pcm16-capture', Pcm16CaptureProcessor);
