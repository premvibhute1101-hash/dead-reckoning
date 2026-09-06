# Dead-Reckoning Integration with AI Model

This guide explains how to run the integrated system, connecting the React frontend (`Dead-Reckoning`) with the Python AI model (`deadreckon-idr`) via the new FastAPI backend.

## 1. Start the Backend

The backend exposes a REST API on port `8000`.

### On Windows:
1. Open a terminal and navigate to the `backend` folder.
2. Run `start.bat`.
   This will create a virtual environment, install the pinned dependencies, and start the `uvicorn` server.

### On Linux/macOS:
1. Open a terminal and navigate to the `backend` folder.
2. Run `bash start.sh`.

The backend should now be running at `http://0.0.0.0:8000`.
You can check its health at `http://localhost:8000/api/health`.

## 2. Configure the Frontend

To allow the frontend (especially if running on a mobile device or emulator) to connect to the backend, you must configure the backend URL with your machine's LAN IP address.

1. Find your machine's LAN IP address:
   - **Windows**: Run `ipconfig` and look for "IPv4 Address".
   - **Mac/Linux**: Run `ifconfig` or `ip a`.
2. Open `Dead-Reckoning/.env.local`.
3. Update `VITE_BACKEND_URL` to point to your IP.
   Example:
   ```
   VITE_BACKEND_URL=http://192.168.1.5:8000
   ```
   *(If you are just running the frontend on the same machine in a desktop browser, `http://localhost:8000` is fine, which is the fallback default.)*

## 3. Run the Frontend

1. Open a terminal in the `Dead-Reckoning` directory.
2. Install dependencies if you haven't already:
   ```bash
   npm install
   ```
3. Start the Vite dev server:
   ```bash
   npm run dev
   ```
4. Open the provided local URL in your browser or connect your emulator/device to it.

## 4. Verification

- In the frontend, start a "Demo Route Simulation" or "Live Tracking".
- In the **Navigation HUD**, you will see a badge at the top reading `AI: COLLECTING`.
- After 2 seconds (20 samples pushed at 10Hz), the badge will change to `AI: READY`, indicating that the AI model is actively correcting the dead-reckoning drift.
- You can observe the terminal where the backend is running to see the requests coming in.
