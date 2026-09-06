#!/bin/bash
echo "Setting up backend environment..."
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi
source venv/bin/activate
echo "Installing requirements..."
pip install -r requirements.txt
echo "Starting FastAPI server..."
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
