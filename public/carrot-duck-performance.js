(function (root) {
  'use strict';
  // One owner for preparation, playback and cancellation. No autonomous timers survive a stop.
  function create({ prepare, perform, release, report, duration, later = setTimeout, cancel = clearTimeout }) {
    let active = null, timer = null;
    function finish(status = 'cancelled') {
      if (!active) return;
      const previous = active; active = null; cancel(timer); timer = null;
      release(); report(previous.id, status);
    }
    function start(id) {
      if (!active || active.id !== id || active.started) return;
      active.started = true; cancel(timer); timer = null;
      if (perform(active.plan) === false) { finish('failed'); return; }
      report(id, 'started');
      if (!active.voiced) timer = later(() => finish('completed'), duration(active.plan.action) + 350);
    }
    function begin(id, plan, voiced = false) {
      finish('cancelled');
      if (typeof id !== 'string' || !plan || plan.version !== 1) return false;
      active = { id, plan, voiced, started: false };
      prepare(plan); report(id, 'preparing');
      if (!voiced) timer = later(() => start(id), Math.max(0, Math.min(500, Number(plan.preparation_ms) || 0)));
      return true;
    }
    return { begin, start, finish, owns: id => active?.id === id };
  }
  root.CarrotDuckPerformance = { create };
  if (typeof module !== 'undefined') module.exports = root.CarrotDuckPerformance;
})(typeof globalThis !== 'undefined' ? globalThis : this);
