class StellaPcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = options.processorOptions?.targetSampleRate || 16000;
    this.frameSamples = Math.round(this.targetRate * 0.02);
    this.pending = [];
    this.phase = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    const ratio = sampleRate / this.targetRate;
    while (this.phase < input.length) {
      const left = Math.floor(this.phase);
      const right = Math.min(left + 1, input.length - 1);
      const mix = this.phase - left;
      const sample = input[left] * (1 - mix) + input[right] * mix;
      this.pending.push(Math.max(-1, Math.min(1, sample)));
      this.phase += ratio;
    }
    this.phase -= input.length;

    while (this.pending.length >= this.frameSamples) {
      const pcm = new Int16Array(this.frameSamples);
      for (let i = 0; i < this.frameSamples; i += 1) {
        const value = this.pending[i];
        pcm[i] = value < 0 ? value * 32768 : value * 32767;
      }
      this.pending.splice(0, this.frameSamples);
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}

registerProcessor("stella-pcm-processor", StellaPcmProcessor);
