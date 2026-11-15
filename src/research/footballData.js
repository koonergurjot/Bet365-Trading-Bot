// Loader for football-data.co.uk CSVs (free historical results + bookmaker odds).
// Columns used: B365H/D/A (Bet365, pre-close), PSH/D/A (Pinnacle, pre-close),
// AvgH/D/A, PSCH/D/A + B365CH/D/A (closing), FTR (result).
import fs from 'node:fs';
import path from 'node:path';

function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 1 ? n : null; };
const duo = (r, a, b) => { const t = [num(r[a]), num(r[b])]; return t.every(Boolean) ? t : null; };
const trio = (r, a, b, c) => { const t = [num(r[a]), num(r[b]), num(r[c])]; return t.every(Boolean) ? t : null; };

function parseDate(d) {
  const [dd, mm, yy] = d.split('/');
  const year = yy.length === 2 ? (Number(yy) > 50 ? 1900 : 2000) + Number(yy) : Number(yy);
  return new Date(Date.UTC(year, Number(mm) - 1, Number(dd)));
}

export function loadFootballData(dir) {
  const matches = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.csv')).sort()) {
    const [league, season] = file.replace('.csv', '').split('_');
    const text = fs.readFileSync(path.join(dir, file), 'utf8').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2 || !lines[0].startsWith('Div')) continue;
    const head = parseCsvLine(lines[0]);
    for (const line of lines.slice(1)) {
      const cells = parseCsvLine(line);
      const r = Object.fromEntries(head.map((h, i) => [h, cells[i]]));
      if (!r.Date || !['H', 'D', 'A'].includes(r.FTR)) continue;
      matches.push({
        league, season, date: parseDate(r.Date),
        home: r.HomeTeam, away: r.AwayTeam, result: r.FTR,
        hg: Number(r.FTHG), ag: Number(r.FTAG),
        b365: trio(r, 'B365H', 'B365D', 'B365A'),
        pin: trio(r, 'PSH', 'PSD', 'PSA'),
        avg: trio(r, 'AvgH', 'AvgD', 'AvgA'),
        max: trio(r, 'MaxH', 'MaxD', 'MaxA'),
        pinClose: trio(r, 'PSCH', 'PSCD', 'PSCA'),
        b365Close: trio(r, 'B365CH', 'B365CD', 'B365CA'),
        bfe: trio(r, 'BFEH', 'BFED', 'BFEA'), bfeClose: trio(r, 'BFECH', 'BFECD', 'BFECA'), bw: trio(r, 'BWH', 'BWD', 'BWA'),
        ouB365: duo(r, 'B365>2.5', 'B365<2.5'), ouPin: duo(r, 'P>2.5', 'P<2.5'), ouAvg: duo(r, 'Avg>2.5', 'Avg<2.5'), ouPinClose: duo(r, 'PC>2.5', 'PC<2.5'),
      });
    }
  }
  return matches.sort((a, b) => a.date - b.date);
}
