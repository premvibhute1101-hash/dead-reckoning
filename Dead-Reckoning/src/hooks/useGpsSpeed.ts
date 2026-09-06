import { useState, useEffect, useRef } from 'react';
import { DeadReckoningEngine } from '../services/deadReckoningEngine';
import { OrientationService } from '../services/OrientationService';

export interface GpsState {
  speedKmh: number;
  headingDeg: number;
  position: [number, number] | null;
  isStale: boolean;
}

interface Fix {
  lat: number;
  lng: number;
  timestamp: number; // in ms
}

export const useGpsSpeed = (
  trackingMode: 'live' | 'simulation',
  mockCoords?: [number, number] | null,
  onGnssStatusChange?: (locked: boolean) => void // NEW: reports real GPS lock/loss upward
): GpsState => {
  const [state, setState] = useState<GpsState>({
    speedKmh: 0,
    headingDeg: 0,
    position: mockCoords || null,
    isStale: false,
  });

  const lastFixRef = useRef<Fix | null>(null);
  const speedBufferRef = useRef<number[]>([]);
  const lastUpdateMsRef = useRef<number>(Date.now());
  const staleTimeoutRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastHeadingRef = useRef<number>(0);

  const handleNewFix = (
    lat: number,
    lng: number,
    timestamp: number,
    nativeSpeed: number | null,
    nativeHeading: number | null,
    accuracy: number | null
  ) => {
    // Noise filtering: ignore poor accuracy
    if (accuracy !== null && accuracy > 20) {
      lastUpdateMsRef.current = Date.now();
      return;
    }

    lastUpdateMsRef.current = Date.now();

    const currentCoords: [number, number] = [lat, lng];
    let newSpeedKmh = 0;
    // Keep current heading as default
    let newHeading = lastHeadingRef.current;

    const prevFix = lastFixRef.current;

    if (prevFix) {
      const distKm = DeadReckoningEngine.calculateHaversineDistance(
        [prevFix.lat, prevFix.lng],
        currentCoords
      );
      const distMeters = distKm * 1000;

      // Noise threshold: if distance moved < 2m, treat as stationary
      if (distMeters < 2) {
        newSpeedKmh = 0;
      } else {
        // Calculate heading if native not provided
        if (nativeHeading !== null && !isNaN(nativeHeading)) {
          newHeading = nativeHeading;
        } else {
          newHeading = OrientationService.calculateBearing(
            [prevFix.lat, prevFix.lng],
            currentCoords
          );
        }

        // Calculate speed
        if (nativeSpeed !== null && !isNaN(nativeSpeed) && nativeSpeed >= 0) {
          // nativeSpeed is in m/s
          newSpeedKmh = nativeSpeed * 3.6;
        } else {
          // Manual Haversine fallback
          const elapsedSec = (timestamp - prevFix.timestamp) / 1000;
          if (elapsedSec > 0) {
            const manualSpeedMs = distMeters / elapsedSec;
            newSpeedKmh = manualSpeedMs * 3.6;
          }
        }
      }
    }

    // Moving average filter (last 3 readings)
    const buffer = speedBufferRef.current;
    if (newSpeedKmh > 0 || buffer.length > 0) {
      buffer.push(newSpeedKmh);
      if (buffer.length > 3) buffer.shift();

      const avgSpeed = buffer.reduce((a, b) => a + b, 0) / buffer.length;
      newSpeedKmh = Math.round(avgSpeed * 10) / 10;
    } else {
      newSpeedKmh = 0;
    }

    lastFixRef.current = { lat, lng, timestamp };

    setState((prev) => ({
      speedKmh: newSpeedKmh,
      headingDeg: newHeading !== prev.headingDeg ? Math.round(newHeading) : prev.headingDeg,
      position: currentCoords,
      isStale: false,
    }));
    lastHeadingRef.current = Math.round(newHeading);
  };

  // 1. Live GPS tracking — the SINGLE source of truth for real GPS in the app.
  useEffect(() => {
    if (trackingMode !== 'live') return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        onGnssStatusChange?.(true); // NEW: every good fix = signal locked
        handleNewFix(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.timestamp,
          pos.coords.speed,
          pos.coords.heading,
          pos.coords.accuracy
        );
      },
      (err) => {
        console.warn('Real GPS Watch error:', err);
        // codes: 1=PERMISSION_DENIED, 2=POSITION_UNAVAILABLE, 3=TIMEOUT — all count as "no lock"
        onGnssStatusChange?.(false); // NEW
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackingMode]);

  // 2. Simulation tracking
  useEffect(() => {
    if (trackingMode !== 'simulation') return;
    if (!mockCoords) return;

    handleNewFix(
      mockCoords[0],
      mockCoords[1],
      Date.now(),
      null,
      null,
      5 // simulate good accuracy
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackingMode, mockCoords]);

  // 3. Stale detector (5 second timeout)
  useEffect(() => {
    staleTimeoutRef.current = setInterval(() => {
      if (Date.now() - lastUpdateMsRef.current > 5000) {
        setState((prev) => {
          if (!prev.isStale) {
            speedBufferRef.current = [];
            return { ...prev, isStale: true, speedKmh: 0 };
          }
          return prev;
        });
      }
    }, 1000);

    return () => {
      if (staleTimeoutRef.current) clearInterval(staleTimeoutRef.current);
    };
  }, []);

  return state;
};