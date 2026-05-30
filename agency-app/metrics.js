// Normalizes a raw Retell call object (or our mock) into the shape the
// dashboard cares about, and computes the ROI metrics a med-spa owner wants.
//
// "Bookings" relies on Retell post-call analysis: configure your agent's
// post-call analysis with a boolean field `appointment_booked`. We read it
// from call_analysis.custom_analysis_data.appointment_booked.

function startMs(call) {
  return call.start_timestamp || (call.startTime ? Date.parse(call.startTime) : Date.now());
}

function isAfterHours(call, tz = 'America/New_York') {
  // Business hours assumed 9:00–18:00 local, Mon–Sat. Outside that = a save
  // a human front desk would likely have missed.
  const d = new Date(startMs(call));
  let hour, day;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', hour12: false, weekday: 'short',
    }).formatToParts(d);
    hour = Number(parts.find((p) => p.type === 'hour').value);
    day = parts.find((p) => p.type === 'weekday').value;
  } catch {
    hour = d.getHours(); day = 'Mon';
  }
  const isSunday = day === 'Sun';
  return isSunday || hour < 9 || hour >= 18;
}

function booked(call) {
  return Boolean(call?.call_analysis?.custom_analysis_data?.appointment_booked);
}

export function computeMetrics(calls, client = {}) {
  const avgJobValue = client.avgJobValue ?? 400;
  const tz = client.tz ?? 'America/New_York';

  const handled = calls.length;
  const afterHours = calls.filter((c) => isAfterHours(c, tz)).length;
  const bookings = calls.filter(booked).length;
  const revenueRecovered = bookings * avgJobValue;

  // Total talk time (seconds) -> minutes, for a "staff time saved" angle.
  const talkSeconds = calls.reduce((s, c) => {
    const dur = c.duration_ms ? c.duration_ms / 1000
      : (c.end_timestamp && c.start_timestamp ? (c.end_timestamp - c.start_timestamp) / 1000 : 0);
    return s + dur;
  }, 0);

  return {
    handled,
    afterHours,
    bookings,
    revenueRecovered,
    bookingRate: handled ? Math.round((bookings / handled) * 100) : 0,
    minutesHandled: Math.round(talkSeconds / 60),
    avgJobValue,
  };
}

export function toRow(call, tz = 'America/New_York') {
  return {
    call_id: call.call_id,
    when: startMs(call),
    afterHours: isAfterHours(call, tz),
    booked: booked(call),
    from: call.from_number || call.from || '—',
    summary: call?.call_analysis?.call_summary || call.summary || '',
    sentiment: call?.call_analysis?.user_sentiment || '',
  };
}
