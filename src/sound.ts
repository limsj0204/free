import { getSoundOn, getVolume } from './progress';

// 효과음은 파일 없이 Web Audio로 합성한다 (저작권 걱정 없고 용량도 거의 0).
// 브라우저는 사용자가 한 번 누르기 전에는 소리를 막으니, 첫 클릭·터치·키 입력 때 오디오를 깨운다.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (!getSoundOn()) return null;
  if (!ctx) {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.connect(ctx.destination);
      // 1초짜리 백색 소음: 타격음·관중 소리 재료
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  master!.gain.value = getVolume();
  return ctx;
}

export function unlockAudio() {
  audio();
}

// 짧은 소음 한 덩어리 (필터와 감쇠로 성격을 정한다)
function burst(c: AudioContext, opts: { type: BiquadFilterType; freq: number; q?: number; gain: number; decay: number; delay?: number; attack?: number }) {
  const t = c.currentTime + (opts.delay ?? 0);
  const src = c.createBufferSource();
  src.buffer = noise;
  const f = c.createBiquadFilter();
  f.type = opts.type;
  f.frequency.value = opts.freq;
  f.Q.value = opts.q ?? 1;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.gain, t + (opts.attack ?? 0.002));
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.decay);
  src.connect(f).connect(g).connect(master!);
  src.start(t, Math.random() * 0.5);
  src.stop(t + opts.decay + 0.05);
}

function tone(c: AudioContext, opts: { freq: number; to?: number; type?: OscillatorType; gain: number; decay: number; delay?: number }) {
  const t = c.currentTime + (opts.delay ?? 0);
  const o = c.createOscillator();
  o.type = opts.type ?? 'sine';
  o.frequency.setValueAtTime(opts.freq, t);
  if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + opts.decay);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.decay);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + opts.decay + 0.05);
}

export const sfx = {
  // 타격: 딱! (번트는 작게 톡)
  bat(bunt = false) {
    const c = audio();
    if (!c) return;
    if (bunt) {
      burst(c, { type: 'bandpass', freq: 1800, q: 2, gain: 0.25, decay: 0.06 });
      tone(c, { freq: 700, to: 400, gain: 0.12, decay: 0.05 });
      return;
    }
    burst(c, { type: 'highpass', freq: 1500, gain: 0.9, decay: 0.09 });
    burst(c, { type: 'bandpass', freq: 3200, q: 3, gain: 0.5, decay: 0.05 });
    tone(c, { freq: 1100, to: 600, type: 'triangle', gain: 0.35, decay: 0.08 });
  },
  // 글러브에 퍽
  glove() {
    const c = audio();
    if (!c) return;
    burst(c, { type: 'lowpass', freq: 900, gain: 0.7, decay: 0.07 });
    tone(c, { freq: 160, to: 90, gain: 0.45, decay: 0.08 });
  },
  // 송구: 짧게 휙
  whoosh() {
    const c = audio();
    if (!c) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.5;
    f.frequency.setValueAtTime(600, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.18);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    src.connect(f).connect(g).connect(master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.25);
  },
  // 아웃: 높은 신호음 두 번 + 관중 환호
  out() {
    const c = audio();
    if (!c) return;
    tone(c, { freq: 880, gain: 0.18, decay: 0.12, type: 'square' });
    tone(c, { freq: 1320, gain: 0.16, decay: 0.18, type: 'square', delay: 0.11 });
    burst(c, { type: 'bandpass', freq: 1000, q: 0.6, gain: 0.22, decay: 1.4, attack: 0.25, delay: 0.05 });
  },
  // 세이프·빠짐: 낮게 떨어지는 신호음
  safe() {
    const c = audio();
    if (!c) return;
    tone(c, { freq: 330, to: 200, gain: 0.2, decay: 0.35, type: 'triangle' });
  },
  // 결과: 최선이면 밝게, 아니면 담백하게
  result(best: boolean) {
    const c = audio();
    if (!c) return;
    if (best) {
      [523, 659, 784].forEach((f, i) => tone(c, { freq: f, gain: 0.14, decay: 0.3, delay: i * 0.09, type: 'triangle' }));
    } else {
      tone(c, { freq: 440, gain: 0.1, decay: 0.25, type: 'triangle' });
    }
  },
  // 선택: 아주 작은 클릭음
  click() {
    const c = audio();
    if (!c) return;
    tone(c, { freq: 1600, gain: 0.05, decay: 0.03 });
  },
};
