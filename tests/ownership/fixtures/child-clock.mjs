// Only explicit fixture child-process --import arguments install this clock.
// Calendar time advances with elapsed monotonic time; timers remain real.
export function installChildClock(epochMs, clockGlobal = globalThis, monotonicNow = () => performance.now()) {
  const NativeDate = clockGlobal.Date;
  const started = monotonicNow();
  const now = () => epochMs + Math.floor(monotonicNow() - started);
  clockGlobal.Date = new Proxy(NativeDate, {
    apply() { return new NativeDate(now()).toString(); },
    construct(target, args, newTarget) {
      return Reflect.construct(target, args.length ? args : [now()], newTarget);
    },
    get(target, property, receiver) {
      return property === 'now' ? now : Reflect.get(target, property, receiver);
    },
  });
}

export function childClockArguments(epochMs) {
  if (epochMs === undefined) return [];
  const source = `(${installChildClock.toString()})(${JSON.stringify(epochMs)});`;
  return ['--import', `data:text/javascript,${encodeURIComponent(source)}`];
}
