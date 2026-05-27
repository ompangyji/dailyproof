import { createClient } from "@/lib/supabase/server";

type Day = { d: string; c: number };
type Grass = { name: string; days: Day[] };

const CELL = 11;
const GAP = 3;
const STEP = CELL + GAP; // 14
const LEFT = 28; // weekday label gutter
const TITLE_H = 30; // name + total
const MONTH_H = 14; // month label row
const LEGEND_H = 22;
const LEVEL_COLORS = ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function level(c: number): number {
  if (c <= 0) return 0;
  if (c === 1) return 1;
  if (c <= 3) return 2;
  if (c <= 5) return 3;
  return 4;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function svgResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // Public aggregate; a few minutes stale is fine and helps load speed.
      "Cache-Control": "public, max-age=600, s-maxage=600, stale-while-revalidate=86400",
    },
  });
}

function placeholder(message: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80" viewBox="0 0 320 80" role="img">
  <rect width="320" height="80" rx="8" fill="#fafaf2" stroke="#0a0a0a" stroke-width="2"/>
  <text x="160" y="44" text-anchor="middle" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="13" font-weight="700" fill="#0a0a0a">${esc(message)}</text>
</svg>`;
}

function buildSvg(data: Grass): string {
  const days = data.days;
  if (days.length === 0) return placeholder("No activity yet");

  const total = days.reduce((s, x) => s + (x.c || 0), 0);
  const firstWeekday = new Date(`${days[0].d}T00:00:00Z`).getUTCDay(); // 0=Sun
  const weeks = Math.floor((days.length - 1 + firstWeekday) / 7) + 1;

  const gridX = LEFT;
  const gridY = TITLE_H + MONTH_H;
  const width = gridX + weeks * STEP + 6;
  const height = gridY + 7 * STEP + LEGEND_H;

  const cells: string[] = [];
  const monthLabels: string[] = [];
  let lastMonth = -1;

  days.forEach((day, i) => {
    const slot = i + firstWeekday;
    const col = Math.floor(slot / 7);
    const row = slot % 7;
    const x = gridX + col * STEP;
    const y = gridY + row * STEP;
    const color = LEVEL_COLORS[level(day.c || 0)];
    cells.push(
      `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${color}"><title>${day.d}: ${day.c}</title></rect>`,
    );
    // Month label when the month changes, anchored at the column's top.
    const m = new Date(`${day.d}T00:00:00Z`).getUTCMonth();
    if (row === 0 && m !== lastMonth) {
      lastMonth = m;
      monthLabels.push(
        `<text x="${x}" y="${gridY - 4}" font-size="10" fill="#57606a">${MONTHS[m]}</text>`,
      );
    } else if (i === 0) {
      lastMonth = m;
    }
  });

  const weekdayLabels = [
    `<text x="0" y="${gridY + 1 * STEP + CELL - 2}" font-size="9" fill="#57606a">Mon</text>`,
    `<text x="0" y="${gridY + 3 * STEP + CELL - 2}" font-size="9" fill="#57606a">Wed</text>`,
    `<text x="0" y="${gridY + 5 * STEP + CELL - 2}" font-size="9" fill="#57606a">Fri</text>`,
  ].join("");

  const legendX = width - 6 - 5 * (CELL + 2) - 30;
  const legendY = gridY + 7 * STEP + 12;
  const legend =
    `<text x="${legendX - 4}" y="${legendY + CELL - 2}" text-anchor="end" font-size="9" fill="#57606a">Less</text>` +
    LEVEL_COLORS.map(
      (c, i) =>
        `<rect x="${legendX + i * (CELL + 2)}" y="${legendY}" width="${CELL}" height="${CELL}" rx="2" fill="${c}"/>`,
    ).join("") +
    `<text x="${legendX + 5 * (CELL + 2) + 4}" y="${legendY + CELL - 2}" font-size="9" fill="#57606a">More</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(data.name)} activity graph">
  <style>text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}</style>
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="${gridX}" y="18" font-size="14" font-weight="700" fill="#0a0a0a">${esc(data.name)}</text>
  <text x="${width - 6}" y="18" text-anchor="end" font-size="11" fill="#57606a">${total} in the last year</text>
  ${monthLabels.join("")}
  ${weekdayLabels}
  ${cells.join("")}
  ${legend}
</svg>`;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!/^[a-f0-9]{8,64}$/.test(token)) {
    return svgResponse(placeholder("Graph unavailable"), 404);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_grass", { p_token: token });
  if (error || !data) {
    return svgResponse(placeholder("Graph unavailable"), 404);
  }

  return svgResponse(buildSvg(data as Grass));
}
