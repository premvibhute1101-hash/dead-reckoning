export interface PredictResponse {
  status: string;
  message?: string;
  correction?: [number, number];
  corrected_velocity?: [number, number];
}

export const ApiClient = {
  getBackendUrl(): string {
    // Falls back to localhost if not specified
    return import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
  },

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.getBackendUrl()}/api/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      return response.ok;
    } catch (e) {
      console.warn('Backend health check failed:', e);
      return false;
    }
  },

  async pushTelemetryToAI(
    ax: number,
    ay: number,
    az: number,
    gyro_yaw: number,
    gyro_pitch: number,
    gyro_roll: number,
    vel_x: number,
    vel_y: number
  ): Promise<PredictResponse | null> {
    try {
      const payload = {
        imu_data: {
          acc_x: ax,
          acc_y: ay,
          acc_z: az,
          gyro_yaw,
          gyro_pitch,
          gyro_roll,
        },
        ins_state: {
          vel_x,
          vel_y,
        },
      };

      const response = await fetch(`${this.getBackendUrl()}/api/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.warn(`AI backend returned status ${response.status}`);
        return null;
      }

      const data: PredictResponse = await response.json();
      return data;
    } catch (e) {
      console.warn('Failed to push telemetry to AI backend:', e);
      return null;
    }
  },
};
