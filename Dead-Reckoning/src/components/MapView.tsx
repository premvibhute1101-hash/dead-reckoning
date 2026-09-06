import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { TileCacheService } from '../services/tileCacheService';

import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

// Custom Marker Icons
const createStartIcon = () =>
  L.divIcon({
    className: 'custom-start-icon',
    html: `
      <div style="width: 22px; height: 22px; background: #059669; border: 3px solid #FFFFFF; border-radius: 50%; box-shadow: 0 2px 6px rgba(0,0,0,0.3);"></div>
    `,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

const createDestIcon = () =>
  L.divIcon({
    className: 'custom-dest-icon',
    html: `
      <div style="width: 24px; height: 24px; background: #DC2626; border: 3px solid #FFFFFF; border-radius: 50%; box-shadow: 0 2px 6px rgba(0,0,0,0.4); cursor: grab;"></div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

// Dynamic High-Visibility Navigation Chevron Arrow Icon
const createChevronIcon = (heading: number = 0) =>
  L.divIcon({
    className: 'custom-chevron-icon',
    html: `
      <div style="width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; position: relative;">
        <!-- Accuracy pulse halo -->
        <div style="position: absolute; inset: 4px; border-radius: 50%; background: rgba(37, 99, 235, 0.2); border: 1.5px solid rgba(37, 99, 235, 0.4);"></div>
        <!-- Directional chevron arrow SVG -->
        <div style="width: 32px; height: 32px; transform: rotate(${heading}deg); transition: transform 0.1s linear; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0px 3px 6px rgba(0,0,0,0.4));">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L19 21L12 17.5L5 21L12 2Z" fill="#2563EB" stroke="#FFFFFF" stroke-width="2.5" stroke-linejoin="round"/>
          </svg>
        </div>
      </div>
    `,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });

// Blank/placeholder tile shown when offline and no cached copy exists
const OFFLINE_PLACEHOLDER_TILE =
  'data:image/svg+xml;base64,' +
  btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e2e8f0"/></svg>`
  );

// Custom Leaflet TileLayer with IndexedDB Offline Persistence Interceptor
const IndexedDBTileLayer = L.TileLayer.extend({
  createTile(coords: L.Coords, done: L.DoneCallback) {
    const tile = document.createElement('img');

    L.DomEvent.on(tile, 'load', L.Util.bind((this as any)._tileOnLoad, this, done, tile));
    L.DomEvent.on(tile, 'error', L.Util.bind((this as any)._tileOnError, this, done, tile));

    if (this.options.crossOrigin || this.options.crossOrigin === '') {
      tile.crossOrigin = this.options.crossOrigin === true ? '' : this.options.crossOrigin;
    }

    tile.alt = '';
    tile.setAttribute('role', 'presentation');

    const url = this.getTileUrl(coords);

    // Fetch from IndexedDB cache, or network — unless network is simulated OFF
    TileCacheService.getTile(url).then((cachedDataUrl) => {
      if (cachedDataUrl) {
        tile.src = cachedDataUrl;
        return;
      }

      // NEW: respect the simulated network toggle (options.networkEnabled)
      const networkAllowed = (this.options as any).networkEnabled !== false;
      if (!networkAllowed) {
        // Simulated offline (scenario3/4): no cached tile available — show placeholder,
        // do NOT hit the real network.
        tile.src = OFFLINE_PLACEHOLDER_TILE;
        return;
      }

      fetch(url)
        .then((res) => res.blob())
        .then((blob) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const dataUrl = reader.result as string;
            tile.src = dataUrl;
            TileCacheService.saveTile(url, dataUrl);
          };
          reader.readAsDataURL(blob);
        })
        .catch(() => {
          tile.src = url;
        });
    });

    return tile;
  },
});

interface MapViewProps {
  mode?: 'explore' | 'navigation' | 'summary';
  center?: [number, number];
  zoom?: number;
  showRoute?: boolean;
  startCoords?: [number, number] | null;
  destCoords?: [number, number] | null;
  routeCoordinates?: [number, number][];
  deadReckoningPath?: [number, number][];
  rawInsPath?: [number, number][];
  liveVehiclePos?: [number, number] | null;
  liveHeading?: number;
  cameraMode?: 'north-up' | 'head-up';
  isDarkMode?: boolean;
  networkEnabled?: boolean; // NEW: simulate scenario3/4 by forcing cached-only tiles
  onMapClick?: (lat: number, lng: number) => void;
  onDestinationDragEnd?: (lat: number, lng: number) => void;
  onToggleCameraMode?: () => void;
}

const MapViewComponent: React.FC<MapViewProps> = ({
  mode = 'explore',
  center = [19.0760, 72.8777],
  zoom = 10,
  showRoute = true,
  startCoords = null,
  destCoords = null,
  routeCoordinates = [],
  deadReckoningPath = [],
  rawInsPath = [],
  liveVehiclePos = null,
  liveHeading = 0,
  cameraMode = 'north-up',
  isDarkMode = false,
  networkEnabled = true, // NEW
  onMapClick,
  onDestinationDragEnd,
  onToggleCameraMode,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const tileLayerRef = useRef<any>(null); // NEW
  const initialCenterFittedRef = useRef<boolean>(false);
  const lastFittedRouteKeyRef = useRef<string>('');
  const isUserInteractingRef = useRef<boolean>(false);
  const userInteractTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onMapClickRef = useRef(onMapClick);
  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  const onDestinationDragEndRef = useRef(onDestinationDragEnd);
  useEffect(() => {
    onDestinationDragEndRef.current = onDestinationDragEnd;
  }, [onDestinationDragEnd]);

  const networkEnabledRef = useRef(networkEnabled); // NEW
  useEffect(() => {
    networkEnabledRef.current = networkEnabled;
    // Keep the live tile layer's option in sync so createTile() sees updates immediately
    if (tileLayerRef.current) {
      tileLayerRef.current.options.networkEnabled = networkEnabled;
    }
  }, [networkEnabled]);

  // Initialize map once with IndexedDB Cached Tile Layer
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    const initialCenter = startCoords || center;

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: zoom,
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: true,
      touchZoom: true,
      doubleClickZoom: true,
      boxZoom: true,
      dragging: true,
      zoomAnimation: true,
      zoomSnap: 1,
      zoomDelta: 1,
    });

    const startInteraction = () => {
      if (userInteractTimerRef.current) clearTimeout(userInteractTimerRef.current);
      isUserInteractingRef.current = true;
    };

    const endInteraction = () => {
      if (userInteractTimerRef.current) clearTimeout(userInteractTimerRef.current);
      userInteractTimerRef.current = setTimeout(() => {
        isUserInteractingRef.current = false;
      }, 3000);
    };

    map.on('movestart', startInteraction);
    map.on('zoomstart', startInteraction);
    map.on('dragstart', startInteraction);
    map.on('moveend', endInteraction);
    map.on('zoomend', endInteraction);
    map.on('dragend', endInteraction);

    // Attach custom IndexedDB Tile Layer
    const tileLayer = new (IndexedDBTileLayer as any)(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 19,
        crossOrigin: true,
        networkEnabled: networkEnabledRef.current, // NEW
      }
    ).addTo(map);
    tileLayerRef.current = tileLayer; // NEW

    const layerGroup = L.layerGroup().addTo(map);
    layerGroupRef.current = layerGroup;
    mapInstanceRef.current = map;

    return () => {
      if (userInteractTimerRef.current) clearTimeout(userInteractTimerRef.current);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        layerGroupRef.current = null;
        tileLayerRef.current = null; // NEW
      }
    };
  }, []);

  // Map click listener using ref to avoid stale callback or effect re-binding
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      if (onMapClickRef.current) {
        onMapClickRef.current(e.latlng.lat, e.latlng.lng);
      }
    };

    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
    };
  }, []);

  // Reactive layer updates (Markers, Multi-Trajectories & Navigation Vehicle)
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();

    const bounds: [number, number][] = [];

    // Reset fit key if route is cleared
    if (!startCoords && !destCoords && (!routeCoordinates || routeCoordinates.length === 0)) {
      lastFittedRouteKeyRef.current = '';
      initialCenterFittedRef.current = false;
    }

    // 1. Start Marker (Green Circle)
    if (startCoords) {
      L.marker(startCoords, { icon: createStartIcon() })
        .bindPopup('<b>Start / Live GPS</b>')
        .addTo(layerGroup);
      bounds.push(startCoords);
      if (mode === 'explore' && !destCoords && (!routeCoordinates || !routeCoordinates.length)) {
        if (!initialCenterFittedRef.current && !isUserInteractingRef.current) {
          initialCenterFittedRef.current = true;
          map.setView(startCoords, 13);
        }
      }
    }

    // 2. Destination Marker (Red Circle - Draggable)
    if (destCoords) {
      const destMarker = L.marker(destCoords, {
        icon: createDestIcon(),
        draggable: true,
      })
        .bindPopup('<b>Destination (Drag to Reposition)</b>')
        .addTo(layerGroup);

      destMarker.on('dragend', (event: L.DragEndEvent) => {
        const target = event.target as L.Marker;
        const pos = target.getLatLng();
        if (onDestinationDragEndRef.current) {
          onDestinationDragEndRef.current(pos.lat, pos.lng);
        }
      });

      bounds.push(destCoords);
    }

    // 3. Multi-Trajectory Overlays
    // Trajectory A: Primary Fused Road Route (Solid Blue Line)
    if (showRoute && routeCoordinates && routeCoordinates.length > 0) {
      const polyline = L.polyline(routeCoordinates, {
        color: mode === 'summary' ? '#16A34A' : '#2563EB',
        weight: 6,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(layerGroup);

      if (mode !== 'navigation') {
        const routeKey = `route_${routeCoordinates.length}_${routeCoordinates[0]?.[0]}_${routeCoordinates[0]?.[1]}_${routeCoordinates[routeCoordinates.length - 1]?.[0]}_${routeCoordinates[routeCoordinates.length - 1]?.[1]}`;
        if (lastFittedRouteKeyRef.current !== routeKey) {
          lastFittedRouteKeyRef.current = routeKey;
          try {
            map.fitBounds(polyline.getBounds(), { padding: [40, 40] });
          } catch {
            // Fallback for zero bounds
          }
        }
      }
    }

    // Trajectory B: AI Dead Reckoning Path (Amber Dashed Line)
    if (deadReckoningPath && deadReckoningPath.length > 0) {
      L.polyline(deadReckoningPath, {
        color: '#CA8A04',
        weight: 4,
        dashArray: '8, 8',
        opacity: 0.95,
        lineCap: 'round',
      }).addTo(layerGroup);
    }

    // Trajectory C: Raw INS Drift Path (Red Transparent Line)
    if (rawInsPath && rawInsPath.length > 0) {
      L.polyline(rawInsPath, {
        color: '#DC2626',
        weight: 3,
        dashArray: '4, 4',
        opacity: 0.5,
        lineCap: 'round',
      }).addTo(layerGroup);
    }

    if (bounds.length === 2 && mode !== 'navigation' && (!routeCoordinates || routeCoordinates.length === 0)) {
      const pinsKey = `pins_${bounds[0][0]}_${bounds[0][1]}_${bounds[1][0]}_${bounds[1][1]}`;
      if (lastFittedRouteKeyRef.current !== pinsKey) {
        lastFittedRouteKeyRef.current = pinsKey;
        map.fitBounds(L.latLngBounds(bounds), { padding: [50, 50] });
      }
    }

    // 4. Live Vehicle Navigation Chevron Marker
    if (mode === 'navigation') {
      const pos = liveVehiclePos || startCoords;
      if (pos) {
        L.marker(pos, {
          icon: createChevronIcon(liveHeading),
          zIndexOffset: 1000,
        }).addTo(layerGroup);

        if (!isUserInteractingRef.current) {
          map.setView(pos, 16, { animate: true });
        }
      }
    }
  }, [
    mode,
    startCoords,
    destCoords,
    routeCoordinates,
    deadReckoningPath,
    rawInsPath,
    showRoute,
    liveVehiclePos,
    liveHeading,
  ]);

  // Map control helper functions
  useEffect(() => {
    (window as any).__mapZoomIn = () => {
      if (mapInstanceRef.current) mapInstanceRef.current.zoomIn();
    };
    (window as any).__mapZoomOut = () => {
      if (mapInstanceRef.current) mapInstanceRef.current.zoomOut();
    };
    (window as any).__mapRecenter = () => {
      const map = mapInstanceRef.current;
      if (!map) return;
      isUserInteractingRef.current = false;

      if (mode === 'navigation' && (liveVehiclePos || startCoords)) {
        map.setView(liveVehiclePos || startCoords!, 16);
      } else if (startCoords && destCoords) {
        map.fitBounds(L.latLngBounds([startCoords, destCoords]), { padding: [40, 40] });
      } else if (startCoords) {
        map.setView(startCoords, 13);
      }
    };
  }, [mode, startCoords, destCoords, liveVehiclePos]);

  const mapRotationAngle = cameraMode === 'head-up' ? -liveHeading : 0;

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-100">
      {/* Map Container without CSS scale or disruptive transitions */}
      <div
        ref={mapContainerRef}
        className={`w-full h-full relative z-0 ${isDarkMode ? 'brightness-75 invert contrast-125 hue-rotate-180' : ''
          }`}
        style={
          cameraMode === 'head-up' && mapRotationAngle !== 0
            ? {
              transform: `rotate(${mapRotationAngle}deg)`,
              transformOrigin: 'center center',
            }
            : undefined
        }
      />

      {/* Floating Camera Mode Badge / Quick Toggle */}
      {mode === 'navigation' && onToggleCameraMode && (
        <button
          onClick={onToggleCameraMode}
          className="absolute left-3 top-16 z-20 bg-white/95 backdrop-blur-xs border border-slate-200 shadow-md px-2.5 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-bold text-slate-800 hover:bg-slate-50 transition-all active:scale-95"
          title="Toggle Camera Orientation Mode"
        >
          <div className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
          <span>{cameraMode === 'north-up' ? 'North-Up' : 'Head-Up (Follow)'}</span>
        </button>
      )}

      {/* NEW: visible indicator when tiles are simulated offline */}
      {!networkEnabled && (
        <div className="absolute right-3 top-16 z-20 bg-slate-900/90 text-white text-[10px] font-bold px-2 py-1 rounded-full">
          Offline Tiles (Cached Only)
        </div>
      )}
    </div>
  );
};

export const MapView = React.memo(MapViewComponent);