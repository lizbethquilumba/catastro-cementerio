import React, { useRef, useState, useEffect } from 'react';
import 'ol/ol.css';
import Overlay from 'ol/Overlay';
import { supabase } from '../../api/supabaseClient';
import { GeoJSON } from 'ol/format';
import { fromLonLat } from 'ol/proj';

const MapaCementerio = ({ nichoSeleccionado, bloqueSeleccionado, capasVisiblesEstado, estadosVisibles }) => {
  
  // 1. REFS Y ESTADOS
  const mapElement = useRef(null);
  const mapaRef = useRef(null);
  const popupRef = useRef(null);
  
  const capasRef = useRef({
    cementerio_general: null,
    infraestructura: null,
    bloques_geom: null,
    nichos_geom: null
  });
  
  const capaResaltadoRef = useRef(null);
  const capaResaltadoBloqueRef = useRef(null);

  const [datosPopup, setDatosPopup] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [notificacion, setNotificacion] = useState(null);
  const [etiquetaBloque, setEtiquetaBloque] = useState(null);
  const [inicializado, setInicializado] = useState(false);

  // --- FUNCIÓN AUXILIAR: Obtener Extent ---
  const obtenerExtentCementerio = async () => {
    try {
      const params = new URLSearchParams({
        service: 'WFS',
        version: '1.0.0',
        request: 'GetFeature',
        typename: 'otavalo_cementerio:cementerio_general',
        outputFormat: 'application/json',
        srsName: 'EPSG:4326',
        maxFeatures: '1'
      });

      const respuesta = await fetch(`http://localhost:8080/geoserver/otavalo_cementerio/ows?${params.toString()}`);
      if (!respuesta.ok) throw new Error(`Error ${respuesta.status}`);

      const datosGeoJSON = await respuesta.json();
      const features = new GeoJSON().readFeatures(datosGeoJSON, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857'
      });

      if (features.length > 0) {
        const geometria = features[0].getGeometry();
        if (geometria) return geometria.getExtent();
      }
    } catch (error) {
      console.warn('⚠️ No se pudo obtener extent del cementerio:', error);
    }
    return null;
  };

  // --- 1. INICIALIZACIÓN DEL MAPA ---
  useEffect(() => {
    if (mapaRef.current) return;

    const inicializarMapa = async () => {
      const Map = (await import('ol/Map')).default;
      const View = (await import('ol/View')).default;
      const TileLayer = (await import('ol/layer/Tile')).default;
      const VectorLayer = (await import('ol/layer/Vector')).default;
      const TileWMS = (await import('ol/source/TileWMS')).default;
      const VectorSource = (await import('ol/source/Vector')).default;
      const OSM = (await import('ol/source/OSM')).default;
      const { Style, Stroke, Fill } = await import('ol/style');

      capaResaltadoRef.current = new VectorSource();
      capaResaltadoBloqueRef.current = new VectorSource();

      const extentCementerio = await obtenerExtentCementerio();
      
      // CAPAS WMS
      const capaCementerio = new TileLayer({
        source: new TileWMS({
          url: 'http://localhost:8080/geoserver/wms',
          params: { 'LAYERS': 'otavalo_cementerio:cementerio_general', 'TILED': true, 'TRANSPARENT': true },
          serverType: 'geoserver',
        }),
        zIndex: 1,
        visible: true
      });

      const capaInfraestructura = new TileLayer({
        source: new TileWMS({
          url: 'http://localhost:8080/geoserver/wms',
          params: { 'LAYERS': 'otavalo_cementerio:infraestructura', 'TILED': true, 'TRANSPARENT': true },
          serverType: 'geoserver',
        }),
        zIndex: 2,
        visible: true
      });

      const capaBloques = new TileLayer({
        source: new TileWMS({
          url: 'http://localhost:8080/geoserver/wms',
          params: { 'LAYERS': 'otavalo_cementerio:bloques_geom', 'TILED': true, 'TRANSPARENT': true },
          serverType: 'geoserver',
        }),
        zIndex: 3,
        visible: true
      });

      const capaNichos = new TileLayer({
        source: new TileWMS({
          url: 'http://localhost:8080/geoserver/wms',
          params: { 'LAYERS': 'otavalo_cementerio:nichos_geom', 'TILED': true, 'TRANSPARENT': true },
          serverType: 'geoserver',
        }),
        zIndex: 4,
        visible: true
      });

      capasRef.current = {
        cementerio_general: capaCementerio,
        infraestructura: capaInfraestructura,
        bloques_geom: capaBloques,
        nichos_geom: capaNichos
      };

      // Capas de Resaltado
      const capaVector = new VectorLayer({
        source: capaResaltadoRef.current,
        zIndex: 999,
        style: new Style({
          stroke: new Stroke({ color: '#FF0000', width: 5 }),
          fill: new Fill({ color: 'rgba(255, 0, 0, 0.35)' })
        })
      });

      const capaVectorBloque = new VectorLayer({
        source: capaResaltadoBloqueRef.current,
        zIndex: 998,
        style: new Style({
          stroke: new Stroke({ color: '#8B5CF6', width: 2 }),
          fill: new Fill({ color: 'rgba(139, 92, 246, 0.15)' })
        })
      });

      // Overlay Popup
      const overlay = new Overlay({
        element: popupRef.current,
        autoPan: true,
        autoPanAnimation: { duration: 250 },
      });

      const nuevoMapa = new Map({
        target: mapElement.current,
        layers: [
          new TileLayer({ source: new OSM(), zIndex: 0 }),
          capaCementerio,
          capaInfraestructura,
          capaBloques,
          capaNichos,
          capaVectorBloque,
          capaVector
        ],
        overlays: [overlay],
        view: new View({
          center: fromLonLat([-78.271892, -0.234494]),
          zoom: 18,
          minZoom: 16,
          maxZoom: 22,
        }),
      });

      mapaRef.current = nuevoMapa;

      if (extentCementerio) {
        nuevoMapa.getView().fit(extentCementerio, {
          padding: [50, 50, 50, 50],
          maxZoom: 19
        });
      }

      // EVENTO CLICK (Popup)
      nuevoMapa.on('singleclick', async (evt) => {
        const source = capasRef.current.nichos_geom?.getSource();
        if (!source) return;
        
        const url = source.getFeatureInfoUrl(
          evt.coordinate, 
          nuevoMapa.getView().getResolution(), 
          nuevoMapa.getView().getProjection(),
          { 'INFO_FORMAT': 'application/json', 'FEATURE_COUNT': 1 }
        );

        if (url) {
          try {
            const res = await fetch(url);
            const data = await res.json();
            if (data.features?.length > 0) {
              const propiedadesNicho = data.features[0].properties;
              
              // Bloque (Supabase)
              const bloqueId = propiedadesNicho.bloques_geom_id || propiedadesNicho.bloque_id;
              if (bloqueId) {
                const { data: datosBloque } = await supabase
                  .from('bloques_geom')
                  .select('nombre, sector')
                  .eq('id', bloqueId)
                  .single();
                if (datosBloque) {
                  propiedadesNicho.bloque = datosBloque.nombre;
                  propiedadesNicho.sector = datosBloque.sector;
                }
              }

              // Difunto (Supabase)
              if (propiedadesNicho.estado?.toLowerCase() === 'ocupado') {
                const { data: datosDifunto } = await supabase
                  .from('fallecido_nicho')
                  .select(`fallecidos (nombres, apellidos, fecha_defuncion, responsable)`)
                  .eq('nicho_id', propiedadesNicho.id)
                  .limit(1)
                  .single();
                
                if (datosDifunto?.fallecidos) {
                  propiedadesNicho.difunto = {
                    nombre: `${datosDifunto.fallecidos.nombres} ${datosDifunto.fallecidos.apellidos}`,
                    fecha_defuncion: datosDifunto.fallecidos.fecha_defuncion,
                    responsable: datosDifunto.fallecidos.responsable
                  };
                }
              }
              
              setDatosPopup(propiedadesNicho);
              overlay.setPosition(evt.coordinate);
            } else {
              overlay.setPosition(undefined);
            }
          } catch (e) {
            console.error('Error al obtener info del nicho', e);
          }
        }
      });

      setInicializado(true);
      setCargando(false);
    };

    inicializarMapa();

    return () => {
      if (mapaRef.current) {
        mapaRef.current.setTarget(null);
        mapaRef.current = null;
      }
    };
  }, []); 

  // --- 2. CONTROL DE VISIBILIDAD DE CAPAS ---
  useEffect(() => {
    if (!inicializado || !capasRef.current) return;
    const capas = capasRef.current;
    
    if (capas.cementerio_general) capas.cementerio_general.setVisible(capasVisiblesEstado.cementerio_general);
    if (capas.infraestructura) capas.infraestructura.setVisible(capasVisiblesEstado.infraestructura);
    if (capas.bloques_geom) capas.bloques_geom.setVisible(capasVisiblesEstado.bloques_geom);
    if (capas.nichos_geom) capas.nichos_geom.setVisible(capasVisiblesEstado.nichos_geom);
  }, [capasVisiblesEstado, inicializado]);


  // --- 3. FILTRO DE ESTADOS (AQUÍ ESTABA EL ERROR) ---
  useEffect(() => {
    if (!inicializado || !capasRef.current.nichos_geom) return;

    const capaNichos = capasRef.current.nichos_geom;
    const source = capaNichos.getSource();

    // Si no hay nada seleccionado, ocultamos todo
    if (!estadosVisibles || estadosVisibles.length === 0) {
      source.updateParams({ 'CQL_FILTER': "1=0" });
      return;
    }

    // --- CORRECCIÓN IMPORTANTE ---
    // Tu base de datos tiene 'DISPONIBLE' (Mayúscula).
    // El menú envía 'disponible' (Minúscula).
    // Convertimos a MAYÚSCULAS antes de preguntar a GeoServer.
    const valoresFiltro = estadosVisibles
      .map(e => `'${e.toUpperCase()}'`) // <--- ESTA LÍNEA ARREGLA QUE NO APARECIERA LA CAPA
      .join(',');

    // Asumimos que la columna se llama 'estado' (como se ve en tu imagen)
    const filtroCQL = `estado IN (${valoresFiltro})`;

    console.log("🎨 Aplicando filtro (Corregido a Mayúsculas):", filtroCQL);
    
    source.updateParams({ 'CQL_FILTER': filtroCQL });

  }, [estadosVisibles, inicializado]); 


  // --- 4. ZOOM AL NICHO ---
  useEffect(() => {
    if (!inicializado || !mapaRef.current || !nichoSeleccionado) return;

    const zoomAlNicho = async () => {
      const urlWFS = `http://localhost:8080/geoserver/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=otavalo_cementerio:nichos_geom&outputFormat=application/json&CQL_FILTER=codigo='${nichoSeleccionado}'`;
      
      try {
        const res = await fetch(urlWFS);
        const data = await res.json();
        
        if (data.features?.length > 0) {
          const features = new GeoJSON().readFeatures(data, { featureProjection: 'EPSG:3857' });
          capaResaltadoRef.current.clear();
          capaResaltadoRef.current.addFeatures(features);
          
          mapaRef.current.getView().fit(features[0].getGeometry().getExtent(), { 
            duration: 1000, 
            maxZoom: 21, 
            padding: [100, 100, 100, 100] 
          });
          
          setNotificacion({ tipo: 'exito', codigo: nichoSeleccionado });
        } else {
          capaResaltadoRef.current.clear();
          setNotificacion({ tipo: 'error', codigo: nichoSeleccionado });
        }
        setTimeout(() => setNotificacion(null), 5000);
      } catch (e) { 
        console.error("Error GeoServer", e);
      }
    };
    zoomAlNicho();
  }, [nichoSeleccionado, inicializado]);

  // --- 5. ZOOM AL BLOQUE ---
  useEffect(() => {
    if (!inicializado || !mapaRef.current) return;
    
    if (!bloqueSeleccionado) {
      capaResaltadoBloqueRef.current?.clear();
      setEtiquetaBloque(null);
      return;
    }

    const zoomAlBloque = async () => {
      const urlWFS = `http://localhost:8080/geoserver/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=otavalo_cementerio:bloques_geom&outputFormat=application/json&CQL_FILTER=codigo='${bloqueSeleccionado.codigo}'`;
      
      try {
        const res = await fetch(urlWFS);
        const data = await res.json();
        
        if (data.features?.length > 0) {
          const features = new GeoJSON().readFeatures(data, { featureProjection: 'EPSG:3857' });
          capaResaltadoBloqueRef.current.clear();
          capaResaltadoBloqueRef.current.addFeatures(features);
          
          mapaRef.current.getView().fit(features[0].getGeometry().getExtent(), { 
            duration: 800, 
            maxZoom: 20, 
            padding: [80, 80, 80, 80] 
          });
          setEtiquetaBloque(bloqueSeleccionado.nombre || bloqueSeleccionado.codigo);
        }
      } catch (e) { 
        console.error("Error al obtener bloque", e);
      }
    };
    zoomAlBloque();
  }, [bloqueSeleccionado, inicializado]);

  return (
    <div className="mapa-cementerio-container">
      
      {/* ETIQUETA DE BLOQUE */}
      {etiquetaBloque && (
        <div style={{
          position: 'absolute', top: '20px', right: '20px',
          background: 'linear-gradient(135deg, #8B5CF6, #6366f1)',
          color: 'white', padding: '12px 20px', borderRadius: '12px',
          boxShadow: '0 4px 20px rgba(139, 92, 246, 0.4)', zIndex: 1000,
          display: 'flex', alignItems: 'center', gap: '10px', fontWeight: '600'
        }}>
          <span style={{ fontSize: '18px' }}>📍</span>
          <span>Bloque: {etiquetaBloque}</span>
        </div>
      )}
      
      {/* NOTIFICACIÓN */}
      {notificacion && (
        <div style={{
          position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)',
          background: notificacion.tipo === 'exito' ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'linear-gradient(135deg, #ef4444, #dc2626)',
          color: 'white', padding: '15px 25px', borderRadius: '12px', zIndex: 1001,
          display: 'flex', alignItems: 'center', gap: '10px', animation: 'slideDown 0.5s ease-out'
        }}>
          <span style={{ fontSize: '20px' }}>{notificacion.tipo === 'exito' ? '✅' : '❌'}</span>
          <span>{notificacion.tipo === 'exito' ? <>Fallecido encontrado en nicho <strong>{notificacion.codigo}</strong></> : 'No se encontró ningún fallecido'}</span>
        </div>
      )}
      
      {/* PANTALLA DE CARGA */}
      {cargando && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, color: 'white'
        }}>
          <div style={{
            width: '60px', height: '60px', border: '4px solid rgba(255,255,255,0.3)',
            borderTop: '4px solid white', borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: '20px'
          }} />
          <p style={{ fontSize: '18px', fontWeight: '500' }}>Cargando mapa...</p>
        </div>
      )}
      
      {/* CONTENEDOR DEL MAPA */}
      <div ref={mapElement} className="mapa-cementerio-mapa" />
      
      {/* POPUP ESTILIZADO (Igual a tu imagen) */}
      <div ref={popupRef} className="mapa-cementerio-popup"
        style={{
          background: 'white', padding: '0', borderRadius: '16px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)', minWidth: '260px',
          display: datosPopup ? 'block' : 'none', overflow: 'hidden',
          animation: 'fadeIn 0.2s ease-out', border: '1px solid #e0e7ff'
        }}
      >
        {/* Encabezado Morado */}
        <div style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', padding: '15px 20px', color: 'white', position: 'relative', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '18px' }}>📍</span>
          <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>Nicho {datosPopup?.codigo}</h4>
          
          <button onClick={() => {popupRef.current.style.display = 'none'; setDatosPopup(null)}} 
            style={{ position: 'absolute', top: '12px', right: '12px', border: 'none', background: 'rgba(255,255,255,0.2)', color: 'white', cursor: 'pointer', width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>×</button>
        </div>
        
        {datosPopup && (
          <div style={{ padding: '20px' }}>
             
             {/* Estado - Pill Verde/Rojo */}
             <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px', background: '#f8fafc', padding: '10px', borderRadius: '10px' }}>
                <span style={{ fontWeight: '600', color: '#64748b', fontSize: '14px' }}>Estado:</span>
                <span style={{ 
                  background: datosPopup.estado?.toUpperCase() === 'OCUPADO' ? '#ef4444' : datosPopup.estado?.toUpperCase() === 'DISPONIBLE' ? '#22c55e' : '#eab308', 
                  color: 'white', padding: '4px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)'
                }}>
                  {datosPopup.estado}
                </span>
             </div>

             {/* Bloque y Sector - Tarjetas */}
             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '15px' }}>
                <div style={{ padding: '10px', background: 'white', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                   <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>Bloque</span>
                   <span style={{ fontSize: '13px', fontWeight: '700', color: '#334155' }}>{datosPopup.bloque || 'N/A'}</span>
                </div>
                <div style={{ padding: '10px', background: 'white', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                   <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>Sector</span>
                   <span style={{ fontSize: '13px', fontWeight: '700', color: '#334155' }}>{datosPopup.sector || 'N/A'}</span>
                </div>
             </div>

             {/* Difunto - Tarjeta Amarilla */}
             <div style={{ background: '#fef9c3', borderRadius: '10px', padding: '15px', border: '1px solid #facc15' }}>
                <h5 style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#854d0e', textTransform: 'uppercase', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  🕊️ INFORMACIÓN DEL DIFUNTO
                </h5>
                
                <div style={{ marginBottom: '10px' }}>
                   <span style={{ fontSize: '11px', color: '#a16207', display: 'block', fontWeight: '600' }}>Difunto</span>
                   <span style={{ fontSize: '14px', fontWeight: '700', color: '#422006' }}>{datosPopup.difunto?.nombre || 'N/A'}</span>
                </div>
                
                <div>
                   <span style={{ fontSize: '11px', color: '#a16207', display: 'block', fontWeight: '600' }}>Responsable</span>
                   <span style={{ fontSize: '13px', fontWeight: '600', color: '#713f12' }}>{datosPopup.difunto?.responsable || 'N/A'}</span>
                </div>
             </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MapaCementerio;