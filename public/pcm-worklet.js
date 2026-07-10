class MeetlyPcmWorklet extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const frameSamples = options?.processorOptions?.frameSamples;
    this.frameSamples = Number.isFinite(frameSamples) && frameSamples > 0 ? Math.round(frameSamples) : 1600;
    this.buf = new Float32Array(this.frameSamples);
    this.n = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    let i = 0;
    while (i < channel.length) {
      const take = Math.min(channel.length - i, this.buf.length - this.n);
      this.buf.set(channel.subarray(i, i + take), this.n);
      this.n += take;
      i += take;

      if (this.n === this.buf.length) {
        const out = this.buf;
        this.port.postMessage(out.buffer, [out.buffer]);
        this.buf = new Float32Array(this.frameSamples);
        this.n = 0;
      }
    }

    return true;
  }
}

registerProcessor("meetly-pcm-worklet", MeetlyPcmWorklet);
