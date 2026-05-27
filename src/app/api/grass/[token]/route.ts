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
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type RGB = [number, number, number];

const THEMES: Record<
  "light" | "dark",
  { bg: string; text: string; sub: string; empty: string; levels: string[] }
> = {
  light: {
    bg: "#ffffff",
    text: "#0a0a0a",
    sub: "#57606a",
    empty: "#ebedf0",
    levels: ["#9be9a8", "#40c463", "#30a14e", "#216e39"],
  },
  dark: {
    bg: "#0d1117",
    text: "#e6edf3",
    sub: "#7d8590",
    empty: "#161b22",
    levels: ["#0e4429", "#006d32", "#26a641", "#39d353"],
  },
};

type Options = {
  theme: "light" | "dark";
  bg?: string;
  color?: RGB;
  radius: number;
  hideTitle: boolean;
  hideLegend: boolean;
};

function parseHex(h: string | null): RGB | null {
  if (!h) return null;
  const v = h.replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(v)) return null;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
function toHex(rgb: RGB): string {
  return (
    "#" +
    rgb
      .map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0"))
      .join("")
  );
}
function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function palette(opts: Options): { bg: string; text: string; sub: string; colors: string[] } {
  const base = THEMES[opts.theme];
  const bg = opts.bg ?? base.bg;
  let levels = base.levels;
  if (opts.color) {
    const bgRgb = parseHex(bg) ?? [255, 255, 255];
    levels = [0.3, 0.55, 0.8, 1].map((t) => toHex(mix(bgRgb, opts.color as RGB, t)));
  }
  return { bg, text: base.text, sub: base.sub, colors: [base.empty, ...levels] };
}

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

function buildSvg(data: Grass, opts: Options): string {
  const days = data.days;
  if (days.length === 0) return placeholder("No activity yet");

  const pal = palette(opts);
  const rx = opts.radius;
  const total = days.reduce((s, x) => s + (x.c || 0), 0);
  const firstWeekday = new Date(`${days[0].d}T00:00:00Z`).getUTCDay();
  const weeks = Math.floor((days.length - 1 + firstWeekday) / 7) + 1;

  const titleH = opts.hideTitle ? 6 : TITLE_H;
  const legendH = opts.hideLegend ? 6 : LEGEND_H;
  const gridX = LEFT;
  const gridY = titleH + MONTH_H;
  const width = gridX + weeks * STEP + 6;
  const height = gridY + 7 * STEP + legendH;

  const cells: string[] = [];
  const monthLabels: string[] = [];
  let lastMonth = -1;

  days.forEach((day, i) => {
    const slot = i + firstWeekday;
    const col = Math.floor(slot / 7);
    const row = slot % 7;
    const x = gridX + col * STEP;
    const y = gridY + row * STEP;
    cells.push(
      `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="${rx}" fill="${pal.colors[level(day.c || 0)]}"><title>${day.d}: ${day.c}</title></rect>`,
    );
    const m = new Date(`${day.d}T00:00:00Z`).getUTCMonth();
    if (row === 0 && m !== lastMonth) {
      lastMonth = m;
      monthLabels.push(
        `<text x="${x}" y="${gridY - 4}" font-size="10" fill="${pal.sub}">${MONTHS[m]}</text>`,
      );
    } else if (i === 0) {
      lastMonth = m;
    }
  });

  const weekdayLabels = [1, 3, 5]
    .map(
      (r, idx) =>
        `<text x="0" y="${gridY + r * STEP + CELL - 2}" font-size="9" fill="${pal.sub}">${["Mon", "Wed", "Fri"][idx]}</text>`,
    )
    .join("");

  const title = opts.hideTitle
    ? ""
    : `<text x="${gridX}" y="18" font-size="14" font-weight="700" fill="${pal.text}">${esc(data.name)}</text>` +
      `<text x="${width - 6}" y="18" text-anchor="end" font-size="11" fill="${pal.sub}">${total} in the last year</text>`;

  let legend = "";
  if (!opts.hideLegend) {
    const legendX = width - 6 - 5 * (CELL + 2) - 30;
    const legendY = gridY + 7 * STEP + 12;
    legend =
      `<text x="${legendX - 4}" y="${legendY + CELL - 2}" text-anchor="end" font-size="9" fill="${pal.sub}">Less</text>` +
      pal.colors
        .map(
          (c, i) =>
            `<rect x="${legendX + i * (CELL + 2)}" y="${legendY}" width="${CELL}" height="${CELL}" rx="${rx}" fill="${c}"/>`,
        )
        .join("") +
      `<text x="${legendX + 5 * (CELL + 2) + 4}" y="${legendY + CELL - 2}" font-size="9" fill="${pal.sub}">More</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(data.name)} activity graph">
  <style>text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}</style>
  <rect width="${width}" height="${height}" fill="${pal.bg}"/>
  ${title}
  ${monthLabels.join("")}
  ${weekdayLabels}
  ${cells.join("")}
  ${legend}
</svg>`;
}

function truthy(v: string | null): boolean {
  return v === "1" || v === "true" || v === "yes";
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const { searchParams } = new URL(req.url);
  const wantsJson = searchParams.get("format") === "json";

  if (!/^[a-f0-9]{8,64}$/.test(token)) {
    return wantsJson
      ? Response.json({ error: "not_found" }, { status: 404, headers: { "Access-Control-Allow-Origin": "*" } })
      : svgResponse(placeholder("Graph unavailable"), 404);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_grass", { p_token: token });
  if (error || !data) {
    return wantsJson
      ? Response.json({ error: "not_found" }, { status: 404, headers: { "Access-Control-Allow-Origin": "*" } })
      : svgResponse(placeholder("Graph unavailable"), 404);
  }

  const grass = data as Grass;

  if (wantsJson) {
    return Response.json(
      { name: grass.name, days: grass.days.map((d) => ({ date: d.d, count: d.c })) },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=600, s-maxage=600, stale-while-revalidate=86400",
        },
      },
    );
  }

  const radiusRaw = parseInt(searchParams.get("radius") ?? "", 10);
  const opts: Options = {
    theme: searchParams.get("theme") === "dark" ? "dark" : "light",
    bg: parseHex(searchParams.get("bg")) ? `#${searchParams.get("bg")!.replace(/^#/, "")}` : undefined,
    color: parseHex(searchParams.get("color")) ?? undefined,
    radius: Number.isFinite(radiusRaw) ? Math.max(0, Math.min(6, radiusRaw)) : 2,
    hideTitle: truthy(searchParams.get("hideTitle")),
    hideLegend: truthy(searchParams.get("hideLegend")),
  };

  return svgResponse(buildSvg(grass, opts));
}
