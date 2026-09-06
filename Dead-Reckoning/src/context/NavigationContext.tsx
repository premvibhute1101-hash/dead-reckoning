import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type {
  SensorStatus,
  RouteState,
  TelemetryData,
  SettingsState,
  UserProfile,
  ToastState,
  NavigationContextType,
  OperationalMatrixScenario,
  TelemetryLogEntry,
} from '../types/navigation';
import { LocationService } from '../services/locationService';
import { SensorService } from '../services/sensorService';
import { TileCacheService } from '../services/tileCacheService';

const initialSensorStatus: SensorStatus = {
  accel: true,
  gyro: true,
  compass: true,
  gnss: true,
  accelDataFlowing: false,
  compassDataFlowing: false,
};

const initialRouteState: RouteState = {
  origin: '',
  destination: '',
  startCoords: null,
  destCoords: null,
  routeCoordinates: [],
  calculated: false,
  distance: '0 km',
  duration: '0 min',
  distanceKm: 0,
  durationMin: 0,
  tunnelLength: '0 km',
  via: 'OSRM Driving Route',
  isCalculating: false,
  isAcquiringLocation: false,
  error: null,
  isFallbackRoute: false,
};

const initialTelemetry: TelemetryData = {
  speed: 0,
  drift: 0.6,
  eta: '--:--',
  remainingKm: 0,
  ax: 0.24,
  ay: -0.08,
  az: 9.80,
  pitch: 0.0,
  roll: 1.2,
  yaw: -0.4,
};

const initialSettings: SettingsState = {
  highSpeedPolling: true,
  mapMatching: true,
  keepScreenAwake: true,
  offlineLogs: '18.4 MB',
};

