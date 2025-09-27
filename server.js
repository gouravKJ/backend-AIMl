const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");


const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());


mongoose
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));


const sensorSchema = new mongoose.Schema({
  id: String,
  voltage: Number,
  current: Number,
  vibration: Number,
  timestamp: { type: Date, default: Date.now }
});

const poleSchema = new mongoose.Schema({
  id: String,
  lat: Number,
  lng: Number,
  voltage: Number,
  current: Number,
  vibration: Number,
  faultProbability: Number,
  weather_risk: String,
  theft_risk: String,
  relay: String,
  timestamp: { type: Date, default: Date.now }
});

const commandSchema = new mongoose.Schema({
  poleId: String,
  relay: String
});

const Sensor = mongoose.model("Sensor", sensorSchema);
const Pole = mongoose.model("Pole", poleSchema);
const Command = mongoose.model("Command", commandSchema);

/**
 * ✅ IoT device sends sensor data here
 */
app.post("/api/sensors", async (req, res) => {
  const { id, lat, lng, voltage, current, vibration } = req.body;

  if (!id || !lat || !lng || !voltage || !current || !vibration) {
    return res.status(400).json({ message: "Invalid data format" });
  }

  // Save raw sensor reading
  const reading = new Sensor({ id, voltage, current, vibration });
  await reading.save();

  // AI/ML defaults
  let faultProbability = 0;
  let weather_risk = "normal";
  let theft_risk = "low";
  let faultDetected = false;

  try {
    const response = await fetch("http://localhost:5001/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, lat, lng, voltage, current, vibration }),
    });

    if (response.ok) {
      const aiData = await response.json();
      faultProbability = aiData.faultProbability ?? 0;
      weather_risk = aiData.weather_risk ?? "normal";
      theft_risk = aiData.theft_risk ?? "low";
      faultDetected = faultProbability > 0.8;
    }
  } catch (err) {
    console.warn("⚠️ AI/ML Service not responding, using defaults");
  }

  // Save command
  const relayCommand = faultDetected ? "OFF" : "ON";
  await Command.findOneAndUpdate(
    { poleId: id },
    { poleId: id, relay: relayCommand },
    { upsert: true }
  );

  // Save/update pole state
  const poleData = {
    id,
    lat,
    lng,
    voltage,
    current,
    vibration,
    faultProbability,
    weather_risk,
    theft_risk,
    relay: relayCommand,
    timestamp: new Date()
  };

  await Pole.findOneAndUpdate({ id }, poleData, { upsert: true });

  console.log("📡 New Sensor Data:", reading);
  console.log("⚡ Updated Pole State:", poleData);

  res.json({ message: "Data processed", sensor: reading, pole: poleData });
});

/**
 * ✅ IoT polls this to check relay command
 */
app.get("/api/commands/:id", async (req, res) => {
  const command = await Command.findOne({ poleId: req.params.id });
  res.json(command || { relay: "ON" });
});

/**
 * ✅ Get all raw sensor data
 */
app.get("/api/sensors", async (req, res) => {
  const sensors = await Sensor.find().sort({ timestamp: -1 });
  res.json(sensors);
});

/**
 * ✅ Get latest pole states
 */
app.get("/api/poles", async (req, res) => {
  const poles = await Pole.find();
  res.json(poles);
});

/**
 * ✅ Root route
 */
app.get("/", (req, res) => {
  res.send("⚡ Power Line Monitor backend with MongoDB is running...");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
