import React, { useRef, useState, useEffect } from 'react';
import 'ol/ol.css';
import Overlay from 'ol/Overlay';
import { supabase } from '../../api/supabaseClient';
import { GeoJSON } from 'ol/format';
import { fromLonLat } from 'ol/proj';
import './MapaCementerio.css';

const MapaCementerio = ({ nichoSeleccionado, bloqueSeleccionado, capasVisiblesEstado, estadosVisibles }) => {

  // 1. REFS Y ESTADOS
  const mapElement = useRef(null);
  const mapaRef = useRef(null);
  const popupRef = useRef(null);
  const overlayRef = useRef(null);

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
        service: 'WFS', 'version': '1.0.0', 'request': 'GetFeature',
        'typename': 'otavalo_cementerio:cementerio_general', 'outputFormat': 'application/json',
        'srsName': 'EPSG:4326', 'maxFeatures': '1'
      });
      const respuesta = await fetch(`http://localhost:8080/geoserver/otavalo_cementerio/ows?${params.toString()}`);
      if (!respuesta.ok) throw new Error(`Error ${respuesta.status}`);
      const datosGeoJSON = await respuesta.json();
      const features = new GeoJSON().readFeatures(datosGeoJSON, {
        dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'
      });
      if (features.length > 0) return features[0].getGeometry()?.getExtent();
    } catch (e) { /* ignore */ }
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

      const capaCementerio = new TileLayer({
        source: new TileWMS({ url: 'http://localhost:8080/geoserver/wms', params: { 'LAYERS': 'otavalo_cementerio:cementerio_general', 'TILED': true, 'TRANSPARENT': true }, serverType: 'geoserver' }),
        zIndex: 1, visible: true
      });
      const capaInfraestructura = new TileLayer({
        source: new TileWMS({ url: 'http://localhost:8080/geoserver/wms', params: { 'LAYERS': 'otavalo_cementerio:infraestructura', 'TILED': true, 'TRANSPARENT': true }, serverType: 'geoserver' }),
        zIndex: 2, visible: true
      });
      const capaBloques = new TileLayer({
        source: new TileWMS({ url: 'http://localhost:8080/geoserver/wms', params: { 'LAYERS': 'otavalo_cementerio:bloques_geom', 'TILED': true, 'TRANSPARENT': true }, serverType: 'geoserver' }),
        zIndex: 3, visible: true
      });
      const capaNichos = new TileLayer({
        source: new TileWMS({ url: 'http://localhost:8080/geoserver/wms', params: { 'LAYERS': 'otavalo_cementerio:nichos_geom', 'TILED': true, 'TRANSPARENT': true }, serverType: 'geoserver' }),
        zIndex: 4, visible: true
      });

      capasRef.current = { cementerio_general: capaCementerio, infraestructura: capaInfraestructura, bloques_geom: capaBloques, nichos_geom: capaNichos };

      const capaVector = new VectorLayer({
        source: capaResaltadoRef.current, zIndex: 999,
        style: new Style({ stroke: new Stroke({ color: '#ef4444', width: 4 }), fill: new Fill({ color: 'rgba(239, 68, 68, 0.2)' }) })
      });
      const capaVectorBloque = new VectorLayer({
        source: capaResaltadoBloqueRef.current, zIndex: 998,
        style: new Style({ stroke: new Stroke({ color: '#8B5CF6', width: 2 }), fill: new Fill({ color: 'rgba(139, 92, 246, 0.15)' }) })
      });

      const overlay = new Overlay({
        element: popupRef.current,
        // CORRECCIÓN: AutoPan habilitado pero suave para asegurar visibilidad
        autoPan: {
          animation: {
            duration: 300,
          },
          margin: 20
        },
        positioning: 'bottom-center',
        stopEvent: false,
        offset: [0, -10]
      });
      overlayRef.current = overlay;

      const nuevoMapa = new Map({
        target: mapElement.current,
        layers: [new TileLayer({ source: new OSM(), zIndex: 0 }), capaCementerio, capaInfraestructura, capaBloques, capaNichos, capaVectorBloque, capaVector],
        overlays: [overlay],
        view: new View({ center: fromLonLat([-78.271892, -0.234494]), zoom: 18, minZoom: 16, maxZoom: 22 }),
      });
      mapaRef.current = nuevoMapa;

      if (extentCementerio) {
        nuevoMapa.getView().fit(extentCementerio, { padding: [50, 50, 50, 50], maxZoom: 19 });
      }

      // === LOGICA DE DATOS CON "HEURÍSTICA DE CÓDIGO B-XX" ===
      nuevoMapa.on('singleclick', async (evt) => {
        // Limpiar para UX
        setDatosPopup(null);
        if (overlayRef.current) overlayRef.current.setPosition(undefined);

        const source = capasRef.current.nichos_geom?.getSource();
        if (!source) return;

        const url = source.getFeatureInfoUrl(evt.coordinate, nuevoMapa.getView().getResolution(), nuevoMapa.getView().getProjection(), { 'INFO_FORMAT': 'application/json', 'FEATURE_COUNT': 1 });

        if (url) {
          try {
            const res = await fetch(url);
            const data = await res.json();

            if (data.features && data.features.length > 0) {
              const feature = new GeoJSON().readFeature(data.features[0]);
              capaResaltadoRef.current.clear();
              capaResaltadoRef.current.addFeature(feature);

              const props = data.features[0].properties;

              const datosFinales = { ...props };

              let bloqueEncontrado = false;

              if (props.codigo) {
                const matchCodigo = props.codigo.match(/^B(\d+)-/i);
                if (matchCodigo && matchCodigo[1]) {
                  const numeroBloque = matchCodigo[1];
                  // Formatear B-XX
                  const codigoBloqueBuscado = `B-${numeroBloque.padStart(2, '0')}`;

                  const { data: bGeom } = await supabase
                    .from('bloques_geom')
                    .select('nombre, sector')
                    .eq('codigo', codigoBloqueBuscado)
                    .maybeSingle();

                  if (bGeom) {
                    datosFinales.bloque = bGeom.nombre;
                    datosFinales.sector = bGeom.sector;
                    bloqueEncontrado = true;
                  }
                }
              }

              // Fallback admin
              if (!bloqueEncontrado && props.codigo) {
                const { data: dbNicho } = await supabase
                  .from('nichos')
                  .select('bloques(nombre, bloques_geom(sector))')
                  .eq('codigo', props.codigo)
                  .maybeSingle();

                if (dbNicho && dbNicho.bloques) {
                  datosFinales.bloque = dbNicho.bloques.nombre;
                  if (dbNicho.bloques.bloques_geom) {
                    datosFinales.sector = dbNicho.bloques.bloques_geom.sector;
                  }
                }
              }

              // Estado real
              if (props.codigo) {
                const { data: estadoData } = await supabase
                  .from('nichos')
                  .select('estado')
                  .eq('codigo', props.codigo)
                  .maybeSingle();
                if (estadoData) datosFinales.estado = estadoData.estado;
              }

              // Difunto
              let datosDifuntoFinal = null;
              if (props.codigo) {
                const { data: nAdmin } = await supabase.from('nichos').select('id').eq('codigo', props.codigo).maybeSingle();
                if (nAdmin) {
                  const { data: rel } = await supabase
                    .from('fallecido_nicho')
                    .select(`fallecidos (nombres, apellidos, fecha_defuncion, responsable)`)
                    .eq('nicho_id', nAdmin.id)
                    .maybeSingle();
                  if (rel) datosDifuntoFinal = rel;
                }
              }

              if (datosDifuntoFinal?.fallecidos) {
                datosFinales.difunto = {
                  nombre: `${datosDifuntoFinal.fallecidos.nombres} ${datosDifuntoFinal.fallecidos.apellidos}`,
                  responsable: datosDifuntoFinal.fallecidos.responsable
                };
              } else {
                datosFinales.difunto = null;
              }

              setDatosPopup(datosFinales);
              if (overlayRef.current) overlayRef.current.setPosition(evt.coordinate);

            } else {
              capaResaltadoRef.current.clear();
            }
          } catch (e) { console.error(e); }
        }
      });

      setInicializado(true);
      setCargando(false);
    };

    inicializarMapa();

    return () => {
      if (mapaRef.current) { mapaRef.current.setTarget(null); mapaRef.current = null; }
    };
  }, []);

  // --- EFECTOS AUXILIARES ---
  useEffect(() => {
    if (!inicializado || !capasRef.current) return;
    const c = capasRef.current;
    if (c.cementerio_general) c.cementerio_general.setVisible(capasVisiblesEstado.cementerio_general);
    if (c.infraestructura) c.infraestructura.setVisible(capasVisiblesEstado.infraestructura);
    if (c.bloques_geom) c.bloques_geom.setVisible(capasVisiblesEstado.bloques_geom);
    if (c.nichos_geom) c.nichos_geom.setVisible(capasVisiblesEstado.nichos_geom);
  }, [capasVisiblesEstado, inicializado]);

  useEffect(() => {
    if (!inicializado || !capasRef.current.nichos_geom) return;
    const src = capasRef.current.nichos_geom.getSource();
    if (!estadosVisibles?.length) { src.updateParams({ 'CQL_FILTER': "1=0" }); return; }
    const filtro = estadosVisibles.map(e => `'${e.toUpperCase()}'`).join(',');
    src.updateParams({ 'CQL_FILTER': `estado IN (${filtro})` });
  }, [estadosVisibles, inicializado]);

  // ZOOM Y LIMPIEZA
  useEffect(() => {
    if (!inicializado || !mapaRef.current || !nichoSeleccionado) return;

    // LIMPIAR POPUP AL BUSCAR
    setDatosPopup(null);
    if (overlayRef.current) overlayRef.current.setPosition(undefined);

    const doZoom = async () => {
      const url = `http://localhost:8080/geoserver/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=otavalo_cementerio:nichos_geom&outputFormat=application/json&CQL_FILTER=codigo='${nichoSeleccionado}'`;
      try {
        const r = await fetch(url); const d = await r.json();
        if (d.features?.length) {
          const f = new GeoJSON().readFeatures(d, { featureProjection: 'EPSG:3857' });
          capaResaltadoRef.current.clear(); capaResaltadoRef.current.addFeatures(f);
          mapaRef.current.getView().fit(f[0].getGeometry().getExtent(), { duration: 1000, maxZoom: 21, padding: [100, 100, 100, 100] });
          setNotificacion({ tipo: 'exito', codigo: nichoSeleccionado });
        } else { setNotificacion({ tipo: 'error', codigo: nichoSeleccionado }); }
        setTimeout(() => setNotificacion(null), 5000);
      } catch (e) { }
    };
    doZoom();
  }, [nichoSeleccionado, inicializado]);

  useEffect(() => {
    if (!inicializado || !mapaRef.current || !bloqueSeleccionado) {
      // LIMPIAR AL DESELECCIONAR
      if (!bloqueSeleccionado) {
        capaResaltadoBloqueRef.current?.clear();
        setEtiquetaBloque(null);
        setDatosPopup(null);
        if (overlayRef.current) overlayRef.current.setPosition(undefined);
      }
      return;
    }

    // LIMPIAR AL CAMBIAR BLOQUE
    setDatosPopup(null);
    if (overlayRef.current) overlayRef.current.setPosition(undefined);

    const doZoomB = async () => {
      const url = `http://localhost:8080/geoserver/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=otavalo_cementerio:bloques_geom&outputFormat=application/json&CQL_FILTER=codigo='${bloqueSeleccionado.codigo}'`;
      try {
        const r = await fetch(url); const d = await r.json();
        if (d.features?.length) {
          const f = new GeoJSON().readFeatures(d, { featureProjection: 'EPSG:3857' });
          capaResaltadoBloqueRef.current.clear(); capaResaltadoBloqueRef.current.addFeatures(f);
          mapaRef.current.getView().fit(f[0].getGeometry().getExtent(), { duration: 800, maxZoom: 20, padding: [80, 80, 80, 80] });
          setEtiquetaBloque(bloqueSeleccionado.nombre || bloqueSeleccionado.codigo);
        }
      } catch (e) { }
    };
    doZoomB();
  }, [bloqueSeleccionado, inicializado]);

  return (
    <div className="mapa-cementerio-container">
      {etiquetaBloque && <div className="block-label"><span>📍</span><span>Bloque: {etiquetaBloque}</span></div>}
      {notificacion && (
        <div className={`map-notification ${notificacion.tipo === 'exito' ? 'notif-success' : 'notif-error'}`}>
          <span style={{ fontSize: '20px' }}>{notificacion.tipo === 'exito' ? '✅' : '❌'}</span>
          <span>{notificacion.tipo === 'exito' ? 'Nicho ubicado' : 'No encontrado'}</span>
        </div>
      )}
      {cargando && <div className="map-loader"><div className="spinner" /><p style={{ fontSize: '18px', fontWeight: '500' }}>Cargando mapa...</p></div>}

      <div ref={mapElement} className="mapa-cementerio-mapa" />

      <div ref={popupRef} className="map-popup" style={{ display: datosPopup ? 'block' : 'none' }}>
        <div className="popup-header">
          <span className="popup-icon">📍</span>
          <h4 className="popup-title">Nicho {datosPopup?.codigo || '-'}</h4>
          <button onClick={() => { if (popupRef.current) popupRef.current.style.display = 'none'; setDatosPopup(null); capaResaltadoRef.current?.clear(); if (overlayRef.current) overlayRef.current.setPosition(undefined); }} className="popup-close">×</button>
        </div>

        {datosPopup && (
          <div className="popup-content">
            <div className="popup-state-wrapper">
              <span className="popup-label">Estado:</span>
              <span className={`state-badge state-${datosPopup.estado?.toLowerCase()}`}>{datosPopup.estado || 'DESCONOCIDO'}</span>
            </div>

            <div className="popup-grid">
              <div className="info-card">
                <span className="info-label">Bloque</span>
                <span className="info-value">{datosPopup.bloque || 'N/A'}</span>
              </div>
              <div className="info-card">
                <span className="info-label">Sector</span>
                <span className="info-value">{datosPopup.sector || 'N/A'}</span>
              </div>
            </div>

            <div className="deceased-card">
              <h5 className="deceased-header">🕊️ INFORMACIÓN DEL DIFUNTO</h5>
              <div className="deceased-info-group">
                <span className="deceased-label">Difunto</span>
                <span className="deceased-value">{datosPopup.difunto?.nombre || 'N/A'}</span>
              </div>
              <div className="deceased-info-group">
                <span className="deceased-label">Responsable</span>
                <span className="deceased-value">{datosPopup.difunto?.responsable || 'N/A'}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
export default MapaCementerio;