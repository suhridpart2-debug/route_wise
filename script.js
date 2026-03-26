// ── MAP INITIALIZATION ─────────────────────────────────────
const map = L.map('map', {center: [20.5937, 78.9629], zoom: 5});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

// ── STATE ──────────────────────────────────────────────────
let srcLL = null, dstLL = null, srcMk = null, dstMk = null, routeLine = null, clickStep = 1;

// ── ICONS ──────────────────────────────────────────────────
function mkIcon(type) {
  const bg = type === 'src' ? '#2563eb' : '#0891b2';
  const lbl = type === 'src' ? 'S' : 'D';
  return L.divIcon({
    html: `<div style="width:28px;height:28px;background:${bg};border:3px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;">${lbl}</div>`,
    iconSize: [28, 28], iconAnchor: [14, 14], className: ''
  });
}

// ── GEOMETRY & TRAFFIC ─────────────────────────────────────
function haversine(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  return R * 2 * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2));
}

function trafficInfo(d) {
  if (d < 50) return {label: 'Low', cls: 'badge-low', color: '#16a34a'};
  if (d < 300) return {label: 'Moderate', cls: 'badge-mod', color: '#d97706'};
  return {label: 'High', cls: 'badge-high', color: '#dc2626'};
}

// ── FORD-FULKERSON ALGORITHM ──────────────────────────────
function buildGraph(d) {
  const s = Math.max(2, Math.round(360 / d));
  const caps = {SA: s * 3, SB: s * 2, AT: Math.round(s * 2.5), BT: s * 4, AB: s};
  const C = Array.from({length: 4}, () => Array(4).fill(0));
  C[0][1] = caps.SA; C[0][2] = caps.SB; C[1][3] = caps.AT; C[2][3] = caps.BT; C[1][2] = caps.AB;
  const F = Array.from({length: 4}, () => Array(4).fill(0));

  function bfs(s, t, par) {
    const vis = new Array(4).fill(false); vis[s] = true; const q = [s];
    while (q.length) {
      const u = q.shift();
      for (let v = 0; v < 4; v++) if (!vis[v] && C[u][v] - F[u][v] > 0) {
        vis[v] = true; par[v] = u; if (v === t) return true; q.push(v);
      }
    } return false;
  }

  let maxFlow = 0; const par = new Array(4);
  while (bfs(0, 3, par)) {
    let pf = Infinity;
    for (let v = 3; v !== 0; ) { const u = par[v]; pf = Math.min(pf, C[u][v] - F[u][v]); v = u; }
    for (let v = 3; v !== 0; ) { const u = par[v]; F[u][v] += pf; F[v][u] -= pf; v = u; }
    maxFlow += pf;
  }

  const vis2 = new Array(4).fill(false); const q2 = [0]; vis2[0] = true;
  while (q2.length) { const u = q2.shift(); for (let v = 0; v < 4; v++) if (!vis2[v] && C[u][v] - F[u][v] > 0) { vis2[v] = true; q2.push(v); } }
  
  const allEdges = [
    {u: 0, v: 1, key: 'SA', name: 'S → A', cap: caps.SA, flow: F[0][1]},
    {u: 0, v: 2, key: 'SB', name: 'S → B', cap: caps.SB, flow: F[0][2]},
    {u: 1, v: 3, key: 'AT', name: 'A → T', cap: caps.AT, flow: F[1][3]},
    {u: 2, v: 3, key: 'BT', name: 'B → T', cap: caps.BT, flow: F[2][3]},
    {u: 1, v: 2, key: 'AB', name: 'A → B', cap: caps.AB, flow: Math.max(0, F[1][2])},
  ];

  const cutEdges = allEdges.filter(e => vis2[e.u] && !vis2[e.v]);
  const bottleneck = cutEdges.length ? cutEdges.reduce((a, b) => a.cap < b.cap ? a : b, cutEdges[0]) : allEdges[0];
  const flowSAT = Math.min(F[0][1], F[1][3]);
  const flowSBT = Math.min(F[0][2], F[2][3]);
  const totalCap = caps.SA + caps.SB;
  const eff = Math.round((maxFlow / totalCap) * 100);

  return {maxFlow, bottleneck, allEdges, caps, eff, flowSAT, flowSBT};
}

