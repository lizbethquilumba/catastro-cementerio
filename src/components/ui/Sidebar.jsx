import React, { useState, useEffect } from 'react';
import { Search, Layers, Map as MapIcon, Eye, EyeOff, Sparkles, MapPin, Info, Navigation, Grid3X3, FileText, CheckCircle, AlertTriangle, AlertCircle, Check, X } from 'lucide-react';
import { supabase } from '../../api/supabaseClient';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import logo from '../../assets/logo.png';
import './Sidebar.css';

const Sidebar = ({
  alBuscar,
  alCambiarCapas,
  alSeleccionarBloque,
  alSeleccionarSector, // Nuevo prop
  capasConfig = [],
  className = '',
  estadosSeleccionados = [],
  alCambiarEstados
}) => {
  // --- ESTADOS ---
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [bloques, setBloques] = useState([]);
  const [bloqueActual, setBloqueActual] = useState('');
  const [sectorFiltro, setSectorFiltro] = useState(''); // Estado para filtro de mapa
  const [generandoReporte, setGenerandoReporte] = useState(false);
  const [tipoBusqueda, setTipoBusqueda] = useState('');
  const buscarFallecidos = tipoBusqueda === 'difuntos';
  const buscarSocios = tipoBusqueda === 'socios';

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
    // Comportamiento de "Radio Button": solo uno a la vez.
    if (estadosSeleccionados.includes(valor)) {
      alCambiarEstados([]); // Si clicamos el que ya está, lo quitamos
    } else {
      alCambiarEstados([valor]); // Si es nuevo, reemplazamos todo lo anterior solo con este
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
          id: b.id,
          codigo: b.codigo,
          nombre: b.nombre || b.codigo,
          sector: b.sector
        }));
        setBloques(listaBloques);

        const sectoresUnicos = [...new Set(listaBloques.map(b => b.sector).filter(Boolean))].sort();
        setSectores(sectoresUnicos);
      } catch (error) {
        console.error(error);
      }
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

    if (texto.length < 3) {
      setResultados([]);
      return;
    }

    setCargando(true);

    const terminos = texto.split(' ').filter(t => t.trim().length > 0);

    let queryFallecidos = supabase
      .from('fallecidos')
      .select(`id, nombres, apellidos, cedula, fallecido_nicho ( nichos ( codigo ), socios ( nombres, apellidos ) )`);

    let querySocios = supabase
      .from('socios')
      .select(`id, nombres, apellidos, cedula, socio_nicho ( nichos ( codigo ) )`);

    terminos.forEach(term => {
      const filtro = `nombres.ilike.%${term}%,apellidos.ilike.%${term}%,cedula.ilike.%${term}%`;
      queryFallecidos = queryFallecidos.or(filtro);
      querySocios = querySocios.or(filtro);
    });

    const [resFallecidos, resSocios] = await Promise.all([
      buscarFallecidos ? queryFallecidos.limit(5) : Promise.resolve({ data: [], error: null }),
      buscarSocios ? querySocios.limit(5) : Promise.resolve({ data: [], error: null })
    ]);

    const hitsFallecidos = (resFallecidos.data || []).flatMap(d => {
      const nichos = d.fallecido_nicho || [];
      if (nichos.length === 0) return [{
        id: `F-${d.id}`,
        tipo: 'Difunto',
        nombre: `${d.nombres} ${d.apellidos}`,
        cedula: d.cedula,
        codigo: null,
        responsable: 'No asignado'
      }];
      return nichos.map((n, i) => {
        const nombreResponsable = n.socios ? `${n.socios.nombres} ${n.socios.apellidos}` : 'Sin responsable';
        const codigoNicho = n.nichos?.codigo || '?';
        return {
          id: `F-${d.id}-${i}`,
          tipo: 'Difunto',
          nombre: `${d.nombres} ${d.apellidos}`,
          cedula: d.cedula,
          codigo: codigoNicho,
          responsable: nombreResponsable,
          nicho: codigoNicho
        };
      });
    });

    const hitsSocios = (resSocios.data || []).flatMap(d => {
      const nichos = d.socio_nicho || [];
      if (nichos.length === 0) return [{
        id: `S-${d.id}`, tipo: 'Socio', nombre: `${d.nombres} ${d.apellidos}`, cedula: d.cedula, codigo: null
      }];
      return nichos.map((n, i) => ({
        id: `S-${d.id}-${i}`,
        tipo: 'Socio',
        nombre: `${d.nombres} ${d.apellidos} (${n.nichos?.codigo || '?'})`,
        cedula: d.cedula,
        codigo: n.nichos?.codigo
      }));
    });

    // Concatenar resultados (ya son exclusivos por los checkboxes o se suman si la lógica cambia)
    // No deduplicamos por cédula para permitir ver múltiples nichos del mismo socio
    const combinados = [...hitsFallecidos, ...hitsSocios].slice(0, 7);
    setResultados(combinados);
    setCargando(false);

    if (combinados.length === 0 && texto.length >= 3) {
      setMensajeBusqueda({ tipo: 'error', texto: 'No se encontraron registros.' });
      setTimeout(() => setMensajeBusqueda(null), 3000);
    }
  };

  const seleccionarResultado = (item) => {
    if (item.codigo) {
      alBuscar(item.codigo);
    } else {
      setMensajeBusqueda({ tipo: 'warning', texto: `${item.tipo} sin nicho asignado` });
      setTimeout(() => setMensajeBusqueda(null), 3000);
    }
    setResultados([]);
    setBusqueda('');
  };

  const ubicarFallecido = async () => {
    if (busqueda.length < 3) return;
    setCargando(true);
    setMensajeBusqueda(null);

    const [resFExacta, resSExacta] = await Promise.all([
      buscarFallecidos ? supabase.from('fallecidos').select(`id, fallecido_nicho ( nichos ( codigo ) )`).eq('cedula', busqueda).maybeSingle() : Promise.resolve({ data: null, error: null }),
      buscarSocios ? supabase.from('socios').select(`id, socio_nicho ( nichos ( codigo ) )`).eq('cedula', busqueda).maybeSingle() : Promise.resolve({ data: null, error: null })
    ]);

    // Verificamos si hay múltiples nichos para la coincidencia exacta
    if (resFExacta.data) {
      const nichos = resFExacta.data.fallecido_nicho || [];
      if (nichos.length === 1 && nichos[0].nichos?.codigo) {
        navegarANicho(nichos[0].nichos.codigo); return;
      } else if (nichos.length > 1) {
        setMensajeBusqueda({ tipo: 'warning', texto: 'Difunto con múltiples nichos. Seleccione de la lista.' });
        // Dejar pasar para que se llene la lista abajo
      }
    }

    if (resSExacta.data) {
      const nichos = resSExacta.data.socio_nicho || [];
      if (nichos.length === 1 && nichos[0].nichos?.codigo) {
        navegarANicho(nichos[0].nichos.codigo); return;
      } else if (nichos.length > 1) {
        setMensajeBusqueda({ tipo: 'warning', texto: 'Socio con múltiples nichos. Seleccione de la lista.' });
        // Dejar pasar para que se llene la lista abajo
      }
    }

    const terminos = busqueda.split(' ').filter(t => t.trim().length > 0);
    let qF = supabase.from('fallecidos').select(`id, nombres, apellidos, fallecido_nicho ( nichos ( codigo ), socios ( nombres, apellidos ) )`);
    let qS = supabase.from('socios').select(`id, nombres, apellidos, socio_nicho ( nichos ( codigo ) )`);

    terminos.forEach(term => {
      const filtro = `nombres.ilike.%${term}%,apellidos.ilike.%${term}%,cedula.ilike.%${term}%`;
      qF = qF.or(filtro);
      qS = qS.or(filtro);
    });

    const [rf, rs] = await Promise.all([
      buscarFallecidos ? qF.limit(5) : Promise.resolve({ data: [], error: null }),
      buscarSocios ? qS.limit(5) : Promise.resolve({ data: [], error: null })
    ]);

    const validosF = (rf.data || []).filter(d => d.fallecido_nicho?.length > 0);
    const validosS = (rs.data || []).filter(d => d.socio_nicho?.length > 0);
    const totalEncontrados = validosF.length + validosS.length;

    if (totalEncontrados === 1) {
      const unico = validosF[0] || validosS[0];
      const nichoArr = unico.fallecido_nicho || unico.socio_nicho;
      navegarANicho(nichoArr[0].nichos.codigo);
    } else if (totalEncontrados > 1) {
      setMensajeBusqueda({ tipo: 'warning', texto: 'Múltiples resultados. Seleccione de la lista.' });
      setTimeout(() => setMensajeBusqueda(null), 4000);
    } else {
      setMensajeBusqueda({ tipo: 'error', texto: 'No se encontraron registros.' });
      setTimeout(() => setMensajeBusqueda(null), 3000);
    }
    setCargando(false);
  };

  const navegarANicho = (codigo) => {
    alBuscar(codigo);
    setCargando(false);
    setResultados([]);
    setBusqueda('');
    setMensajeBusqueda(null);
  };

  const toggleCapa = (idCapa) => {
    const nuevoEstado = { ...capasVisibles, [idCapa]: !capasVisibles[idCapa] };
    setCapasVisibles(nuevoEstado);
    alCambiarCapas(nuevoEstado);
  };

  const generarReportePDF = async () => {
    if (!sectorSeleccionado || bloquesSeleccionados.length === 0) {
      alert('Seleccione un sector y al menos un bloque.');
      return;
    }

    setGenerandoReporte(true);

    try {
      let tNichos = 0, tOcupados = 0, tDisponibles = 0, tReservados = 0;
      const detalles = [];

      for (const cod of bloquesSeleccionados) {
        let feats = [];
        // Buscamos datos del bloque en el estado local (que viene de bloques_geom)
        const bloqueGeomItem = bloques.find(b => b.codigo === cod);
        const bgId = bloqueGeomItem?.id;
        let nombreBloque = bloqueGeomItem?.nombre || cod;

        // PARCHE EXPLICITO: Espacio Verde no tiene nichos aunque la geometría diga lo contrario
        if (nombreBloque.toLowerCase().includes('espacio verde') || cod.toUpperCase().startsWith('EV')) {
          detalles.push({ nombre: nombreBloque, codigo: cod, total: 0, ocup: 0, disp: 0, resv: 0 });
          continue;
        }

        // ESTRATEGIA 1: Relación Lógica (nichos -> bloques -> bloques_geom)
        // Primero buscamos el 'bloque' lógico que apunta a este 'bloque_geom'
        // ESTRATEGIA PRIORITARIA: Consulta DIRECTA a nichos_geom usando el ID de geometría
        // La captura del usuario muestra que la relación fuerte está en nichos_geom.bloques_geom_id
        if (bgId) {
          const { data: nGeomDirecto } = await supabase
            .from('nichos_geom')
            .select('estado')
            .eq('bloques_geom_id', bgId);

          if (nGeomDirecto && nGeomDirecto.length > 0) {
            feats = nGeomDirecto;
          }
        }

        // ESTRATEGIA 3: Fallback por Texto Mejorado (Código y Nombre)
        if (feats.length === 0) {
          let num = null;
          // 1. CÓDIGO: Solo si empieza con B
          if (cod?.toUpperCase().startsWith('B')) {
            const m = cod.match(/\d+/);
            if (m) num = parseInt(m[0]);
          }

          let numName = null;
          // 2. NOMBRE: Solo si dice "Bloque"
          if (nombreBloque) {
            const m = nombreBloque.match(/Bloque\s*0*(\d+)/i);
            if (m) numName = parseInt(m[1]);
          }

          const patterns = [];

          const addPatterns = (n) => {
            if (n === null || isNaN(n)) return;
            patterns.push(`B-${n.toString().padStart(2, '0')}-%`);
            patterns.push(`B${n.toString().padStart(2, '0')}-%`);
          };

          addPatterns(num);
          if (numName !== null && numName !== num) addPatterns(numName);

          // Agregamos busqueda directa del codigo exacto por si acaso
          patterns.push(`${cod}-%`);

          if (patterns.length > 0) {
            const orQuery = patterns.map(p => `codigo.ilike.${p}`).join(',');

            // 1. Intentamos en nichos (lógica)
            const { data: nPorTexto } = await supabase
              .from('nichos')
              .select('estado')
              .or(orQuery);

            if (nPorTexto && nPorTexto.length > 0) {
              feats = nPorTexto;
            } else {
              // 2. Si falla en nichos, intentamos en nichos_geom (física) con el mismo patrón
              const { data: nPorTextoGeom } = await supabase
                .from('nichos_geom')
                .select('estado')
                .or(orQuery);
              if (nPorTextoGeom) feats = nPorTextoGeom;
            }
          }
        }

        const ocup = feats.filter(n => n.estado?.toLowerCase() === 'ocupado').length;
        const disp = feats.filter(n => n.estado?.toLowerCase() === 'disponible').length;
        // El resto se considera reservado o no disponible para venta inmediata
        const resv = feats.length - ocup - disp;

        tNichos += feats.length; tOcupados += ocup; tDisponibles += disp; tReservados += resv;

        // Agregamos al reporte incluso si está vacío (para feedback visual)
        detalles.push({ nombre: nombreBloque, codigo: cod, total: feats.length, ocup, disp, resv });
      }

      const doc = new jsPDF();
      const fecha = new Date().toLocaleDateString();

      doc.setFillColor(99, 102, 241); doc.rect(0, 0, 210, 5, 'F');
      try { doc.addImage(logo, 'PNG', 15, 10, 25, 25); } catch (e) { }

      doc.setFontSize(16); doc.setTextColor(99, 102, 241); doc.setFont('helvetica', 'bold');
      doc.text('UNORICO SAMASHUNCHIK', 105, 20, { align: 'center' });

      doc.setFontSize(10); doc.setTextColor(100); doc.setFont('helvetica', 'normal');
      doc.text('REPORTE DE OCUPACIÓN - CEMENTERIO', 105, 26, { align: 'center' });
      doc.text(`Sector: ${sectorSeleccionado} | Fecha: ${fecha}`, 105, 32, { align: 'center' });

      doc.setDrawColor(200); doc.line(15, 38, 195, 38);

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

      doc.text('Detalle por Bloque', 15, doc.lastAutoTable.finalY + 15);

      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 20,
        head: [['Bloque', 'Total', 'Ocupados', 'Disponibles', 'Reservados']],
        body: detalles.map(d => [
          `(${d.codigo}) ${d.nombre}`,
          d.total, d.ocup, d.disp, d.resv
        ]),
        theme: 'grid',
        headStyles: { fillColor: [99, 102, 241] }
      });

      doc.save(`Reporte_${sectorSeleccionado.replace(/\s+/g, '_')}.pdf`);
      setSectorSeleccionado('');
      setBloquesSeleccionados([]);
    } catch (e) {
      console.error(e);
      alert('Error generando reporte.');
    }
    setGenerandoReporte(false);
  };

  return (
    <div className={`sidebar-container ${className}`}>
      <div className="sidebar-header">
        <div className="sidebar-title">
          <img src={logo} alt="Logo" className="sidebar-logo" />
          <div>
            UNORICO SAMASHUNCHIK
            <p className="sidebar-subtitle">Otavalo - Ecuador</p>
          </div>
        </div>
      </div>

      <div className="sidebar-content">
        <section className="sidebar-section">
          <h3 className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Search size={14} /> Búsqueda
            </div>
            <div className="search-filters-header">
              <label className="search-checkbox">
                <input
                  type="checkbox"
                  checked={buscarFallecidos}
                  onChange={(e) => setTipoBusqueda(e.target.checked ? 'difuntos' : '')}
                />
                <span>Difuntos</span>
              </label>
              <label className="search-checkbox">
                <input
                  type="checkbox"
                  checked={buscarSocios}
                  onChange={(e) => setTipoBusqueda(e.target.checked ? 'socios' : '')}
                />
                <span>Socios</span>
              </label>
            </div>
          </h3>
          <div className="input-group">
            <input type="text" placeholder="Ingrese cédula o nombre" value={busqueda} onChange={manejarBusqueda} onKeyDown={(e) => e.key === 'Enter' && ubicarFallecido()} className="form-input" />
            <button onClick={ubicarFallecido} disabled={busqueda.length < 3} className="btn-primary">
              <Navigation size={16} />
            </button>
          </div>
          {mensajeBusqueda && (
            <div className={`alert-box ${mensajeBusqueda.tipo === 'error' ? 'alert-error' : 'alert-warning'}`}>
              {mensajeBusqueda.tipo === 'error' ? <AlertCircle size={14} /> : <AlertTriangle size={14} />}
              {mensajeBusqueda.texto}
            </div>
          )}
          {resultados.length > 0 && (
            <ul className="search-results">
              {resultados.map(item => (
                <li key={item.id} onClick={() => seleccionarResultado(item)} className="search-item">
                  <span className="item-name">{item.nombre}</span>
                  {/* Vista simplificada */}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="sidebar-section">
          <h3 className="section-title"><Grid3X3 size={14} /> Filtrar por Bloque</h3>

          <select
            value={sectorFiltro}
            onChange={(e) => {
              const sec = e.target.value;
              setSectorFiltro(sec);
              setBloqueActual(''); // Resetear bloque al cambiar sector
              alSeleccionarBloque(null);
              if (alSeleccionarSector) alSeleccionarSector(sec);
            }}
            className="form-select"
            style={{ marginBottom: '0.5rem' }}
          >
            <option value="">-- Seleccione un sector --</option>
            {sectores.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select value={bloqueActual} onChange={(e) => {
            const codigo = e.target.value;
            setBloqueActual(codigo);
            const b = bloques.find(x => x.codigo === codigo);
            alSeleccionarBloque(codigo ? { codigo, nombre: b?.nombre } : null);
          }} className="form-select" disabled={!sectorFiltro}>
            <option value="">-- Seleccione un bloque --</option>
            {bloques
              .filter(b => !sectorFiltro || b.sector === sectorFiltro)
              .map(b => <option key={b.codigo} value={b.codigo}>({b.codigo}) {b.nombre}</option>)}
          </select>
          {bloqueActual && (
            <button onClick={() => {
              setBloqueActual('');
              setSectorFiltro('');
              alSeleccionarBloque(null);
            }} className="btn-ghost">✕ Quitar filtro</button>
          )}
        </section>

        <section className="sidebar-section">
          <h3 className="section-title"><FileText size={14} /> Reporte por Sector</h3>
          <select value={sectorSeleccionado} onChange={(e) => setSectorSeleccionado(e.target.value)} className="form-select" style={{ marginBottom: '0.5rem' }}>
            <option value="">-- Seleccione un sector --</option>
            {sectores.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {sectorSeleccionado && (
            <div className="blocks-list">
              <div className="block-actions">
                <span>Bloques del sector</span>
                <span className="link-action" onClick={() => setBloquesSeleccionados(bloquesSeleccionados.length === bloquesDelSector.length ? [] : bloquesDelSector.map(b => b.codigo))}>
                  {bloquesSeleccionados.length === bloquesDelSector.length ? 'Deseleccionar todos' : 'Seleccionar todos'}
                </span>
              </div>
              {bloquesDelSector.map(b => (
                <label key={b.codigo} className="block-checkbox">
                  <input type="checkbox" checked={bloquesSeleccionados.includes(b.codigo)} onChange={(e) => {
                    if (e.target.checked) setBloquesSeleccionados([...bloquesSeleccionados, b.codigo]);
                    else setBloquesSeleccionados(bloquesSeleccionados.filter(x => x !== b.codigo));
                  }} />
                  ({b.codigo}) {b.nombre}
                </label>
              ))}
            </div>
          )}
          <button onClick={generarReportePDF} disabled={generandoReporte} className="btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>
            {generandoReporte ? 'Generando...' : 'Generar Reporte PDF'}
          </button>
        </section>

        <section className="sidebar-section">
          <h3 className="section-title"><Info size={14} /> Simbología de Estados</h3>
          <div className="status-card">
            <label className={`status-item ${estadosSeleccionados.includes('Disponible') ? 'active' : ''}`}>
              <input type="checkbox" checked={estadosSeleccionados.includes('Disponible')} onChange={() => toggleEstado('Disponible')} className="hidden-checkbox" />
              <div className="status-color-box" style={{ backgroundColor: estadosSeleccionados.includes('Disponible') ? '#22c55e' : 'transparent', borderColor: '#22c55e' }}>
                {estadosSeleccionados.includes('Disponible') && <Check size={12} color="white" strokeWidth={3} />}
              </div>
              <span className="status-text">Libre / Disponible</span>
            </label>
            <label className={`status-item ${estadosSeleccionados.includes('Ocupado') ? 'active' : ''}`}>
              <input type="checkbox" checked={estadosSeleccionados.includes('Ocupado')} onChange={() => toggleEstado('Ocupado')} className="hidden-checkbox" />
              <div className="status-color-box" style={{ backgroundColor: estadosSeleccionados.includes('Ocupado') ? '#ef4444' : 'transparent', borderColor: '#ef4444' }}>
                {estadosSeleccionados.includes('Ocupado') && <Check size={12} color="white" strokeWidth={3} />}
              </div>
              <span className="status-text">Ocupado</span>
            </label>
            <label className={`status-item ${estadosSeleccionados.includes('Mantenimiento') ? 'active' : ''}`}>
              <input type="checkbox" checked={estadosSeleccionados.includes('Mantenimiento')} onChange={() => toggleEstado('Mantenimiento')} className="hidden-checkbox" />
              <div className="status-color-box" style={{ backgroundColor: estadosSeleccionados.includes('Mantenimiento') ? '#fbbf24' : 'transparent', borderColor: '#fbbf24' }}>
                {estadosSeleccionados.includes('Mantenimiento') && <Check size={12} color="white" strokeWidth={3} />}
              </div>
              <span className="status-text">Mantenimiento</span>
            </label>
          </div>
        </section>

        <section className="sidebar-section">
          <h3 className="section-title"><Layers size={14} /> Capas del Mapa</h3>
          <div className="layers-list">
            {capasConfig.map(capa => (
              <div key={capa.id} onClick={() => toggleCapa(capa.id)} className={`layer-item ${capasVisibles[capa.id] ? 'active' : 'inactive'}`}>
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