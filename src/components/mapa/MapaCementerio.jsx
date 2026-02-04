import React, { useRef, useState, useEffect } from 'react';
import 'ol/ol.css';
import Overlay from 'ol/Overlay';
import { supabase } from '../../api/supabaseClient';
import { GeoJSON } from 'ol/format';
import { fromLonLat } from 'ol/proj';
import './MapaCementerio.css';

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
  const capaResaltadoSectorRef = useRef(null); // Ref para resaltar Sector
  const capaResaltadoEstadosRef = useRef(null); // Nueva ref para el marcado masivo

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

  // --- FUNCIÓN AUXILIAR DE DATOS (REUTILIZABLE) ---
  const obtenerDatosCompletoNicho = async (props) => {
    const datosFinales = { ...props };
    let bloqueEncontrado = false;

    if (props.codigo) {
      const matchCodigo = props.codigo.match(/^B(\d+)-/i);
      if (matchCodigo && matchCodigo[1]) {
        const numeroBloque = matchCodigo[1];
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
      // Intentamos buscar el nicho por código exacto
      let { data: nAdmin } = await supabase.from('nichos').select('id').eq('codigo', props.codigo).maybeSingle();

      // Si no hay match exacto, intentamos un like (por si acaso haya espacios o diferencias menores)
      if (!nAdmin) {
        const { data: nLike } = await supabase.from('nichos').select('id').ilike('codigo', props.codigo).limit(1);
        if (nLike && nLike.length > 0) nAdmin = nLike[0];
      }

      if (nAdmin) {
        // Buscamos la relación, priorizando el ocupante actual (sin fecha exhumación) y el registros más reciente
        const { data: rel } = await supabase
          .from('fallecido_nicho')
          .select(`fallecidos (nombres, apellidos, fecha_fallecimiento), socios (nombres, apellidos)`)
          .eq('nicho_id', nAdmin.id)
          .is('fecha_exhumacion', null)
          .order('created_at', { ascending: false })
          .limit(1);

        if (rel && rel.length > 0) datosDifuntoFinal = rel[0];
      }
    }

    if (datosDifuntoFinal?.fallecidos) {
      const nombreResponsable = datosDifuntoFinal.socios
        ? `${datosDifuntoFinal.socios.nombres} ${datosDifuntoFinal.socios.apellidos}`
        : 'No definido';

      datosFinales.difunto = {
        nombre: `${datosDifuntoFinal.fallecidos.nombres} ${datosDifuntoFinal.fallecidos.apellidos}`,
        responsable: nombreResponsable
      };
    } else {
      datosFinales.difunto = null;
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
      const { Style, Stroke, Fill } = await import('ol/style');

      capaResaltadoRef.current = new VectorSource();
      capaResaltadoBloqueRef.current = new VectorSource();
      capaResaltadoSectorRef.current = new VectorSource(); // Fuente para sector
      capaResaltadoEstadosRef.current = new VectorSource();

      const extentCementerio = await obtenerExtentCementerio();

      const capaCementerio = new TileLayer({
        source: new TileWMS({ url: `http://localhost:8080/geoserver/wms`, params: { 'LAYERS': 'otavalo_cementerio:cementerio_general', 'TILED': true, 'TRANSPARENT': true }, serverType: 'geoserver' }),
        zIndex: 1, visible: true
      });
      const capaInfraestructura = new TileLayer({
        source: new TileWMS({ url: `http://localhost:8080/geoserver/wms`, params: { 'LAYERS': 'otavalo_cementerio:infraestructura', 'TILED': true, 'TRANSPARENT': true }, serverType: 'geoserver' }),
        zIndex: 2, visible: true
      });
      const capaBloques = new TileLayer({
        source: new TileWMS({ url: `http://localhost:8080/geoserver/wms`, params: { 'LAYERS': 'otavalo_cementerio:bloques_geom', 'TILED': true, 'TRANSPARENT': true }, serverType: 'geoserver' }),
        zIndex: 3, visible: true
      });
      const capaNichos = new TileLayer({
        source: new TileWMS({ url: `http://localhost:8080/geoserver/wms`, params: { 'LAYERS': 'otavalo_cementerio:nichos_geom', 'TILED': true, 'TRANSPARENT': true }, serverType: 'geoserver' }),
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
      // Capa Vectorial para SECTOR (Violeta Suave)
      const capaVectorSector = new VectorLayer({
        source: capaResaltadoSectorRef.current, zIndex: 997,
        style: new Style({ stroke: new Stroke({ color: '#8B5CF6', width: 2.5 }), fill: new Fill({ color: 'rgba(139, 92, 246, 0.12)' }) })
      });

      const capaVectorEstados = new VectorLayer({
        source: capaResaltadoEstadosRef.current, zIndex: 990,
        style: (feature) => {
          const est = (feature.get('estado') || feature.get('ESTADO') || feature.get('Estado') || '').toLowerCase();
          const colors = {
            ocupado: { stroke: '#ef4444', fill: 'rgba(239, 68, 68, 0.7)' },
            disponible: { stroke: '#22c55e', fill: 'rgba(34, 197, 94, 0.7)' },
            mantenimiento: { stroke: '#fbbf24', fill: 'rgba(251, 191, 36, 0.7)' },
            reservado: { stroke: '#fbbf24', fill: 'rgba(251, 191, 36, 0.7)' }
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
        autoPan: { animation: { duration: 300 }, margin: 20 },
        positioning: 'bottom-center', stopEvent: false, offset: [0, -10]
      });
      overlayRef.current = overlay;

      const nuevoMapa = new Map({
        target: mapElement.current,
        layers: [new TileLayer({ source: new OSM(), zIndex: 0 }), capaCementerio, capaInfraestructura, capaBloques, capaNichos, capaVectorEstados, capaVectorSector, capaVectorBloque, capaVector],
        overlays: [overlay],
        view: new View({ center: fromLonLat([-78.271892, -0.234494]), zoom: 18, minZoom: 16, maxZoom: 22 }),
      });
      mapaRef.current = nuevoMapa;

      if (extentCementerio) {
        nuevoMapa.getView().fit(extentCementerio, { padding: [50, 50, 50, 50], maxZoom: 19 });
      }

      nuevoMapa.on('singleclick', async (evt) => {
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
              capaResaltadoRef.current.clear(); capaResaltadoRef.current.addFeature(feature);
              const props = data.features[0].properties;
              const datosFinales = await obtenerDatosCompletoNicho(props);
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

  // EFECTO DE MARCADO (Sincronizado con Supabase para datos siempre frescos)
  useEffect(() => {
    if (!inicializado || !capasRef.current.nichos_geom || !capaResaltadoEstadosRef.current) return;

    capasRef.current.nichos_geom.getSource().updateParams({ 'CQL_FILTER': undefined });
    capaResaltadoEstadosRef.current.clear();

    if (!estadosVisibles || estadosVisibles.length === 0) return;

    const actualizarPintado = async () => {
      try {
        const nichosFinales = [];

        // 1. Estados de Negocio: OCUPADO y MANTENIMIENTO se leen de la tabla 'nichos'
        const estadosNegocio = estadosVisibles.filter(e => {
          const el = e.toLowerCase();
          return el === 'ocupado' || el === 'mantenimiento';
        });

        if (estadosNegocio.length > 0) {
          const variants = estadosNegocio.flatMap(e => [e, e.toUpperCase(), e.toLowerCase()]);
          const { data: desc } = await supabase
            .from('nichos')
            .select('codigo, estado')
            .in('estado', variants);
          if (desc) nichosFinales.push(...desc);
        }

        // 2. Estado Físico: DISPONIBLE se lee de 'nichos_geom', PERO validando que no esté ocupado administrativamente
        if (estadosVisibles.some(e => e.toLowerCase() === 'disponible')) {
          // A. Buscamos "Lista Negra": Nichos que administrativamente NO están disponibles
          // Aumentamos el rango para traer TODOS (por defecto supabase trae solo 1000)
          const { data: ocupadosAdmin } = await supabase
            .from('nichos')
            .select('codigo')
            .or('estado.ilike.ocupado,estado.ilike.mantenimiento')
            .range(0, 29999);

          const setOcupados = new Set(ocupadosAdmin?.map(o => o.codigo));

          // B. Buscamos TODOS los nichos del mapa (Físicos)
          // Asumimos que todo lo dibujado es un nicho potencial.
          // Quitamos el filtro de texto 'Disponible' para abarcar todo lo que no esté ocupado.
          const { data: geomData } = await supabase
            .from('nichos_geom')
            .select('codigo') // No necesitamos estado de la geom, forzaremos Disponible
            .range(0, 29999);

          // C. Filtramos: Geometría - Lista Negra
          if (geomData) {
            const filtrados = geomData.filter(g => !setOcupados.has(g.codigo));
            // Forzamos el estado para que el pintor sepa que es Verde
            const conEstado = filtrados.map(f => ({ codigo: f.codigo, estado: 'Disponible' }));
            nichosFinales.push(...conEstado);
          }
        }

        const nichosDB = nichosFinales; // Mantenemos nombre de variable anterior para no romper abajo

        if (!nichosDB || nichosDB.length === 0) return;

        const codigos = nichosDB.map(n => n.codigo);

        // Dividimos en bloques para el WFS (Reducido a 50 para evitar URLs muy largas)
        const CHUNK_SIZE = 50;
        for (let i = 0; i < codigos.length; i += CHUNK_SIZE) {
          const chunk = codigos.slice(i, i + CHUNK_SIZE);
          const filter = `codigo IN (${chunk.map(c => `'${c}'`).join(',')})`;
          const url = `http://localhost:8080/geoserver/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=otavalo_cementerio:nichos_geom&outputFormat=application/json&CQL_FILTER=${encodeURIComponent(filter)}`;

          const res = await fetch(url);
          if (!res.ok) continue;

          const data = await res.json();
          if (data.features) {
            const features = new GeoJSON().readFeatures(data, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' });
            features.forEach(f => {
              const codigoF = f.get('codigo') || f.get('CODIGO');
              const d = nichosDB.find(n => n.codigo === codigoF);
              if (d) f.set('estado', d.estado);
            });
            capaResaltadoEstadosRef.current.addFeatures(features);
          }
        }
      } catch (e) {
        console.error("Error pìntado:", e);
      }
    };

    actualizarPintado();
  }, [estadosVisibles, inicializado]);

  // ZOOM Y BUSQUEDA
  useEffect(() => {
    const nichoCodigo = nichoSeleccionado?.codigo;
    if (!inicializado || !mapaRef.current || !nichoCodigo) return;

    const doZoom = async () => {
      const url = `http://localhost:8080/geoserver/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=otavalo_cementerio:nichos_geom&outputFormat=application/json&CQL_FILTER=codigo='${nichoCodigo}'`;
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
      // Consultamos TODOS los bloques que pertenezcan a ese sector
      // La capa es bloques_geom, columna sector
      const url = `http://localhost:8080/geoserver/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=otavalo_cementerio:bloques_geom&outputFormat=application/json&CQL_FILTER=sector='${sectorSeleccionado}'`;

      try {
        const r = await fetch(url);
        const d = await r.json();

        if (d.features?.length) {
          const features = new GeoJSON().readFeatures(d, { featureProjection: 'EPSG:3857' });
          capaResaltadoSectorRef.current.clear();
          capaResaltadoSectorRef.current.addFeatures(features);

          // Calcular extent total de todos los bloques
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
    // Si seleccionamos bloque específico, podríamos limpiar el sector o mantenerlo.
    // Usuario pidió explícitamente: "una vez que selecciona el bloque ya se desmarque el sector"
    capaResaltadoSectorRef.current?.clear();

    setDatosPopup(null);
    overlayRef.current?.setPosition(undefined);
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
            <div className="deceased-card"><h5 className="deceased-header">🕊️ INFORMACIÓN DEL DIFUNTO</h5><div className="deceased-info-group"><span className="deceased-label">Difunto</span><span className="deceased-value">{datosPopup.difunto?.nombre || 'N/A'}</span></div><div className="deceased-info-group"><span className="deceased-label">Responsable</span><span className="deceased-value">{datosPopup.difunto?.responsable || 'N/A'}</span></div></div>
          </div>
        )}
      </div>
    </div>
  );
};
export default MapaCementerio;