// ── SVG GRAPH RENDERING ───────────────────────────────────
function drawGraph(g) {
  const svg = document.getElementById('graph-svg');
  svg.innerHTML = '';
  const ns = 'http://www.w3.org/2000/svg';
  const mk = (tag, a, txt) => {
    const el = document.createElementNS(ns, tag);
    Object.entries(a).forEach(([k, v]) => el.setAttribute(k, v));
    if (txt !== undefined) el.textContent = txt;
    return el;
  };

  const defs = mk('defs', {});
  const mkArrow = (id, fill) => {
    const m = mk('marker', {id, markerWidth: 8, markerHeight: 6, refX: 7, refY: 3, orient: 'auto'});
    m.appendChild(mk('path', {d: 'M0,0 L8,3 L0,6 Z', fill}));
    defs.appendChild(m);
  };
  mkArrow('arr-normal', '#b0bec5'); mkArrow('arr-red', '#dc2626');
  svg.appendChild(defs);

  const nodes = { S: {x: 70, y: 120}, A: {x: 290, y: 58}, B: {x: 290, y: 182}, T: {x: 620, y: 120} };
  const nc = { S: '#2563eb', A: '#7c3aed', B: '#0891b2', T: '#059669' };

  g.allEdges.forEach(e => {
    const f = nodes[e.name.split(' → ')[0]], t = nodes[e.name.split(' → ')[1]];
    const isBot = g.bottleneck && e.key === g.bottleneck.key;
    const s = {x: f.x + (26 * (t.x - f.x) / Math.hypot(t.x - f.x, t.y - f.y)), y: f.y + (26 * (t.y - f.y) / Math.hypot(t.x - f.x, t.y - f.y))};
    const en = {x: t.x - (28 * (t.x - f.x) / Math.hypot(t.x - f.x, t.y - f.y)), y: t.y - (28 * (t.y - f.y) / Math.hypot(t.x - f.x, t.y - f.y))};

    svg.appendChild(mk('line', {
      x1: s.x, y1: s.y, x2: en.x, y2: en.y,
      stroke: isBot ? '#dc2626' : '#b0c4de', 'stroke-width': isBot ? 2.5 : 2,
      'marker-end': `url(#${isBot ? 'arr-red' : 'arr-normal'})`
    }));

    const mx = (s.x + en.x) / 2, my = (s.y + en.y) / 2 - 10;
    svg.appendChild(mk('text', {x: mx, y: my, 'text-anchor': 'middle', 'font-size': '10', fill: isBot ? '#dc2626' : '#64748b'}, `${e.flow}/${e.cap}`));
  });

  Object.entries(nodes).forEach(([key, n]) => {
    svg.appendChild(mk('circle', {cx: n.x, cy: n.y, r: 24, fill: '#fff', stroke: nc[key], 'stroke-width': 2}));
    svg.appendChild(mk('text', {x: n.x, y: n.y + 5, 'text-anchor': 'middle', 'font-weight': '700', fill: nc[key]}, key));
  });
}

// ── EVENT HANDLERS ────────────────────────────────────────
map.on('click', (e) => {
  if (clickStep === 1) {
    srcLL = e.latlng;
    srcMk = L.marker(srcLL, {icon: mkIcon('src')}).addTo(map);
    document.getElementById('status-msg').textContent = 'Source set — set Destination';
    document.getElementById('sn1').classList.add('done');
    clickStep = 2;
  } else if (clickStep === 2) {
    dstLL = e.latlng;
    dstMk = L.marker(dstLL, {icon: mkIcon('dst')}).addTo(map);
    const d = haversine(srcLL, dstLL);
    routeLine = L.polyline([srcLL, dstLL], {color: '#2563eb', dashArray: '10 6'}).addTo(map);
    document.getElementById('pnl-dist').textContent = d.toFixed(1) + ' km';
    document.getElementById('panel-route').style.display = 'block';
    document.getElementById('btn-analyze').disabled = false;
    document.getElementById('sn2').classList.add('done');
    clickStep = 3;
  }
});

document.getElementById('btn-analyze').addEventListener('click', () => {
  const g = buildGraph(haversine(srcLL, dstLL));
  document.getElementById('m-maxflow').textContent = g.maxFlow;
  document.getElementById('m-bottleneck').textContent = g.bottleneck.name;
  document.getElementById('m-eff').textContent = g.eff + '%';
  drawGraph(g);
  document.getElementById('modal-overlay').classList.add('open');
});

document.getElementById('btn-reset').addEventListener('click', () => location.reload());
document.getElementById('modal-close').addEventListener('click', () => document.getElementById('modal-overlay').classList.remove('open'));