"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { StatCard } from "./StatCard";
import type { StatsSummary } from "./stats-types";

/**
 * The one stat card that needs the browser's real timezone.
 *
 * `internal_date` is stored UTC, so the server-rendered page (no access to
 * the browser's timezone) computes stats_summary() with UTC as the default —
 * correct data, wrong-feeling hour ("your peak hour is 11pm" when it's
 * really 6pm local). Starts from the server's UTC-based answer (still a
 * real, valid number) and quietly swaps to the timezone-correct one once the
 * client re-fetch resolves, via normal React state rather than reaching into
 * the DOM.
 */
export function PeakHourCard({
  initialHour,
  initialCount,
}: {
  initialHour: number | null;
  initialCount: number | null;
}) {
  const [hour, setHour] = useState(initialHour);
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz || tz === "UTC") return;

    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .rpc("stats_summary", { p_tz: tz })
        .maybeSingle();
      if (cancelled || error || !data) return;

      const row = data as StatsSummary;
      setHour(row.peak_send_hour);
      setCount(row.peak_send_hour_count);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <StatCard
      accent="avatar-sand"
      icon="🌙"
      label="Peak sending hour"
      value={hour !== null ? formatHour(hour) : null}
      detail={count ? `${count.toLocaleString()} messages sent then` : null}
      empty="Not enough sent mail yet"
    />
  );
}

function formatHour(hour: number): string {
  if (hour === 0) return "midnight";
  if (hour === 12) return "noon";
  const period = hour < 12 ? "am" : "pm";
  const twelveHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelveHour}${period}`;
}
