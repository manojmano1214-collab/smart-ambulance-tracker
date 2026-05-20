const express = require('express');
const AmbulanceRoute = require('../models/AmbulanceRoute');
const auth = require('../middleware/auth');
const router = express.Router();

function getDistance(p1, p2) {
  const R = 6371e3;
  const φ1 = p1.lat * Math.PI/180;
  const φ2 = p2.lat * Math.PI/180;
  const Δφ = (p2.lat-p1.lat) * Math.PI/180;
  const Δλ = (p2.lng-p1.lng) * Math.PI/180;
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function distanceToSegment(point, a, b) {
  const p = { lat: point.lat, lng: point.lng };
  const abx = b.lng - a.lng;
  const aby = b.lat - a.lat;
  const t = ((p.lng - a.lng) * abx + (p.lat - a.lat) * aby) / (abx*abx + aby*aby);
  if (t <= 0) return getDistance(p, a);
  if (t >= 1) return getDistance(p, b);
  const proj = { lat: a.lat + t*aby, lng: a.lng + t*abx };
  return getDistance(p, proj);
}

router.post('/check-alerts', auth, async (req, res) => {
  if (req.user.role !== 'police') return res.status(403).json({ msg: 'Access denied' });
  const { lat, lng } = req.body;
  if (!lat || !lng) return res.status(400).json({ msg: 'Location required' });
  const routes = await AmbulanceRoute.find();
  const alerts = [];
  const THRESHOLD = 70;
  for (const route of routes) {
    const geometry = route.routeGeometry;
    if (!geometry || geometry.length < 2) continue;
    let minDistance = Infinity;
    for (let i = 0; i < geometry.length - 1; i++) {
      const p1 = { lat: geometry[i][0], lng: geometry[i][1] };
      const p2 = { lat: geometry[i+1][0], lng: geometry[i+1][1] };
      const dist = distanceToSegment({ lat, lng }, p1, p2);
      if (dist < minDistance) minDistance = dist;
    }
    if (minDistance < THRESHOLD) {
      alerts.push({
        ambulanceId: route.ambulanceId,
        hospitalName: route.hospitalName,
        distance: Math.round(minDistance)
      });
    }
  }
  res.json({ alerts });
});

module.exports = router;