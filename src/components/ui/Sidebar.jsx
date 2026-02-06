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
  // --- LÓGICA DE SIMBOLOGÍA (COLORES) ---
  const toggleEstado = (valor) => {
    // Grupo Superior: Ocupado / Disponible. Exclusivo entre ellos, pero respeta los de abajo.
    const grupoTop = ['Ocupado', 'Disponible'];

    // 1. Quitar otros del mismo grupo top
    let nuevos = estadosSeleccionados.filter(e => !grupoTop.includes(e));

    // 2. LOGICA DE SELECCION / DESELECCION
    if (!estadosSeleccionados.includes(valor)) {
      // --- SELECCIONAR (Toggle ON) ---
      // Agregamos el nuevo valor Top
      nuevos.push(valor);

      // Si cambio de Ocupado a Disponible, debo limpiar los hijos de Ocupado (Malo, Mantenimiento)
      // Si cambio de Disponible a Ocupado, debo limpiar los hijos de Disponible (Bueno)
      // Como ya limpié 'grupoTop' en el paso 1, solo quedan los Bottom del estado anterior.
      // Debemos verificar si son compatibles con el NUEVO valor.

      if (valor === 'Ocupado') {
        // Nuevo es Ocupado -> Eliminar incompatibles (Bueno)
        nuevos = nuevos.filter(e => e !== 'Estado_Bueno');
      } else if (valor === 'Disponible') {
        // Nuevo es Disponible -> Eliminar incompatibles (Malo, Mantenimiento)
        nuevos = nuevos.filter(e => !['Estado_Malo', 'Mantenimiento'].includes(e));
      }

    } else {
      // --- DESELECCIONAR (Toggle OFF) ---
      // Si quito el check de arriba, debo limpiar TODOS sus hijos dependientes
      if (valor === 'Ocupado') {
        nuevos = nuevos.filter(e => !['Estado_Malo', 'Mantenimiento'].includes(e));
      } else if (valor === 'Disponible') {
        nuevos = nuevos.filter(e => e !== 'Estado_Bueno');
      }
    }
    alCambiarEstados(nuevos);
  };

  const toggleEstadoFisico = (valor) => {
    // Grupo Inferior: Estado_Bueno / Estado_Malo / Mantenimiento. Exclusivo entre ellos.
    const grupoFisico = ['Estado_Bueno', 'Estado_Malo', 'Mantenimiento'];

    // 1. Quitar otros del grupo fisico (EXCLUSIVIDAD)
    let nuevos = estadosSeleccionados.filter(e => !grupoFisico.includes(e));

    // 2. Agregar el nuevo si no estaba (TOGGLE)
    if (!estadosSeleccionados.includes(valor)) {
      nuevos.push(valor);
    }

    // 3. SINCRONIZACIÓN CON GRUPO TOP (Permanencia visual)
    // El usuario quiere que "Ocupado" permanezca seleccionado si elige opciones de abajo.
    // Forzamos "Ocupado" o "Disponible" arriba según lo que se elija abajo.

    const grupoTop = ['Ocupado', 'Disponible'];
    nuevos = nuevos.filter(e => !grupoTop.includes(e)); // Limpiamos Top actual para re-asignar el correcto

    if (valor === 'Estado_Malo' || valor === 'Mantenimiento') {
      // Si elige Malo/Mantenimiento -> Son 'Ocupado'
      nuevos.push('Ocupado');
    } else if (valor === 'Estado_Bueno') {
      // Si elige Bueno -> Es 'Disponible' (Libre)
      nuevos.push('Disponible');
    } else {
      // Si se deseleccionó todo abajo (nuevos no tiene bottom actual),
      // ¿Qué hacemos con Top?
      // Podríamos dejar el Top anterior, pero aquí lo borramos arriba.
      // Si el usuario hace click para deseleccionar, 'nuevos' ya no tiene 'valor'.
      // Entonces no entra en los if anteriores.
      // En este caso, 'nuevos' queda vacío tanto de Bottom como de Top.
      // Si queremos que "Selecciono ocupado..." permanezca, al quitar abajo, ocupado debería quedarse?
      // Es un borde raro. Si quito abajo, quizás quiero ver "Ocupado" genérico?
      // Pero el mapa no muestra nada con solo "Ocupado".
      // Así que si quito abajo, mejor quitar Top visualmente también para indicar "Nada seleccionado".
    }

    alCambiarEstados(nuevos); // APLICAR CAMBIOS (Esta línea faltaba)
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
          <h3 className="section-title"><Info size={14} /> Filtrar nichos Disponibilidad</h3>

          <div className="availability-toggles" style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
            <label className="toggle-box"
              style={{
                flex: 1, padding: '0.5rem',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem',
                borderRadius: '8px',
                backgroundColor: 'transparent'
              }}>
              <div style={{ width: '28px', height: '28px', border: '3px solid #ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px' }}>
                {estadosSeleccionados.includes('Ocupado') && <div style={{ width: '18px', height: '18px', backgroundColor: '#ef4444', borderRadius: '4px' }} />}
              </div>
              <input
                type="checkbox"
                className="hidden-checkbox"
                checked={estadosSeleccionados.includes('Ocupado')}
                onChange={() => toggleEstado('Ocupado')}
              />
              <span className="toggle-text">Ocupado</span>
            </label>

            <label className="toggle-box"
              style={{
                flex: 1, padding: '0.5rem',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem',
                borderRadius: '8px',
                backgroundColor: 'transparent'
              }}>
              <div style={{ width: '28px', height: '28px', border: '3px solid #22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px' }}>
                {estadosSeleccionados.includes('Disponible') && <div style={{ width: '18px', height: '18px', backgroundColor: '#22c55e', borderRadius: '4px' }} />}
              </div>
              <input
                type="checkbox"
                className="hidden-checkbox"
                checked={estadosSeleccionados.includes('Disponible')}
                onChange={() => toggleEstado('Disponible')}
              />
              <span className="toggle-text">Libre</span>
            </label>
          </div>

          <h3 className="section-title">Filtrar por estado físico</h3>
          <div className="status-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>

            <label className={`status-item ${estadosSeleccionados.includes('Estado_Bueno') ? 'active' : ''}`} style={{ opacity: estadosSeleccionados.includes('Disponible') ? 1 : 0.5, pointerEvents: estadosSeleccionados.includes('Disponible') ? 'auto' : 'none' }}>
              <div className="status-color-box" style={{ width: '24px', height: '24px', borderRadius: '6px', border: '2px solid #22c55e', backgroundColor: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {estadosSeleccionados.includes('Estado_Bueno') && <div style={{ width: '14px', height: '14px', backgroundColor: '#22c55e', borderRadius: '2px' }} />}
              </div>
              <input type="checkbox" checked={estadosSeleccionados.includes('Estado_Bueno')} onChange={() => toggleEstadoFisico('Estado_Bueno')} className="hidden-checkbox" disabled={!estadosSeleccionados.includes('Disponible')} />
              <span className="status-text">Buenas condiciones</span>
            </label>

            <label className={`status-item ${estadosSeleccionados.includes('Estado_Malo') ? 'active' : ''}`} style={{ opacity: estadosSeleccionados.includes('Ocupado') ? 1 : 0.5, pointerEvents: estadosSeleccionados.includes('Ocupado') ? 'auto' : 'none' }}>
              <div className="status-color-box" style={{ width: '24px', height: '24px', borderRadius: '6px', border: '2px solid #ef4444', backgroundColor: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {estadosSeleccionados.includes('Estado_Malo') && <div style={{ width: '14px', height: '14px', backgroundColor: '#ef4444', borderRadius: '2px' }} />}
              </div>
              <input type="checkbox" checked={estadosSeleccionados.includes('Estado_Malo')} onChange={() => toggleEstadoFisico('Estado_Malo')} className="hidden-checkbox" disabled={!estadosSeleccionados.includes('Ocupado')} />
              <span className="status-text">Malas condiciones</span>
            </label>

            <label className={`status-item ${estadosSeleccionados.includes('Mantenimiento') ? 'active' : ''}`} style={{ opacity: estadosSeleccionados.includes('Ocupado') ? 1 : 0.5, pointerEvents: estadosSeleccionados.includes('Ocupado') ? 'auto' : 'none' }}>
              <div className="status-color-box" style={{ width: '24px', height: '24px', borderRadius: '6px', border: '2px solid #fbbf24', backgroundColor: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {estadosSeleccionados.includes('Mantenimiento') && <div style={{ width: '14px', height: '14px', backgroundColor: '#fbbf24', borderRadius: '2px' }} />}
              </div>
              <input type="checkbox" checked={estadosSeleccionados.includes('Mantenimiento')} onChange={() => toggleEstadoFisico('Mantenimiento')} className="hidden-checkbox" disabled={!estadosSeleccionados.includes('Ocupado')} />
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