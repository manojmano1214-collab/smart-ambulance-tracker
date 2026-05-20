const express = require('express');
const axios = require('axios');
const AmbulanceRoute = require('../models/AmbulanceRoute');
const auth = require('../middleware/auth');
const router = express.Router();

function decodePolyline(encoded, precision = 5) {
  const factor = Math.pow(10, precision);
  let index = 0, lat = 0, lng = 0, coordinates = [];
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;
    coordinates.push([lat / factor, lng / factor]);
  }
  return coordinates;
}

router.post('/route', auth, async (req, res) => {
  if (req.user.role !== 'ambulance') return res.status(403).json({ msg: 'Access denied' });
  const { startLat, startLng, endLat, endLng, hospitalName } = req.body;
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=polyline`;
    const response = await axios.get(url);
    if (!response.data.routes.length) throw new Error('No route');
    const polylineEnc = response.data.routes[0].geometry;
    const routeCoords = decodePolyline(polylineEnc);
    await AmbulanceRoute.deleteMany({ ambulanceId: req.user.id });
    const newRoute = new AmbulanceRoute({
      ambulanceId: req.user.id,
      hospitalName,
      routeGeometry: routeCoords,
      start: { lat: startLat, lng: startLng },
      destination: { lat: endLat, lng: endLng }
    });
    await newRoute.save();
    res.json({ msg: 'Route saved', route: routeCoords });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.delete('/route', auth, async (req, res) => {
  if (req.user.role !== 'ambulance') return res.status(403).json({ msg: 'Access denied' });
  await AmbulanceRoute.deleteMany({ ambulanceId: req.user.id });
  res.json({ msg: 'Route cleared' });
});

module.exports = router;