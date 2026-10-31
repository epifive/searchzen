/** Smooth SVG paths (line + filled area) for the landing page charts. */
export function areaPaths(values: number[], width: number, height: number, pad = 6) {
  const count = Math.max(values.length, 2);
  const max = Math.max(1, ...values);
  const points: Array<[number, number]> = (values.length ? values : [0, 0]).map((v, i) => [
    (i / (count - 1)) * width,
    height - pad - (Math.max(0, v) / max) * (height - pad * 2),
  ]);
  if (points.length === 1) points.push([width, points[0][1]]);

  // Catmull-Rom → cubic Bézier, clamped so the curve never dips below the baseline.
  let line = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = Math.min(height, p1[1] + (p2[1] - p0[1]) / 6);
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = Math.min(height, p2[1] - (p3[1] - p1[1]) / 6);
    line += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const peakIndex = values.length ? values.indexOf(max) : 0;
  return { line, area, points, peak: points[peakIndex], last: points[points.length - 1] };
}

/** Deterministic, natural-looking daily series for illustrations (no Math.random: same HTML on every render). */
export function exampleSeries(length: number, base: number, seed = 1): number[] {
  return Array.from({ length }, (_, i) => {
    const weekly = (i + seed) % 7 === 5 || (i + seed) % 7 === 6 ? 0.78 : 1;
    const trend = 1 + i / (length * 2.4);
    const wave = 1 + 0.09 * Math.sin(i / 2.3 + seed) + 0.05 * Math.sin(i * 1.7 + seed * 2);
    const bump = i === Math.round(length * 0.62) ? 1.32 : 1;
    return Math.round(base * weekly * trend * wave * bump);
  });
}
