const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("./models/User");
const { DiagnosisRecord, Feedback, SymptomMapping } = require("./models/Schemas");
const mlModel = require("./models/MLModel");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/medicalAI";
const JWT_SECRET = process.env.JWT_SECRET || "secretkey";
const PORT = process.env.PORT || 5000;

const app = express();

app.use(cors());
app.use(express.json());

mongoose.connect(MONGO_URI)
.then(()=>console.log("MongoDB Connected Successfully"))
.catch(err=>console.log(err));

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({message: "No token provided"});
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch(err) {
    res.status(401).json({message: "Invalid token"});
  }
};

app.get("/", (req,res)=>{
    res.send("Backend Running Successfully");
});

// Register API
app.post("/register", async (req,res)=>{
    try{
        const {name,dob,email,phone,password} = req.body;

        const existingUser = await User.findOne({email});
        if(existingUser){
            return res.status(400).json({message:"Email already registered"});
        }

        const hashedPassword = await bcrypt.hash(password,10);

        const newUser = new User({
            name,
            dob,
            email,
            phone,
            password: hashedPassword
        });

        await newUser.save();

        res.json({message:"User registered successfully"});
    }
    catch(err){
        res.status(500).json({message:"Server error"});
    }
});

// Login API
app.post("/login", async (req,res)=>{
    try{
        const {email,password} = req.body;

        const user = await User.findOne({email});
        if(!user){
            return res.status(400).json({message:"User not found"});
        }

        const match = await bcrypt.compare(password,user.password);
        if(!match){
            return res.status(400).json({message:"Incorrect password"});
        }

        const token = jwt.sign(
    { id: user._id, email: user.email },
    JWT_SECRET,
    { expiresIn: "1h" }
);

        res.json({message:"Login successful",token});
    }
    catch(err){
        res.status(500).json({message:"Server error"});
    }
});

// ================= DIAGNOSIS API (AI-POWERED) =================
app.post("/api/diagnose", async (req, res) => {
    try {
        const { symptoms, severity, text, days } = req.body;

        // Validation
        if (!symptoms || !Array.isArray(symptoms) || symptoms.length === 0) {
            if (!text || text.trim().length === 0) {
                return res.status(400).json({ message: "Please provide symptoms or description" });
            }
        }

        // Get ML diagnosis
        const diagnosisResult = await mlModel.diagnose(
            symptoms || [],
            severity || 'Moderate',
            parseInt(days) || 1,
            text || ''
        );

        // Save diagnosis to database if user is logged in
        if (req.headers['authorization']) {
            try {
                const token = req.headers['authorization'].split(' ')[1];
                const decoded = jwt.verify(token, JWT_SECRET);

                const diagnosis = new DiagnosisRecord({
                    userId: decoded.id,
                    symptoms: symptoms || [],
                    severity: severity || 'Moderate',
                    duration: parseInt(days) || 1,
                    description: text || '',
                    results: {
                        diagnoses: diagnosisResult.diagnoses,
                        confidences: diagnosisResult.confidences,
                        reasons: diagnosisResult.reasons,
                        primaryDiagnosis: Object.keys(diagnosisResult.diagnoses)[0],
                        primaryConfidence: Object.values(diagnosisResult.confidences)[0]
                    }
                });
                await diagnosis.save();
            } catch(err) {
                console.log("Could not save diagnosis:", err.message);
            }
        }

        res.json({
            success: true,
            data: diagnosisResult
        });

    } catch (err) {
        console.error("Diagnosis error:", err);
        res.status(500).json({ message: "Analysis error", error: err.message });
    }
});

// Get similar symptoms
app.get("/api/symptoms/similar", (req, res) => {
    try {
        const query = req.query.q;
        if (!query || query.length < 2) {
            return res.status(400).json({ message: "Query too short" });
        }

        const similar = mlModel.getSimilarSymptoms(query);
        res.json({ suggestions: similar });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error fetching suggestions" });
    }
});

// Get disease information
app.get("/api/diseases/:name", (req, res) => {
    try {
        const diseaseInfo = mlModel.getDiseaseInfo(req.params.name);
        if (!diseaseInfo) {
            return res.status(404).json({ message: "Disease not found" });
        }
        res.json({ data: diseaseInfo });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error fetching disease info" });
    }
});

// Get all available diseases
app.get("/api/diseases", (req, res) => {
    try {
        const diseases = mlModel.getAllDiseases();
        res.json({ diseases });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error fetching diseases" });
    }
});

// Get all symptoms
app.get("/api/symptoms", (req, res) => {
    try {
        const symptoms = mlModel.getSymptomVocabulary();
        res.json({ symptoms });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error fetching symptoms" });
    }
});

// Save feedback on diagnosis
app.post("/api/feedback", verifyToken, async (req, res) => {
    try {
        const { diagnosisId, predictedDiagnosis, actualDiagnosis, helpful, rating, feedback: feedbackText } = req.body;

        const feedbackRecord = new Feedback({
            diagnosisRecordId: diagnosisId,
            userId: req.userId,
            predictedDiagnosis,
            actualDiagnosis,
            helpful,
            rating,
            feedback: feedbackText
        });

        await feedbackRecord.save();

        // Update diagnosis record with feedback
        if (diagnosisId) {
            await DiagnosisRecord.updateOne(
                { _id: diagnosisId },
                { 
                    $set: { 
                        'feedback.wasCorrect': predictedDiagnosis === actualDiagnosis,
                        'feedback.actualDiagnosis': actualDiagnosis,
                        'feedback.userNotes': feedbackText
                    }
                }
            );
        }

        res.json({ message: "Feedback saved successfully" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error saving feedback", error: err.message });
    }
});

// Get user's diagnosis history
app.get("/api/user/diagnoses", verifyToken, async (req, res) => {
    try {
        const diagnoses = await DiagnosisRecord.find({ userId: req.userId })
            .sort({ createdAt: -1 })
            .limit(20);
        
        res.json({ diagnoses });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error fetching diagnosis history" });
    }
});

// Legacy /analyze endpoint (for backwards compatibility)
app.post("/analyze", async (req, res) => {
    try {
        const { symptoms, severity, text, days } = req.body;

        if (!symptoms || !Array.isArray(symptoms)) {
            return res.status(400).json({ message: "Invalid symptoms data" });
        }

        const result = await mlModel.diagnose(symptoms, severity, days, text);
        res.json(result.diagnoses);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Analysis error" });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});