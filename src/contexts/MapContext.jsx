import React, { createContext, useContext, useState } from 'react';

const MapContext = createContext();

export function MapProvider({ children }) {
  const [selectedNicho, setSelectedNicho] = useState(null);
  const [selectedBloque, setSelectedBloque] = useState(null);
  const [visibleLayers, setVisibleLayers] = useState({
    cementerio_general: true,
    infraestructura: true,
    bloques_geom: true,
    nichos_geom: true,
  });

  return (
    <MapContext.Provider value={{ selectedNicho, setSelectedNicho, selectedBloque, setSelectedBloque, visibleLayers, setVisibleLayers }}>
      {children}
    </MapContext.Provider>
  );
}

export function useMapContext() {
  return useContext(MapContext);
}
