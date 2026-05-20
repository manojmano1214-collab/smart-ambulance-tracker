const mongoose = require('mongoose');

const RouteSchema = new mongoose.Schema({
  ambulanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  hospitalName: String,
  routeGeometry: [[Number]],
  start: { lat: Number, lng: Number },
  destination: { lat: Number, lng: Number },
  createdAt: { type: Date, default: Date.now, expires: 600 }
});

module.exports = mongoose.model('AmbulanceRoute', RouteSchema);