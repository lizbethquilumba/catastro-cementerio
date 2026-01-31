import React, { useState, useEffect } from 'react';
import { Search, Layers, Map as MapIcon, Eye, EyeOff, Sparkles, MapPin, Info, Navigation, Grid3X3, FileText, CheckCircle, AlertTriangle, AlertCircle, Check } from 'lucide-react';
import { supabase } from '../../api/supabaseClient';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import logo from '../../assets/logo.png';
import './Sidebar.css';

const Sidebar = ({
  alBuscar,
  alCambiarCapas,
  alSeleccionarBloque,
  capasConfig,
  className,
  estadosSeleccionados = [],
  alCambiarEstados
}) => {
  // --- ESTADOS ---
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [bloques, setBloques] = useState([]);
  const [bloqueActual, setBloqueActual] = useState('');
  const [generandoReporte, setGenerandoReporte] = useState(false);

  const [sectores, setSectores] = useState([]);
  const [sectorSeleccionado, setSectorSeleccionado] = useState('');
  const [bloquesDelSector, setBloquesDelSector] = useState([]);
  const [bloquesSeleccionados, setBloquesSeleccionados] = useState([]);

  const [capasVisibles, setCapasVisibles] = useState({
    'cementerio_general': true,
    'infraestructura': true,
    'bloques_geom': true,
    'nichos_geom': true
  });
  const [mensajeBusqueda, setMensajeBusqueda] = useState(null);

  // --- LÓGICA DE SIMBOLOGÍA (COLORES) ---
  const toggleEstado = (valor) => {
    if (estadosSeleccionados.includes(valor)) {
      alCambiarEstados(estadosSeleccionados.filter(e => e !== valor));
    } else {
      alCambiarEstados([...estadosSeleccionados, valor]);
    }
  };

  // --- CARGAR DATOS INICIALES (BLOQUES) ---
  useEffect(() => {
    const cargarBloques = async () => {
      try {
        const { data: bloquesDB, error } = await supabase
          .from('bloques_geom')
          .select('id, codigo, nombre, sector')
          .order('codigo');

        if (error) {
          console.error('Error cargando bloques:', error);
          return;
        }

        const listaBloques = bloquesDB.map(b => ({
          id: b.id, codigo: b.codigo, nombre: b.nombre || b.codigo, sector: b.sector
        }));
        setBloques(listaBloques);
        const sectoresUnicos = [...new Set(listaBloques.map(b => b.sector).filter(Boolean))].sort();
        setSectores(sectoresUnicos);
      } catch (error) { console.error(error); }
    };
    cargarBloques();
  }, []);

  // Filtrar bloques cuando cambia el sector
  useEffect(() => {
    if (sectorSeleccionado) {
      const bloquesFiltrados = bloques.filter(b => b.sector === sectorSeleccionado);
      setBloquesDelSector(bloquesFiltrados);
      setBloquesSeleccionados([]);
    } else {
      setBloquesDelSector([]);
      setBloquesSeleccionados([]);
    }
  }, [sectorSeleccionado, bloques]);

  // --- FUNCIONES DEL BUSCADOR ---
  const manejarBusqueda = async (e) => {
    const texto = e.target.value;
    setBusqueda(texto);
    setMensajeBusqueda(null);

    if (texto.length < 3) { setResultados([]); return; }

    setCargando(true);
    const { data } = await supabase
      .from('fallecidos')
      .select(`id, nombres, apellidos, cedula, fallecido_nicho ( nichos ( codigo ) )`)
      .or(`nombres.ilike.%${texto}%,apellidos.ilike.%${texto}%,cedula.ilike.%${texto}%`)
      .limit(5);

    const formateados = data ? data.map(d => ({
      id: d.id,
      nombre: `${d.nombres} ${d.apellidos}`,
      cedula: d.cedula,
      codigo: d.fallecido_nicho?.[0]?.nichos?.codigo || null
    })) : [];

    setResultados(formateados);
    setCargando(false);

    if (formateados.length === 0 && texto.length >= 3) {
      setMensajeBusqueda({ tipo: 'error', texto: 'No se encontró coincidencia' });
      setTimeout(() => setMensajeBusqueda(null), 3000);
    }
  };

  const seleccionarResultado = (item) => {
    if (item.codigo) {
      alBuscar(item.codigo);
      setResultados([]);
      setBusqueda(item.cedula);
    } else {
      setMensajeBusqueda({ tipo: 'warning', texto: `${item.nombre} no tiene nicho asignado` });
      setTimeout(() => setMensajeBusqueda(null), 3000);
    }
  };

  const ubicarFallecido = async () => {
    if (busqueda.length < 3) return;
    setCargando(true);
    const { data } = await supabase
      .from('fallecidos')
      .select(`id, nombres, apellidos, cedula, fallecido_nicho ( nichos ( codigo ) )`)
      .eq('cedula', busqueda)
      .limit(1);

    if (data && data.length > 0) {
      const fallecido = data[0];
      const codigo = fallecido.fallecido_nicho?.[0]?.nichos?.codigo;
      if (codigo) {
        alBuscar(codigo);
        setMensajeBusqueda({ tipo: 'exito', texto: 'Ubicado correctamente' });
      } else {
        setMensajeBusqueda({ tipo: 'warning', texto: 'Fallecido sin nicho registrado' });
      }
    } else {
      setMensajeBusqueda({ tipo: 'error', texto: 'Cédula no encontrada' });
    }
    setCargando(false);
    setTimeout(() => setMensajeBusqueda(null), 3000);
  };

  // --- LÓGICA DE CAPAS ---
  const toggleCapa = (nombreCapa) => {
    const nuevoEstado = { ...capasVisibles, [nombreCapa]: !capasVisibles[nombreCapa] };
    setCapasVisibles(nuevoEstado);
    alCambiarCapas(nuevoEstado);
  };

  // --- GENERACIÓN DE PDF ---
  const generarReportePDF = async () => {
    if (!sectorSeleccionado || bloquesSeleccionados.length === 0) {
      alert('Seleccione un sector y al menos un bloque.');
      return;
    }

    setGenerandoReporte(true);

    try {
      // 1. Obtener IDs de GeoServer para los bloques
      const bloquesParams = new URLSearchParams({
        service: 'WFS', version: '1.0.0', request: 'GetFeature',
        typename: 'otavalo_cementerio:bloques_geom', outputFormat: 'application/json'
      });
      const resB = await fetch(`http://localhost:8080/geoserver/otavalo_cementerio/ows?${bloquesParams}`);
      const dataB = await resB.json();

      const mapaIds = {};
      dataB.features.forEach(f => {
        mapaIds[f.properties.codigo] = f.id.split('.')[1];
      });

      // 2. Iterar bloques seleccionados y contar
      let tNichos = 0, tOcupados = 0, tDisponibles = 0, tReservados = 0;
      const detalles = [];

      for (const cod of bloquesSeleccionados) {
        const geoId = mapaIds[cod];
        if (!geoId) continue;

        const params = new URLSearchParams({
          service: 'WFS', version: '1.0.0', request: 'GetFeature',
          typename: 'otavalo_cementerio:nichos_geom', outputFormat: 'application/json',
          CQL_FILTER: `bloques_geom_id=${geoId}`
        });

        const resN = await fetch(`http://localhost:8080/geoserver/otavalo_cementerio/ows?${params}`);
        const dataN = await resN.json();
        const feats = dataN.features || [];

        const ocup = feats.filter(n => n.properties.estado?.toLowerCase() === 'ocupado').length;
        const disp = feats.filter(n => n.properties.estado?.toLowerCase() === 'disponible').length;
        const resv = feats.length - ocup - disp;

        tNichos += feats.length; tOcupados += ocup; tDisponibles += disp; tReservados += resv;

        const nombreBloque = bloques.find(b => b.codigo === cod)?.nombre || cod;
        detalles.push({ nombre: nombreBloque, codigo: cod, total: feats.length, ocup, disp, resv });
      }

      // 3. Crear PDF
      const doc = new jsPDF();
      const fecha = new Date().toLocaleDateString();

      // Encabezado
      doc.setFillColor(99, 102, 241); doc.rect(0, 0, 210, 5, 'F');
      try { doc.addImage(logo, 'PNG', 15, 10, 25, 25); } catch (e) { }

      doc.setFontSize(16); doc.setTextColor(99, 102, 241); doc.setFont('helvetica', 'bold');
      doc.text('UNORICO SAMASHUNCHIC', 105, 20, { align: 'center' });

      doc.setFontSize(10); doc.setTextColor(100); doc.setFont('helvetica', 'normal');
      doc.text('REPORTE DE OCUPACIÓN - CEMENTERIO', 105, 26, { align: 'center' });
      doc.text(`Sector: ${sectorSeleccionado} | Fecha: ${fecha}`, 105, 32, { align: 'center' });

      doc.setDrawColor(200); doc.line(15, 38, 195, 38);

      // Tabla Resumen
      let y = 50;
      doc.setFontSize(12); doc.setTextColor(0); doc.setFont('helvetica', 'bold');
      doc.text('Resumen Total', 15, y);

      y += 8;
      autoTable(doc, {
        startY: y,
        head: [['Estado', 'Cantidad', 'Porcentaje']],
        body: [
          ['Ocupados', tOcupados, tNichos > 0 ? ((tOcupados / tNichos) * 100).toFixed(1) + '%' : '0%'],
          ['Disponibles', tDisponibles, tNichos > 0 ? ((tDisponibles / tNichos) * 100).toFixed(1) + '%' : '0%'],
          ['Reservados', tReservados, tNichos > 0 ? ((tReservados / tNichos) * 100).toFixed(1) + '%' : '0%'],
          ['TOTAL', tNichos, '100%']
        ],
        theme: 'grid',
        headStyles: { fillColor: [99, 102, 241] }
      });

      // Tabla Detalle
      doc.text('Detalle por Bloque', 15, doc.lastAutoTable.finalY + 15);

      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 20,
        head: [['Bloque', 'Total', 'Ocupados', 'Disponibles', 'Reservados']],
        body: detalles.map(d => [
          `${d.nombre} (${d.codigo})`,
          d.total, d.ocup, d.disp, d.resv
        ]),
        theme: 'grid',
        headStyles: { fillColor: [99, 102, 241] }
      });

      doc.save(`Reporte_${sectorSeleccionado.replace(/\s+/g, '_')}.pdf`);

    } catch (e) {
      console.error(e);
      alert('Error generando reporte. Revise la consola.');
    }
    setGenerandoReporte(false);
  };

  return (
    <div className={`sidebar-container ${className}`}>

      {/* HEADER */}
      <div className="sidebar-header">
        <div className="sidebar-title">
          <img src={logo} alt="Logo" className="sidebar-logo" />
          <div>
            SAMASHUNCHIK
            <p className="sidebar-subtitle">Otavalo - Ecuador</p>
          </div>
        </div>
      </div>

      <div className="sidebar-content">

        {/* BUSCADOR */}
        <section className="sidebar-section">
          <h3 className="section-title">
            <Search size={14} /> Búsqueda
          </h3>
          <div className="input-group">
            <input
              type="text"
              placeholder="Ingrese cédula o nombre"
              value={busqueda}
              onChange={manejarBusqueda}
              className="form-input"
            />
            <button onClick={ubicarFallecido} disabled={busqueda.length < 3} className="btn-primary">
              <Navigation size={16} />
            </button>
          </div>

          {mensajeBusqueda && (
            <div className={`alert-box ${mensajeBusqueda.tipo === 'error' ? 'alert-error' :
                mensajeBusqueda.tipo === 'warning' ? 'alert-warning' : 'alert-success'
              }`}>
              {mensajeBusqueda.tipo === 'error' ? <AlertCircle size={14} /> :
                mensajeBusqueda.tipo === 'warning' ? <AlertTriangle size={14} /> : <CheckCircle size={14} />}
              {mensajeBusqueda.texto}
            </div>
          )}

          {resultados.length > 0 && (
            <ul className="search-results">
              {resultados.map(item => (
                <li key={item.id} onClick={() => seleccionarResultado(item)} className="search-item">
                  <span className="item-name">{item.nombre}</span>
                  <span className="item-meta">{item.cedula}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* FILTRO BLOQUE */}
        <section className="sidebar-section">
          <h3 className="section-title">
            <Grid3X3 size={14} /> Filtrar por Bloque
          </h3>
          <select
            value={bloqueActual}
            onChange={(e) => {
              const codigo = e.target.value;
              setBloqueActual(codigo);
              const b = bloques.find(x => x.codigo === codigo);
              alSeleccionarBloque(codigo ? { codigo, nombre: b?.nombre } : null);
            }}
            className="form-select"
          >
            <option value="">-- Seleccione un bloque --</option>
            {bloques.map(b => (
              <option key={b.codigo} value={b.codigo}>
                {b.nombre} ({b.codigo})
              </option>
            ))}
          </select>

          {bloqueActual && (
            <button onClick={() => { setBloqueActual(''); alSeleccionarBloque(null); }} className="btn-ghost">
              ✕ Quitar filtro
            </button>
          )}
        </section>

        {/* REPORTE */}
        <section className="sidebar-section">
          <h3 className="section-title">
            <FileText size={14} /> Reporte por Sector
          </h3>
          <select
            value={sectorSeleccionado}
            onChange={(e) => setSectorSeleccionado(e.target.value)}
            className="form-select"
            style={{ marginBottom: '0.5rem' }}
          >
            <option value="">-- Seleccione un sector --</option>
            {sectores.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          {sectorSeleccionado && (
            <div className="blocks-list">
              <div className="block-actions">
                <span>Bloques del sector</span>
                <span className="link-action"
                  onClick={() => setBloquesSeleccionados(bloquesSeleccionados.length === bloquesDelSector.length ? [] : bloquesDelSector.map(b => b.codigo))}>
                  {bloquesSeleccionados.length === bloquesDelSector.length ? 'Deseleccionar todos' : 'Seleccionar todos'}
                </span>
              </div>
              {bloquesDelSector.map(b => (
                <label key={b.codigo} className="block-checkbox">
                  <input type="checkbox" checked={bloquesSeleccionados.includes(b.codigo)}
                    onChange={(e) => {
                      if (e.target.checked) setBloquesSeleccionados([...bloquesSeleccionados, b.codigo]);
                      else setBloquesSeleccionados(bloquesSeleccionados.filter(x => x !== b.codigo));
                    }} />
                  {b.nombre} ({b.codigo})
                </label>
              ))}
            </div>
          )}

          <button onClick={generarReportePDF} disabled={generandoReporte} className="btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>
            {generandoReporte ? 'Generando...' : 'Generar Reporte PDF'}
          </button>
        </section>

        {/* SIMBOLOGÍA (CHECKBOXES COLORES) */}
        <section className="sidebar-section">
          <h3 className="section-title"><Info size={14} /> Simbología de Estados</h3>
          <div className="status-card">

            {/* OPCIÓN: DISPONIBLE */}
            <label className={`status-item ${estadosSeleccionados.includes('Disponible') ? 'active' : ''}`}>
              <input
                type="checkbox"
                checked={estadosSeleccionados.includes('Disponible')}
                onChange={() => toggleEstado('Disponible')}
                className="hidden-checkbox" // Clase para ocultar
              />
              <div className="status-color-box" style={{
                backgroundColor: estadosSeleccionados.includes('Disponible') ? '#22c55e' : 'transparent',
                borderColor: '#22c55e'
              }}>
                {estadosSeleccionados.includes('Disponible') && <Check size={12} color="white" strokeWidth={3} />}
              </div>
              <span className="status-text">Libre / Disponible</span>
            </label>

            {/* OPCIÓN: OCUPADO */}
            <label className={`status-item ${estadosSeleccionados.includes('Ocupado') ? 'active' : ''}`}>
              <input
                type="checkbox"
                checked={estadosSeleccionados.includes('Ocupado')}
                onChange={() => toggleEstado('Ocupado')}
                className="hidden-checkbox"
              />
              <div className="status-color-box" style={{
                backgroundColor: estadosSeleccionados.includes('Ocupado') ? '#ef4444' : 'transparent',
                borderColor: '#ef4444'
              }}>
                {estadosSeleccionados.includes('Ocupado') && <Check size={12} color="white" strokeWidth={3} />}
              </div>
              <span className="status-text">Ocupado</span>
            </label>

            {/* OPCIÓN: RESERVADO */}
            <label className={`status-item ${estadosSeleccionados.includes('Reservado') ? 'active' : ''}`}>
              <input
                type="checkbox"
                checked={estadosSeleccionados.includes('Reservado')}
                onChange={() => toggleEstado('Reservado')}
                className="hidden-checkbox"
              />
              <div className="status-color-box" style={{
                backgroundColor: estadosSeleccionados.includes('Reservado') ? '#eab308' : 'transparent',
                borderColor: '#eab308'
              }}>
                {estadosSeleccionados.includes('Reservado') && <Check size={12} color="white" strokeWidth={3} />}
              </div>
              <span className="status-text">Reservado</span>
            </label>

          </div>
        </section>

        {/* CAPAS */}
        <section className="sidebar-section">
          <h3 className="section-title"><Layers size={14} /> Capas del Mapa</h3>
          <div className="layers-list">
            {capasConfig.map(capa => (
              <div key={capa.id} onClick={() => toggleCapa(capa.id)}
                className={`layer-item ${capasVisibles[capa.id] ? 'active' : 'inactive'}`}>
                {capasVisibles[capa.id] ? <Eye size={16} /> : <EyeOff size={16} />}
                <span>{capa.nombre}</span>
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
};

export default Sidebar;