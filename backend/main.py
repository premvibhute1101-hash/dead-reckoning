import os
import sys
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

# Add the AI model directory to sys.path
backend_dir = os.path.dirname(os.path.abspath(__file__))
workspace_root = os.path.dirname(backend_dir)
ai_dir = os.path.join(workspace_root, "deadreckon-idr", "ins_error_ai")
sys.path.append(ai_dir)

try:
    from src.inference import LiveErrorCorrector  # type: ignore
    # Initialize the singleton model
    corrector = LiveErrorCorrector()
    MODEL_LOADED = True
    print("AI Model loaded successfully.")
except Exception as e:
    print(f"Failed to load AI model: {e}")
    corrector = None
    MODEL_LOADED = False

app = FastAPI(title="Dead-Reckoning Integration API")

# Configure CORS to allow the frontend (running on a device or emulator) to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for local dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class IMUData(BaseModel):
    acc_x: float
    acc_y: float
    acc_z: float
    gyro_yaw: float
    gyro_pitch: float
    gyro_roll: float

class INSState(BaseModel):
    vel_x: float
    vel_y: float

class PredictRequest(BaseModel):
    imu_data: IMUData
    ins_state: INSState

class PredictResponse(BaseModel):
    status: str
    message: Optional[str] = None
    correction: Optional[List[float]] = None
    corrected_velocity: Optional[List[float]] = None

@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "model_loaded": MODEL_LOADED
    }

@app.post("/api/predict", response_model=PredictResponse)
def predict(request: PredictRequest):
    if not MODEL_LOADED or corrector is None:
        raise HTTPException(status_code=503, detail="AI Model is not loaded")

    # Format the input as numpy array
    imu_sample = np.array([
        request.imu_data.acc_x,
        request.imu_data.acc_y,
        request.imu_data.acc_z,
        request.imu_data.gyro_yaw,
        request.imu_data.gyro_pitch,
        request.imu_data.gyro_roll
    ])

    # Push to rolling buffer
    corrector.push_sample(imu_sample)

    # Check if window is full
    if not corrector.ready():
        return PredictResponse(
            status="collecting",
            message=f"Buffer not full. Current size: {len(corrector.buffer)}/20"
        )

    # If full, predict
    ins_state_arr = np.array([request.ins_state.vel_x, request.ins_state.vel_y])
    
    try:
        correction = corrector.correct(ins_state_arr)
        # Sign convention is addition: corrected_vel = ins_vel + err_vel
        corrected_vel = ins_state_arr + correction
        
        return PredictResponse(
            status="ready",
            correction=correction.tolist(),
            corrected_velocity=corrected_vel.tolist()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
