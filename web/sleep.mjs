// What sleep's window asks of the page that Dream cannot say as a tree:
// a stylesheet of the person's own, replaced as they edit it, and the
// bell's sound. Everything else is the program's, in Dream.
export function setup(dream) {
  const sheet = document.createElement('style');
  sheet.id = 'sleep-custom-css';
  document.head.append(sheet);
  // The person's own CSS, from Settings. It is theirs, typed into their own
  // window, so it may use anything CSS has -- which is the point of it.
  dream.handle('custom_css', ({ css }) => { sheet.textContent = String(css ?? ''); return null; });

  let audio = null;
  dream.handle('beep', () => {
    try {
      audio ??= new AudioContext();
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, audio.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.18);
      osc.connect(gain).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + 0.2);
    } catch { /* no audio: the animation is the bell */ }
    return null;
  });
}
