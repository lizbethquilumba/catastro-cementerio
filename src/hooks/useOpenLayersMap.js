import { useEffect, useRef } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';

import { useGeographic } from 'ol/proj';
useGeographic();
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '../constants/map';

export function useOpenLayersMap({ center = DEFAULT_MAP_CENTER, zoom = DEFAULT_MAP_ZOOM, onMapReady, mapElement }) {
  const mapInstance = useRef(null);

  useEffect(() => {
    if (!mapElement || !mapElement.current) return;

    mapInstance.current = new Map({
      target: mapElement.current,
      layers: [
        new TileLayer({
          source: new OSM(),
        }),
      ],
      view: new View({
        center,
        zoom,
      }),
    });

    if (onMapReady) {
      onMapReady(mapInstance.current);
    }

    return () => {
      mapInstance.current.setTarget(null);
    };
  }, [center, zoom, onMapReady, mapElement]);
}
