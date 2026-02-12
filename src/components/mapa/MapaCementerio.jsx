import React, { useRef, useState, useEffect } from 'react';
import 'ol/ol.css';
import Overlay from 'ol/Overlay';
import { supabase } from '../../api/supabaseClient';
import { GeoJSON } from 'ol/format';
import { fromLonLat } from 'ol/proj';
import './MapaCementerio.css';

// --- CONFIGURACIÓN DEL SERVIDOR ---
// Si reinicias el túnel, SOLO CAMBIA ESTA LÍNEA con el nuevo enlace:
const GEOSERVER_URL = 'http://localhost:8080/geoserver/otavalo_cementerio';

const MapaCementerio = ({ nichoSeleccionado, bloqueSeleccionado, sectorSeleccionado, capasVisiblesEstado, estadosVisibles, alDeseleccionarNicho }) => {

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
  const capaResaltadoSectorRef = useRef(null);
  const capaResaltadoEstadosRef = useRef(null);

  const [datosPopup, setDatosPopup] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [etiquetaBloque, setEtiquetaBloque] = useState(null);
  const [inicializado, setInicializado] = useState(false);
  // modoSatelite eliminado

  // --- FUNCIÓN AUXILIAR: Obtener Extent ---


  // --- FUNCIÓN AUXILIAR DE DATOS (REUTILIZABLE) ---
  const obtenerDatosCompletoNicho = async (props) => {
    const datosFinales = { ...props };
    let bloqueEncontrado = false;

    // 1. Primero intentar obtener datos ADMINISTRATIVOS (prioridad)
    // Esto permite que si un nicho está asignado manualmente a otro bloque en la BD, se respete esa asignación
    // sobre la geometría espacial.
    if (props.codigo) {
      const { data: dbNicho } = await supabase
        .from('nichos')
        .select('bloques(nombre, codigo, bloques_geom(sector))')
        .eq('codigo', props.codigo)
        .maybeSingle();

      if (dbNicho && dbNicho.bloques) {
        datosFinales.bloque = `${dbNicho.bloques.nombre} (${dbNicho.bloques.codigo || 'S/C'})`;
        if (dbNicho.bloques.bloques_geom) {
          datosFinales.sector = dbNicho.bloques.bloques_geom.sector;
        }
        bloqueEncontrado = true;
      }
    }

    // 2. Si no se encontró administrativamente O si queremos complementar, buscamos geometría
    // Pero si ya encontramos bloque (admin), NO sobrescribimos con geometría
    if (props.codigo) {
      const { data: nichoGeom } = await supabase
        .from('nichos_geom')
        .select('bloques_geom_id')
        .eq('codigo', props.codigo)
        .maybeSingle();

      if (nichoGeom && nichoGeom.bloques_geom_id) {
        // Si ya tenemos bloque administrativo, ¿lo ignoramos? 
        // Sí, la premisa es que lo administrativo corrige a lo espacial.
        if (!bloqueEncontrado) {
          const { data: bGeom } = await supabase
            .from('bloques_geom')
            .select('nombre, sector, codigo')
            .eq('id', nichoGeom.bloques_geom_id)
            .maybeSingle();

          if (bGeom) {
            datosFinales.bloque = `${bGeom.nombre} (${bGeom.codigo})`;
            datosFinales.sector = bGeom.sector;
            bloqueEncontrado = true;
          }
        }
      }
    }

    if (props.codigo) {
      const { data: estadoData } = await supabase
        .from('nichos')
        .select('estado')
        .eq('codigo', props.codigo)
        .maybeSingle();
      if (estadoData) datosFinales.estado = estadoData.estado;
    }

    let datosDifuntoFinal = null;
    if (props.codigo) {
      let { data: nAdmin } = await supabase.from('nichos').select('id').eq('codigo', props.codigo).maybeSingle();

      if (!nAdmin) {
        const { data: nLike } = await supabase.from('nichos').select('id').ilike('codigo', props.codigo).limit(1);
        if (nLike && nLike.length > 0) nAdmin = nLike[0];
      }

      if (nAdmin) {
        const { data: rel } = await supabase
          .from('fallecido_nicho')
          .select(`fallecidos (nombres, apellidos, fecha_fallecimiento), socios (nombres, apellidos)`)
          .eq('nicho_id', nAdmin.id)
          .is('fecha_exhumacion', null)
          .order('created_at', { ascending: false });

        if (rel && rel.length > 0) {
          datosDifuntoFinal = rel;
        }
      }
    }

    if (datosDifuntoFinal && Array.isArray(datosDifuntoFinal)) {
      datosFinales.difuntos = datosDifuntoFinal.map(d => {
        const nombreResponsable = d.socios
          ? `${d.socios.nombres} ${d.socios.apellidos}`
          : 'No definido';

        return {
          nombre: `${d.fallecidos.nombres} ${d.fallecidos.apellidos}`,
          responsable: nombreResponsable
        };
      });
    } else {
      datosFinales.difuntos = [];
    }

    return datosFinales;
  };

  const cerrarNichoPopup = () => {
    setDatosPopup(null);
    if (overlayRef.current) overlayRef.current.setPosition(undefined);
    if (capaResaltadoRef.current) capaResaltadoRef.current.clear();
    if (alDeseleccionarNicho) alDeseleccionarNicho();
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
      // XYZ eliminado
      const { Style, Stroke, Fill } = await import('ol/style');

      capaResaltadoRef.current = new VectorSource();
      capaResaltadoBloqueRef.current = new VectorSource();
      capaResaltadoSectorRef.current = new VectorSource();
      capaResaltadoEstadosRef.current = new VectorSource();



      // CAPAS BASE
      // Solo OSM
      const capaOSM = new TileLayer({ source: new OSM(), zIndex: 0, visible: true });

      // SE ELIMINÓ CAPA SATELITE


      // CAPAS WMS (todas usan GEOSERVER_URL)
      // Ajuste: Cargar cementerio_general como WMS
      const capaCementerio = new TileLayer({
        source: new TileWMS({
          url: `${GEOSERVER_URL}/wms`,
          params: { 'LAYERS': 'otavalo_cementerio:cementerio_general', 'TILED': true, 'TRANSPARENT': true },
          serverType: 'geoserver'
        }),
        zIndex: 1, visible: true
      });
      const capaInfraestructura = new TileLayer({
        source: new TileWMS({ url: `${GEOSERVER_URL}/wms`, params: { 'LAYERS': 'otavalo_cementerio:infraestructura', 'TILED': true, 'TRANSPARENT': true }, serverType: 'geoserver' }),
        zIndex: 2, visible: true
      });
      const capaBloques = new TileLayer({
        source: new TileWMS({ url: `${GEOSERVER_URL}/wms`, params: { 'LAYERS': 'otavalo_cementerio:bloques_geom', 'TILED': true, 'TRANSPARENT': true }, serverType: 'geoserver' }),
        zIndex: 3, visible: true
      });
      const capaNichos = new TileLayer({
        source: new TileWMS({ url: `${GEOSERVER_URL}/wms`, params: { 'LAYERS': 'otavalo_cementerio:nichos_geom', 'TILED': true, 'TRANSPARENT': true }, serverType: 'geoserver' }),
        zIndex: 4, visible: true
      });

      Object.assign(capasRef.current, {
        cementerio_general: capaCementerio,
        infraestructura: capaInfraestructura,
        bloques_geom: capaBloques,
        nichos_geom: capaNichos
      });

      const capaVector = new VectorLayer({
        source: capaResaltadoRef.current, zIndex: 999,
        style: new Style({ stroke: new Stroke({ color: '#ef4444', width: 4 }), fill: new Fill({ color: 'rgba(239, 68, 68, 0.2)' }) })
      });
      const capaVectorBloque = new VectorLayer({
        source: capaResaltadoBloqueRef.current, zIndex: 998,
        style: new Style({ stroke: new Stroke({ color: '#8B5CF6', width: 2 }), fill: new Fill({ color: 'rgba(139, 92, 246, 0.15)' }) })
      });
      const capaVectorSector = new VectorLayer({
        source: capaResaltadoSectorRef.current, zIndex: 997,
        style: new Style({ stroke: new Stroke({ color: '#8B5CF6', width: 2.5 }), fill: new Fill({ color: 'rgba(139, 92, 246, 0.12)' }) })
      });

      const capaVectorEstados = new VectorLayer({
        source: capaResaltadoEstadosRef.current, zIndex: 990,
        style: (feature) => {
          const est = (feature.get('estado') || feature.get('ESTADO') || feature.get('Estado') || '').toLowerCase();
          const colors = {
            ocupado: { stroke: '#60a5fa', fill: 'rgba(96, 165, 250, 0.7)' },
            disponible: { stroke: '#22c55e', fill: 'rgba(34, 197, 94, 0.7)' },
            mantenimiento: { stroke: '#fbbf24', fill: 'rgba(251, 191, 36, 0.7)' },
            reservado: { stroke: '#fbbf24', fill: 'rgba(251, 191, 36, 0.7)' },
            malas: { stroke: '#991b1b', fill: 'rgba(153, 27, 27, 0.8)' }, // Rojo oscuro para malas
            malo: { stroke: '#991b1b', fill: 'rgba(153, 27, 27, 0.8)' }
          };
          const c = colors[est] || { stroke: '#94a3b8', fill: 'rgba(148, 163, 184, 0.2)' };
          return new Style({
            stroke: new Stroke({ color: c.stroke, width: 2 }),
            fill: new Fill({ color: c.fill })
          });
        }
      });

      const overlay = new Overlay({
        element: popupRef.current,
        autoPan: false,
        positioning: 'bottom-center', stopEvent: false, offset: [0, -10]
      });
      overlayRef.current = overlay;

      const { defaults: defaultControls } = await import('ol/control');

      const nuevoMapa = new Map({
        target: mapElement.current,
        layers: [capaOSM, capaCementerio, capaInfraestructura, capaBloques, capaNichos, capaVectorEstados, capaVectorSector, capaVectorBloque, capaVector],
        overlays: [overlay],
        controls: defaultControls({
          rotateOptions: { autoHide: false, tipLabel: 'Restablecer Norte' }
        }),
        view: new View({
          center: fromLonLat([-78.26549, 0.21908]), // Coordenadas exactas Cementerio Otavalo
          zoom: 19,
          minZoom: 16,
          maxZoom: 22,
          rotation: 0.34 // Ajuste fino a la izquierda
        }),
      });
      mapaRef.current = nuevoMapa;


      // SE ELIMINÓ: Ajuste automático al extent que causaba error "Cannot fit empty extent"
      // debido a problemas con la proyección de la capa cementerio_general en Geoserver.
      // Ya estamos centrando manualmente en las coordenadas correctas.

      nuevoMapa.on('singleclick', async (evt) => {
        setDatosPopup(null);
        if (overlayRef.current) overlayRef.current.setPosition(undefined);
        const source = capasRef.current.nichos_geom?.getSource();
        if (!source) return;
        const url = source.getFeatureInfoUrl(evt.coordinate, nuevoMapa.getView().getResolution(), nuevoMapa.getView().getProjection(), { 'INFO_FORMAT': 'application/json', 'FEATURE_COUNT': 1 });
        if (url) {
          try {
            // CORREGIDO: Aseguramos que GetFeatureInfo use el dominio correcto si OpenLayers genera localhost
            // Reemplazamos el dominio base por si OpenLayers usa el de la capa
            const urlSegura = url.replace(/http:\/\/localhost:8080\/geoserver/gi, GEOSERVER_URL);
            const res = await fetch(urlSegura);
            const data = await res.json();
            if (data.features && data.features.length > 0) {
              const feature = new GeoJSON().readFeature(data.features[0]);
              capaResaltadoRef.current.clear(); capaResaltadoRef.current.addFeature(feature);

              const props = data.features[0].properties;
              const datosFinales = await obtenerDatosCompletoNicho(props);
              setDatosPopup(datosFinales);
              if (overlayRef.current) overlayRef.current.setPosition(evt.coordinate);

              // AGREGADO: Zoom suave al hacer clic aka "poquito zoom"
              const view = nuevoMapa.getView();
              const currentZoom = view.getZoom();
              if (currentZoom < 22) {
                view.animate({
                  zoom: currentZoom + 1,
                  duration: 300,
                  anchor: evt.coordinate // Mantiene el punto clicado fijo bajo el mouse
                });
              }

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

  // EFECTO CAMBIO MAPA BASE ELIMINADO

  // EFECTO DE MARCADO
  useEffect(() => {
    if (!inicializado || !capasRef.current.nichos_geom || !capaResaltadoEstadosRef.current) return;

    capasRef.current.nichos_geom.getSource().updateParams({ 'CQL_FILTER': undefined });
    capaResaltadoEstadosRef.current.clear();

    if (!estadosVisibles || estadosVisibles.length === 0) return;

    const actualizarPintado = async () => {
      try {
        if (!estadosVisibles || estadosVisibles.length === 0) {
          capaResaltadoEstadosRef.current.clear();
          return;
        }

        const especificos = ['Estado_Bueno', 'Estado_Malo', 'Mantenimiento'];
        const hayEspecificos = estadosVisibles.some(e => especificos.includes(e));
        const verLibres = estadosVisibles.includes('Disponible');

        // Si SOLO está 'Ocupado' y nada más, no mostramos nada aún (pedido del usuario)
        if (estadosVisibles.length === 1 && estadosVisibles.includes('Ocupado')) {
          capaResaltadoEstadosRef.current.clear();
          return;
        }

        let filtrosOR = [];

        // 1. Manejo de 'Libre' (Disponible) -> Usualmente nichos sin dueño
        if (verLibres) {
          filtrosOR.push(`socio_id.is.null`);
        }

        // 2. Manejo de estados físicos (Sub-filtros de Ocupado)
        if (hayEspecificos) {
          // Lógica aclarada: 
          // Ocupado + Disponible(true) = Buenas
          // Ocupado + Disponible(false) = Malas

          if (estadosVisibles.includes('Estado_Bueno')) {
            // "Buenas condiciones": ocupado AND disponible=true
            // Supabase .or() filter column logic can be complex for AND across columns.
            // We'll fetch all 'ocupado' and filter client-side if needed, 
            // but let's try to be as specific as possible in the OR string if they allow complex expressions.
            // Simplified: Fetch all and filter client side.
            filtrosOR.push(`estado.ilike.ocupado`);
          }
          if (estadosVisibles.includes('Estado_Malo')) {
            // "Malas condiciones": ocupado AND disponible=false
            if (!filtrosOR.includes(`estado.ilike.ocupado`)) {
              filtrosOR.push(`estado.ilike.ocupado`);
            }
          }
          if (estadosVisibles.includes('Mantenimiento')) {
            filtrosOR.push(`estado.ilike.mantenimiento`);
          }
        }

        if (filtrosOR.length === 0) {
          capaResaltadoEstadosRef.current.clear();
          return;
        }

        const queryOR = filtrosOR.join(',');

        const { data: nichosDB, error } = await supabase
          .from('nichos')
          .select('codigo, estado, disponible, socio_id')
          .or(queryOR)
          .range(0, 2000);

        if (error) {
          console.error("Error consultando nichos:", error);
          return;
        }

        if (!nichosDB || nichosDB.length === 0) {
          capaResaltadoEstadosRef.current.clear();
          return;
        }

        // FILTRADO CLIENT-SIDE para aplicar las reglas de AND (Buenas vs Malas)
        const nichosFiltrados = nichosDB.filter(n => {
          // Si pedimos Libres
          if (verLibres && n.socio_id === null) return true;

          // Si pedimos Mantenimiento
          if (estadosVisibles.includes('Mantenimiento') && n.estado?.toLowerCase() === 'mantenimiento') return true;

          // Si pedimos Ocupados - Buenas
          if (estadosVisibles.includes('Estado_Bueno') &&
            n.estado?.toLowerCase() === 'ocupado' && n.disponible === true) return true;

          // Si pedimos Ocupados - Malas
          if (estadosVisibles.includes('Estado_Malo') &&
            n.estado?.toLowerCase() === 'ocupado' && n.disponible === false) return true;

          return false;
        });

        if (nichosFiltrados.length === 0) {
          capaResaltadoEstadosRef.current.clear();
          return;
        }

        const codigos = nichosFiltrados.map(n => n.codigo);
        const CHUNK_SIZE = 50;
        for (let i = 0; i < codigos.length; i += CHUNK_SIZE) {
          const chunk = codigos.slice(i, i + CHUNK_SIZE);
          const safeChunk = chunk.map(c => `'${c.replace(/'/g, "''")}'`);
          const filter = `codigo IN (${safeChunk.join(',')})`;

          const url = `${GEOSERVER_URL}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=otavalo_cementerio:nichos_geom&outputFormat=application/json&CQL_FILTER=${encodeURIComponent(filter)}`;

          const res = await fetch(url);
          if (!res.ok) continue;

          const data = await res.json();
          if (data.features) {
            const features = new GeoJSON().readFeatures(data, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' });
            features.forEach(f => {
              const codigoF = f.get('codigo') || f.get('CODIGO');
              const d = nichosFiltrados.find(n => n.codigo === codigoF);
              if (d) {
                let colorKey = d.estado?.toLowerCase() || '';

                // Mapeo dinámico de color según las nuevas reglas
                if (d.estado?.toLowerCase() === 'mantenimiento') {
                  colorKey = 'mantenimiento'; // Prioridad: Mantenimiento (Amarillo)
                } else if (d.socio_id === null) {
                  colorKey = 'disponible'; // Libre (Verde)
                } else if (d.estado?.toLowerCase() === 'ocupado') {
                  colorKey = d.disponible ? 'ocupado' : 'malas'; // Buenas (Rojo) vs Malas (Rojo oscuro)
                }

                f.set('estado', colorKey);
              }
            });
            capaResaltadoEstadosRef.current.addFeatures(features);
          }
        }
      } catch (e) {
        console.error("Error pintado:", e);
      }
    };

    actualizarPintado();
  }, [estadosVisibles, inicializado]);

  // ZOOM Y BUSQUEDA
  useEffect(() => {
    const nichoCodigo = nichoSeleccionado?.codigo;
    if (!inicializado || !mapaRef.current || !nichoCodigo) return;

    const doZoom = async () => {
      // CORREGIDO: URL segura
      const url = `${GEOSERVER_URL}/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=otavalo_cementerio:nichos_geom&outputFormat=application/json&CQL_FILTER=codigo='${nichoCodigo}'`;
      try {
        const r = await fetch(url);
        const d = await r.json();
        if (d.features?.length) {
          const f = new GeoJSON().readFeatures(d, { featureProjection: 'EPSG:3857' });
          capaResaltadoRef.current.clear();
          capaResaltadoRef.current.addFeatures(f);
          mapaRef.current.getView().fit(f[0].getGeometry().getExtent(), { duration: 1000, maxZoom: 21, padding: [100, 100, 100, 100] });
          const props = f[0].getProperties();
          const datosCompletos = await obtenerDatosCompletoNicho(props);
          setDatosPopup(datosCompletos);
          const extent = f[0].getGeometry().getExtent();
          overlayRef.current?.setPosition([(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2]);
        }
      } catch (e) { }
    };
    doZoom();
  }, [nichoSeleccionado?.ts, inicializado]);

  // EFECTO SECTOR
  useEffect(() => {
    if (!inicializado || !mapaRef.current) return;

    if (!sectorSeleccionado) {
      capaResaltadoSectorRef.current?.clear();
      return;
    }

    const doZoomSector = async () => {
      // CORREGIDO: URL segura
      const url = `${GEOSERVER_URL}/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=otavalo_cementerio:bloques_geom&outputFormat=application/json&CQL_FILTER=sector='${sectorSeleccionado}'`;

      try {
        const r = await fetch(url);
        const d = await r.json();

        if (d.features?.length) {
          const features = new GeoJSON().readFeatures(d, { featureProjection: 'EPSG:3857' });
          capaResaltadoSectorRef.current.clear();
          capaResaltadoSectorRef.current.addFeatures(features);

          const extent = features[0].getGeometry().getExtent();
          features.forEach(f => {
            const e = f.getGeometry().getExtent();
            import('ol/extent').then(({ extend }) => extend(extent, e));
          });

          mapaRef.current.getView().fit(extent, { duration: 1000, maxZoom: 19, padding: [50, 50, 50, 50] });
        }
      } catch (e) { console.error("Error zoom sector", e); }
    };
    doZoomSector();
  }, [sectorSeleccionado, inicializado]);

  useEffect(() => {
    if (!inicializado || !mapaRef.current || !bloqueSeleccionado) {
      if (!bloqueSeleccionado) {
        capaResaltadoBloqueRef.current?.clear();
        setEtiquetaBloque(null);
        setDatosPopup(null);
        overlayRef.current?.setPosition(undefined);
      }
      return;
    }
    capaResaltadoSectorRef.current?.clear();

    setDatosPopup(null);
    overlayRef.current?.setPosition(undefined);
    const doZoomB = async () => {
      // CORREGIDO: URL segura
      const url = `${GEOSERVER_URL}/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=otavalo_cementerio:bloques_geom&outputFormat=application/json&CQL_FILTER=codigo='${bloqueSeleccionado.codigo}'`;
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

      {/* Controles de Rotación Manual */}
      <div className="map-rotation-controls">
        <button onClick={() => {
          if (mapaRef.current) {
            const view = mapaRef.current.getView();
            view.animate({ rotation: view.getRotation() - Math.PI / 4, duration: 300 });
          }
        }} className="rotation-btn" title="Rotar Izquierda">↺</button>
        <button onClick={() => {
          if (mapaRef.current) {
            const view = mapaRef.current.getView();
            view.animate({ rotation: view.getRotation() + Math.PI / 4, duration: 300 });
          }
        }} className="rotation-btn" title="Rotar Derecha">↻</button>
      </div>

      {cargando && <div className="map-loader"><div className="spinner" /><p>Cargando mapa...</p></div>}
      <div ref={mapElement} className="mapa-cementerio-mapa" />
      <div ref={popupRef} className="map-popup" style={{ display: datosPopup ? 'block' : 'none' }}>
        <div className="popup-header">
          <span className="popup-icon">📍</span>
          <h4 className="popup-title">Nicho {datosPopup?.codigo || '-'}</h4>
          <button onClick={cerrarNichoPopup} className="popup-close">×</button>
        </div>
        {datosPopup && (
          <div className="popup-content">
            <div className="popup-state-wrapper">
              <span className="popup-label">Estado:</span>
              <span className={`state-badge state-${datosPopup.estado?.toLowerCase()}`}>{datosPopup.estado || 'DESCONOCIDO'}</span>
            </div>
            <div className="popup-grid"><div className="info-card"><span className="info-label">Bloque</span><span className="info-value">{datosPopup.bloque || 'N/A'}</span></div><div className="info-card"><span className="info-label">Sector</span><span className="info-value">{datosPopup.sector || 'N/A'}</span></div></div>
            <div className="deceased-card"><h5 className="deceased-header">🕊️ INFORMACIÓN {datosPopup.difuntos?.length > 1 ? 'DE LOS DIFUNTOS' : 'DEL DIFUNTO'}</h5>
              {datosPopup.difuntos && datosPopup.difuntos.length > 0 ? (() => {
                const responsables = [...new Set(datosPopup.difuntos.map(d => d.responsable))];
                const mismoResponsable = responsables.length === 1;

                return (
                  <>
                    {mismoResponsable && (
                      <div className="deceased-info-group" style={{ marginBottom: '10px', borderBottom: '2px solid #ffebb0', paddingBottom: '8px' }}>
                        <span className="deceased-label">Responsable (Titular)</span>
                        <span className="deceased-value" style={{ fontWeight: 'bold' }}>{responsables[0]}</span>
                      </div>
                    )}

                    {datosPopup.difuntos.map((d, i) => (
                      <div key={i} className="deceased-item-group" style={{ marginBottom: '6px', borderBottom: '1px dashed #eee', paddingBottom: '4px' }}>
                        <div className="deceased-info-group">
                          <span className="deceased-label">Difunto</span>
                          <span className="deceased-value">{d.nombre}</span>
                        </div>
                        {!mismoResponsable && (
                          <div className="deceased-info-group"><span className="deceased-label">Responsable</span><span className="deceased-value">{d.responsable}</span></div>
                        )}
                      </div>
                    ))}
                  </>
                );
              })() : (
                <div className="deceased-info-group"><span className="deceased-label">Difunto</span><span className="deceased-value">N/A</span></div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
export default MapaCementerio;