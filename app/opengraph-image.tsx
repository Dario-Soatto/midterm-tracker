import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Midterms 2026 — live prediction-market odds";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Pull a TTF for the given Google Font + weight. Satori (the engine behind
 * ImageResponse) only understands TTF/OTF — not woff2 — so we coax the
 * Google Fonts CSS endpoint into serving TTF by spoofing an older UA.
 */
async function loadGoogleFont(
  family: string,
  weight: number,
): Promise<ArrayBuffer> {
  const css = await fetch(
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
      family,
    )}:wght@${weight}&display=swap`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_0) AppleWebKit/537.36",
      },
    },
  ).then((r) => r.text());
  const match = css.match(
    /src:\s*url\(([^)]+)\)\s*format\(['"]truetype['"]\)/,
  );
  if (!match) throw new Error(`No TTF for ${family} @ ${weight}`);
  return fetch(match[1]).then((r) => r.arrayBuffer());
}

export default async function Image() {
  const [serif, mono] = await Promise.all([
    loadGoogleFont("Newsreader", 500),
    loadGoogleFont("JetBrains Mono", 500),
  ]);

  // Mirror the site palette from globals.css.
  const paper = "#f1ece1";
  const ink = "#1a1a1a";
  const inkSoft = "#4a4a47";
  const inkMute = "#8a8a85";
  const rule = "#d6cfbe";
  const dem = "#2c4a6e";
  const rep = "#a0392c";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: paper,
          color: ink,
          display: "flex",
          flexDirection: "column",
          padding: "56px 80px",
          fontFamily: "JetBrainsMono",
        }}
      >
        {/* top rule */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 20,
            letterSpacing: 3,
            textTransform: "uppercase",
            color: inkMute,
            borderBottom: `1px solid ${rule}`,
            paddingBottom: 20,
          }}
        >
          <span>midterms · 2026</span>
          <span>kalshi · 119th cong.</span>
        </div>

        {/* body */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            flex: 1,
            gap: 28,
            paddingTop: 24,
          }}
        >
          <div
            style={{
              display: "flex",
              fontFamily: "Newsreader",
              fontSize: 132,
              lineHeight: 1,
              letterSpacing: -3,
              color: ink,
            }}
          >
            U.S. midterms
            <span style={{ color: inkMute }}>&nbsp;·&nbsp;2026</span>
          </div>

          <div
            style={{
              display: "flex",
              fontFamily: "Newsreader",
              fontSize: 34,
              lineHeight: 1.3,
              color: inkSoft,
              maxWidth: 980,
            }}
          >
            Live prediction-market odds for every U.S. House district and
            Senate race — priced from Kalshi, aggregated into a
            seat-distribution forecast.
          </div>

          {/* split bar visual */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 18,
              marginTop: 12,
              fontSize: 22,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: ink,
            }}
          >
            <span style={{ color: dem, width: 36 }}>D</span>
            <div
              style={{
                flex: 1,
                height: 40,
                display: "flex",
                border: `1px solid ${rule}`,
                position: "relative",
              }}
            >
              <div style={{ width: "50%", height: "100%", background: dem }} />
              <div style={{ width: "50%", height: "100%", background: rep }} />
              {/* majority threshold line — extends past top + bottom */}
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: -10,
                  bottom: -10,
                  width: 2,
                  background: ink,
                  transform: "translateX(-1px)",
                }}
              />
            </div>
            <span style={{ color: rep, width: 36, textAlign: "right" }}>R</span>
          </div>
        </div>

        {/* bottom rule */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 17,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: inkMute,
            borderTop: `1px solid ${rule}`,
            paddingTop: 18,
          }}
        >
          <span>midterm-tracker.vercel.app</span>
          <span>source: kalshi prediction markets</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Newsreader", data: serif, style: "normal", weight: 500 },
        { name: "JetBrainsMono", data: mono, style: "normal", weight: 500 },
      ],
    },
  );
}
