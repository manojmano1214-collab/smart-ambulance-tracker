require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

// ============ IN-MEMORY STORAGE ============
const users = [];
const activeAmbulance = {
  isActive: false,
  location: null,
  route: null,
  destination: null,
  timestamp: null
};

let nextId = 1;

// ============ TEST ROUTE ============
app.get('/api/test', (req, res) => {
  res.json({ msg: 'Server is working!' });
});

// ============ AUTH ROUTES ============
app.post('/api/auth/register', async (req, res) => {
  const { email, password, role } = req.body;
  
  console.log('Register attempt:', { email, role });
  
  if (!email || !password || !role) {
    return res.status(400).json({ msg: 'All fields required' });
  }
  
  const existing = users.find(u => u.email === email);
  if (existing) {
    return res.status(400).json({ msg: 'User already exists' });
  }
  
  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    const user = { 
      id: nextId++, 
      email, 
      password: hashedPassword, 
      role 
    };
    users.push(user);
    
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'my_secret_key',
      { expiresIn: '7d' }
    );
    
    console.log('User registered:', email, role);
    res.json({ token, user: { id: user.id, email, role } });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  console.log('Login attempt:', email);
  
  try {
    const user = users.find(u => u.email === email);
    if (!user) {
      return res.status(400).json({ msg: 'Invalid credentials' });
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'my_secret_key',
      { expiresIn: '7d' }
    );
    
    console.log('Login successful:', email);
    res.json({ token, user: { id: user.id, email, role: user.role } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ============ AMBULANCE ROUTES ============
const verifyToken = (req, res, next) => {
  const token = req.header('x-auth-token');
  if (!token) {
    return res.status(401).json({ msg: 'No token' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'my_secret_key');
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ msg: 'Invalid token' });
  }
};

// Save ambulance route
app.post('/api/ambulance/route', verifyToken, (req, res) => {
  if (req.user.role !== 'ambulance') {
    return res.status(403).json({ msg: 'Access denied' });
  }
  
  const { ambulanceLocation, destination, routeGeometry } = req.body;
  
  activeAmbulance.isActive = true;
  activeAmbulance.location = ambulanceLocation;
  activeAmbulance.route = routeGeometry;
  activeAmbulance.destination = destination;
  activeAmbulance.timestamp = Date.now();
  
  console.log('Ambulance route saved:', destination.name);
  res.json({ msg: 'Route saved' });
});

// Update ambulance live location
app.post('/api/ambulance/location', verifyToken, (req, res) => {
  if (req.user.role !== 'ambulance') {
    return res.status(403).json({ msg: 'Access denied' });
  }
  
  const { lat, lng } = req.body;
  
  if (activeAmbulance.isActive) {
    activeAmbulance.location = { lat, lng };
    activeAmbulance.timestamp = Date.now();
  }
  
  res.json({ msg: 'Location updated' });
});

// Get active ambulance for police
app.get('/api/ambulance/active', verifyToken, (req, res) => {
  // Police can access
  if (req.user.role !== 'police' && req.user.role !== 'ambulance') {
    return res.status(403).json({ msg: 'Access denied' });
  }
  
  // Check if ambulance is active (within last 60 seconds)
  const isActive = activeAmbulance.isActive && 
                   activeAmbulance.location && 
                   (Date.now() - activeAmbulance.timestamp < 60000);
  
  if (isActive) {
    res.json({
      active: true,
      location: activeAmbulance.location,
      route: activeAmbulance.route,
      destination: activeAmbulance.destination,
      timestamp: activeAmbulance.timestamp
    });
  } else {
    activeAmbulance.isActive = false;
    res.json({ active: false });
  }
});

// Clear ambulance (when route completed)
app.delete('/api/ambulance/clear', verifyToken, (req, res) => {
  if (req.user.role !== 'ambulance') {
    return res.status(403).json({ msg: 'Access denied' });
  }
  
  activeAmbulance.isActive = false;
  activeAmbulance.location = null;
  activeAmbulance.route = null;
  activeAmbulance.destination = null;
  activeAmbulance.timestamp = null;
  
  res.json({ msg: 'Ambulance cleared' });
});

// Police check alerts (distance based)
app.post('/api/police/check-alerts', verifyToken, (req, res) => {
  if (req.user.role !== 'police') {
    return res.status(403).json({ msg: 'Access denied' });
  }
  
  const { lat, lng } = req.body;
  
  if (!activeAmbulance.isActive || !activeAmbulance.location) {
    return res.json({ alerts: [] });
  }
  
  // Calculate distance
  const distance = getDistanceFromLatLon(lat, lng, activeAmbulance.location.lat, activeAmbulance.location.lng);
  
  const alerts = [];
  if (distance < 5) { // Within 5km
    alerts.push({
      ambulanceId: 'active',
      hospitalName: activeAmbulance.destination?.name || 'Hospital',
      distance: Math.round(distance * 1000)
    });
  }
  
  res.json({ alerts });
});

function getDistanceFromLatLon(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function deg2rad(deg) {
  return deg * (Math.PI/180);
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));