const initialUser: UserProfile = {
  name: 'Alex Mercer',
  role: 'Fleet Driver',
  id: '#98241',
  avatar: 'AM',
  stats: {
    driven: '1,248 km',
    tunnels: 342,
    uptime: '99.1%',
  },
};

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sensorStatus, setSensorStatus] = useState<SensorStatus>(initialSensorStatus);
  const [routeState, setRouteState] = useState<RouteState>(initialRouteState);
  const [telemetry, setTelemetry] = useState<TelemetryData>(initialTelemetry);
  const [settings, setSettings] = useState<SettingsState>(initialSettings);
  const [user] = useState<UserProfile>(initialUser);
  const [toast, setToast] = useState<ToastState>({ show: false, message: '' });
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(true);

  // Network Online & Operational Matrix Scenario State
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [matrixScenario, setMatrixScenarioState] = useState<OperationalMatrixScenario>('scenario1');
  const [scenarioAutoMode, setScenarioAutoMode] = useState<boolean>(true);
  const [cachedTilesCount, setCachedTilesCount] = useState<number>(0);
  const [telemetryLogs, setTelemetryLogs] = useState<TelemetryLogEntry[]>([]);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refresh cached tiles count from IndexedDB
  const refreshCacheCount = useCallback(async () => {
    const count = await TileCacheService.getCacheCount();
    setCachedTilesCount(count);
  }, []);

  useEffect(() => {
    refreshCacheCount();
    const interval = setInterval(refreshCacheCount, 5000);
    return () => clearInterval(interval);
  }, [refreshCacheCount]);

  // Window Online / Offline Event Listeners
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      setIsOnline(true);
      setToast({ show: true, message: 'Network Restored: Online Mode Active ✓' });
    };

    const handleOffline = () => {
      setIsOnline(false);
      setToast({ show: true, message: 'Network Lost: Offline IndexedDB & DR Active ⚠' });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Sync matrixScenario with network and GPS state changes
  useEffect(() => {
    if (!scenarioAutoMode) return;
    if (isOnline) {
      if (sensorStatus.gnss) {
        setMatrixScenarioState('scenario1'); // Scenario 1: GPS ON + Net ON
      } else {
        setMatrixScenarioState('scenario2'); // Scenario 2: GPS OFF + Net ON (GNSS Outage)
      }
    } else {
      if (sensorStatus.gnss) {
        setMatrixScenarioState('scenario3'); // Scenario 3: GPS ON + Net OFF (Pure Offline Satellite)
      } else {
        setMatrixScenarioState('scenario4'); // Scenario 4: GPS OFF + Net OFF (Pure Offline DR)
      }
    }
  }, [isOnline, sensorStatus.gnss, scenarioAutoMode]);

  const setMatrixScenario = useCallback((scenario: OperationalMatrixScenario) => {
    setScenarioAutoMode(false);
    setMatrixScenarioState(scenario);
  }, []);

  const resumeAutoScenario = useCallback(() => {
    setScenarioAutoMode(true);
  }, []);

  const setSensorGnss = useCallback((locked: boolean) => {
    setSensorStatus((prev) => ({ ...prev, gnss: locked }));
  }, []);

  // Keep ref to avoid recreation loops
  const routeStateRef = useRef<RouteState>(routeState);
  const telemetryRef = useRef<TelemetryData>(telemetry);
  const gnssRef = useRef<boolean>(sensorStatus.gnss);

  useEffect(() => {
    routeStateRef.current = routeState;
  }, [routeState]);

  useEffect(() => {
    telemetryRef.current = telemetry;
  }, [telemetry]);

  useEffect(() => {
    gnssRef.current = sensorStatus.gnss;
  }, [sensorStatus.gnss]);

  // Clean document data-theme attribute
  useEffect(() => {
    document.documentElement.removeAttribute('data-theme');
  }, []);

  const showToast = useCallback((message: string) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast({ show: true, message });
    toastTimeoutRef.current = setTimeout(() => {
      setToast({ show: false, message: '' });
      toastTimeoutRef.current = null;
    }, 3500);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);
  const lastMotionMsRef = useRef<number>(0);
  const lastOrientationMsRef = useRef<number>(0);

  // Subscribe to real hardware sensor stream with dynamic fallback noise
  useEffect(() => {
    const unsubMotion = SensorService.subscribeMotion((data) => {
      lastMotionMsRef.current = Date.now();
      setTelemetry((prev) => ({
        ...prev,
        ax: data.ax,
        ay: data.ay,
        az: data.az,
      }));
    });

    const unsubOrientation = SensorService.subscribeOrientation((data) => {
      lastOrientationMsRef.current = Date.now();
      setTelemetry((prev) => ({
        ...prev,
        yaw: data.alpha != null ? data.alpha : prev.yaw,
        pitch: data.beta != null ? data.beta : prev.pitch,
        roll: data.gamma != null ? data.gamma : prev.roll,
      }));
    });

    return () => {
      unsubMotion();
      unsubOrientation();
    };
  }, []);

  // 2. Sensor data freshness detector — distinguishes "permission granted"
  // from "actually receiving live sensor events."
  useEffect(() => {
    const freshnessInterval = setInterval(() => {
      const now = Date.now();
      const motionFresh = now - lastMotionMsRef.current < 3000;
      const orientationFresh = now - lastOrientationMsRef.current < 3000;
      setSensorStatus((prev) => {
        if (prev.accelDataFlowing === motionFresh && prev.compassDataFlowing === orientationFresh) {
          return prev;
        }
        return {
          ...prev,
          accelDataFlowing: motionFresh,
          compassDataFlowing: orientationFresh,
        };
      });
    }, 1000);

    return () => clearInterval(freshnessInterval);
  }, []);

  // 3. Simulated telemetry noise (original, pre-existing effect — unchanged)
  useEffect(() => {
    const interval = setInterval(() => {
      setTelemetry((prev) => {
        const noiseX = (Math.random() - 0.5) * 0.04;
        const noiseY = (Math.random() - 0.5) * 0.04;
        const noiseZ = (Math.random() - 0.5) * 0.02;
        const speedNoise = (Math.random() - 0.5) * 0.6;

        return {
          ...prev,
          speed: Math.max(0, Math.round((prev.speed + speedNoise) * 10) / 10),
          ax: Math.round((prev.ax + noiseX) * 100) / 100,
          ay: Math.round((prev.ay + noiseY) * 100) / 100,
          az: Math.round((9.80 + noiseZ) * 100) / 100,
        };
      });
    }, 250);

    return () => clearInterval(interval);
  }, []);

  // Accumulate periodic telemetry logs across route navigations
  useEffect(() => {
    const logInterval = setInterval(() => {
      const currentRoute = routeStateRef.current;
      const currentCoords = currentRoute.startCoords || [19.076, 72.8777];
      setTelemetryLogs((prev) => {
        const newEntry: TelemetryLogEntry = {
          timestamp: new Date().toISOString(),
          lat: currentCoords[0],
          lng: currentCoords[1],
          speedKmH: telemetryRef.current.speed,
          driftM: telemetryRef.current.drift,
          ax: telemetryRef.current.ax,
          ay: telemetryRef.current.ay,
          az: telemetryRef.current.az,
          pitch: telemetryRef.current.pitch,
          roll: telemetryRef.current.roll,
          yaw: telemetryRef.current.yaw,
          gnssLocked: gnssRef.current,
          mode: currentRoute.calculated ? 'Route Active' : 'Standby / Diagnostic',
        };
        return [...prev.slice(-999), newEntry];
      });
    }, 1000);

    return () => clearInterval(logInterval);
  }, []);

  const calculateDynamicRoute = useCallback(
    async (overrideStart?: [number, number], overrideDest?: [number, number]) => {
      const currentRoute = routeStateRef.current;
      const start = overrideStart || currentRoute.startCoords;
      const dest = overrideDest || currentRoute.destCoords;

      if (!start || !dest) {
        setRouteState((prev) => ({
          ...prev,
          error: 'Please set both Start and Destination locations.',
          calculated: false,
          isCalculating: false,
        }));
        return;
      }

      setRouteState((prev) => ({
        ...prev,
        isCalculating: true,
        error: null,
      }));

      try {
        const route = await LocationService.calculateRoute(start, dest);

        const hrs = Math.floor(route.durationMin / 60);
        const mins = route.durationMin % 60;
        const formattedDuration = hrs > 0 ? `${hrs}h ${mins}m` : `${mins} min`;

        setRouteState((prev) => ({
          ...prev,
          startCoords: start,
          destCoords: dest,
          routeCoordinates: route.coordinates,
          distanceKm: route.distanceKm,
          durationMin: route.durationMin,
          distance: `${route.distanceKm.toFixed(1)} km`,
          duration: formattedDuration,
          calculated: true,
          isCalculating: false,
          error: null,
          isFallbackRoute: route.isFallback,
        }));

        setTelemetry((prev) => ({
          ...prev,
          remainingKm: route.distanceKm,
          eta: `${Math.floor(route.durationMin / 60)}h ${route.durationMin % 60}m`,
        }));

        if (route.isFallback) {
          showToast(`Direct Route Fallback Active ✓ (${route.distanceKm.toFixed(1)} km, ${formattedDuration})`);
        } else {
          showToast(`OSRM Drivable Route Calculated ✓ (${route.distanceKm.toFixed(1)} km, ${formattedDuration})`);
        }
      } catch (err: any) {
        const errMsg = err?.message || 'Failed to calculate drivable route.';
        setRouteState((prev) => ({
          ...prev,
          isCalculating: false,
          calculated: false,
          error: errMsg,
        }));
        showToast(`Route Error: ${errMsg}`);
      }
    },
    [showToast]
  );

  const acquireLiveLocation = useCallback(async () => {
    setRouteState((prev) => ({ ...prev, isAcquiringLocation: true, error: null }));
    try {
      const location = await LocationService.getCurrentLocation();
      const newStart: [number, number] = [location.lat, location.lng];

      setSensorStatus((prev) => ({ ...prev, gnss: true }));

      const currentDest = routeStateRef.current.destCoords;

      setRouteState((prev) => ({
        ...prev,
        startCoords: newStart,
        origin: location.address,
        isAcquiringLocation: false,
      }));

      showToast(`Live GPS Acquired: ${location.address.slice(0, 25)}... ✓`);

      if (currentDest) {
        await calculateDynamicRoute(newStart, currentDest);
      }
    } catch (err: any) {
      const errMsg = err?.message || 'Could not acquire GPS position.';
      setRouteState((prev) => ({ ...prev, isAcquiringLocation: false }));
      showToast(`GPS Warning: ${errMsg}`);
    }
  }, [calculateDynamicRoute, showToast]);

  // Execute location acquisition ONCE on initial mount
  useEffect(() => {
    acquireLiveLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setStartCoordsAndAddress = async (coords: [number, number], address: string) => {
    const currentDest = routeStateRef.current.destCoords;
    setRouteState((prev) => ({
      ...prev,
      startCoords: coords,
      origin: address,
    }));
    if (currentDest) {
      await calculateDynamicRoute(coords, currentDest);
    }
  };

  const setDestCoordsAndAddress = async (coords: [number, number], address: string) => {
    const currentStart = routeStateRef.current.startCoords;
    setRouteState((prev) => ({
      ...prev,
      destCoords: coords,
      destination: address,
    }));
    if (currentStart) {
      await calculateDynamicRoute(currentStart, coords);
    }
  };

  const swapLocations = () => {
    const prev = routeStateRef.current;
    const tempOrigin = prev.origin;
    const tempStart = prev.startCoords;
    const newStart = prev.destCoords;
    const newDest = tempStart;

    setRouteState((p) => ({
      ...p,
      origin: p.destination,
      startCoords: p.destCoords,
      destination: tempOrigin,
      destCoords: tempStart,
    }));

    if (newStart && newDest) {
      calculateDynamicRoute(newStart, newDest);
    }
  };

  const calibrateCompass = async () => {
    const granted = await SensorService.requestOrientationPermission();
    setSensorStatus((prev) => ({ ...prev, compass: granted }));
    showToast(granted ? 'Compass Calibrated & Active ✓' : 'Compass Permission Denied');
  };

  const grantGnssPermission = () => {
    setSensorStatus((prev) => ({ ...prev, gnss: true }));
    acquireLiveLocation();
  };

  const grantAllSensors = async () => {
    const motionGranted = await SensorService.requestMotionPermission();
    const orientationGranted = await SensorService.requestOrientationPermission();
    setSensorStatus((prev) => ({
      ...prev,
      accel: motionGranted,
      gyro: motionGranted,
      compass: orientationGranted,
      gnss: true,
      accelDataFlowing: false,
      compassDataFlowing: false,
    }));
    acquireLiveLocation();
    showToast('All Hardware Sensors Granted & Active ✓');
  };

  const setRouteDestination = (destination: string) => {
    setRouteState((prev) => ({
      ...prev,
      destination,
    }));
  };

  const updateOriginDestination = (origin: string, destination: string) => {
    setRouteState((prev) => ({
      ...prev,
      origin,
      destination,
    }));
  };

  const clearRoute = () => {
    setRouteState(initialRouteState);
    showToast('Route cleared');
  };

  const toggleSetting = (key: keyof SettingsState) => {
    setSettings((prev) => ({
      ...prev,
      [key]: typeof prev[key] === 'boolean' ? !prev[key] : prev[key],
    }));
    showToast('Setting updated ✓');
  };

  const clearOfflineLogs = () => {
    setSettings((prev) => ({ ...prev, offlineLogs: '0 KB' }));
    showToast('Saved offline logs cleared (0 KB) ✓');
  };

  const clearTileCache = async () => {
    await TileCacheService.clearCache();
    setCachedTilesCount(0);
    showToast('IndexedDB tile cache cleared (0 tiles) ✓');
  };

  const loginUser = () => {
    setIsLoggedIn(true);
    showToast('Logged in successfully ✓');
  };

  const logoutUser = () => {
    setIsLoggedIn(false);
    showToast('Logged out successfully');
  };

  const exportTelemetryCsv = useCallback(() => {
    const currentRoute = routeStateRef.current;
    const currentLogs =
      telemetryLogs.length > 0
        ? telemetryLogs
        : [
          {
            timestamp: new Date().toISOString(),
            lat: currentRoute.startCoords ? currentRoute.startCoords[0] : 19.076,
            lng: currentRoute.startCoords ? currentRoute.startCoords[1] : 72.8777,
            speedKmH: telemetry.speed,
            driftM: telemetry.drift,
            ax: telemetry.ax,
            ay: telemetry.ay,
            az: telemetry.az,
            pitch: telemetry.pitch,
            roll: telemetry.roll,
            yaw: telemetry.yaw,
            gnssLocked: sensorStatus.gnss,
            mode: currentRoute.calculated ? 'Route Active' : 'Standby / Diagnostic',
          },
        ];

    const headers = [
      'Timestamp',
      'Latitude',
      'Longitude',
      'Speed_kmh',
      'Drift_m',
      'Accel_X_ms2',
      'Accel_Y_ms2',
      'Accel_Z_ms2',
      'Pitch_deg',
      'Roll_deg',
      'Yaw_deg',
      'GNSS_Locked',
      'Navigation_Mode',
    ];

    const rows = currentLogs.map((entry) => [
      entry.timestamp,
      entry.lat.toFixed(6),
      entry.lng.toFixed(6),
      entry.speedKmH.toFixed(1),
      entry.driftM.toFixed(2),
      entry.ax.toFixed(2),
      entry.ay.toFixed(2),
      entry.az.toFixed(2),
      entry.pitch.toFixed(1),
      entry.roll.toFixed(1),
      entry.yaw.toFixed(1),
      entry.gnssLocked ? 'YES' : 'NO',
      `"${entry.mode.replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const filename = `idr_telemetry_log_${user.id.replace('#', '')}.csv`;
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);

    showToast(`CSV Telemetry Log Downloaded ✓ (${filename})`);
  }, [telemetryLogs, telemetry, sensorStatus.gnss, user.id, showToast]);

  return (
    <NavigationContext.Provider
      value={{
        sensorStatus,
        routeState,
        telemetry,
        settings,
        user,
        toast,
        isLoggedIn,
        isOnline,
        matrixScenario,
        cachedTilesCount,
        telemetryLogs,
        scenarioAutoMode,
        setMatrixScenario,
        resumeAutoScenario,
        setSensorGnss,
        calibrateCompass,
        grantGnssPermission,
        grantAllSensors,
        acquireLiveLocation,
        setStartCoordsAndAddress,
        setDestCoordsAndAddress,
        calculateDynamicRoute,
        swapLocations,
        setRouteDestination,
        updateOriginDestination,
        clearRoute,
        toggleSetting,
        clearOfflineLogs,
        clearTileCache,
        showToast,
        exportTelemetryCsv,
        loginUser,
        logoutUser,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
};

export const useNavigationContext = (): NavigationContextType => {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigationContext must be used within a NavigationProvider');
  }
  return context;
};
