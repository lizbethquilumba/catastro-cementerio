import React, { useState, useEffect } from 'react';
import { Search, Layers, Map as MapIcon, Eye, EyeOff, Sparkles, MapPin, Info, Navigation, Grid3X3, FileText } from 'lucide-react'; 
import { supabase } from '../../api/supabaseClient';
import { jsPDF } from 'jspdf'; 
import autoTable from 'jspdf-autotable'; // Asegúrate de tener instalado jspdf-autotable
import logo from '../../assets/logo.png'; 

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

  // --- FUNCIONES DEL BUSCADOR (CORREGIDO) ---
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
      let tNichos=0, tOcupados=0, tDisponibles=0, tReservados=0;
      const detalles = [];

      for (const cod of bloquesSeleccionados) {
        const geoId = mapaIds[cod];
        if(!geoId) continue;

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
      doc.setFillColor(0, 123, 167); doc.rect(0, 0, 210, 5, 'F');
      try { doc.addImage(logo, 'PNG', 15, 10, 25, 25); } catch(e){} 
      
      doc.setFontSize(16); doc.setTextColor(0, 123, 167); doc.setFont('helvetica', 'bold');
      doc.text('UNORICO SAMASHUNCHIC', 105, 20, {align:'center'});
      
      doc.setFontSize(10); doc.setTextColor(100); doc.setFont('helvetica', 'normal');
      doc.text('REPORTE DE OCUPACIÓN - CEMENTERIO', 105, 26, {align:'center'});
      doc.text(`Sector: ${sectorSeleccionado} | Fecha: ${fecha}`, 105, 32, {align:'center'});

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
          ['Ocupados', tOcupados, tNichos > 0 ? ((tOcupados/tNichos)*100).toFixed(1) + '%' : '0%'],
          ['Disponibles', tDisponibles, tNichos > 0 ? ((tDisponibles/tNichos)*100).toFixed(1) + '%' : '0%'],
          ['Reservados', tReservados, tNichos > 0 ? ((tReservados/tNichos)*100).toFixed(1) + '%' : '0%'],
          ['TOTAL', tNichos, '100%']
        ],
        theme: 'grid',
        headStyles: { fillColor: [0, 123, 167] }
      });

      // Tabla Detalle
      doc.text('Detalle por Bloque', 15, doc.lastAutoTable.finalY + 15);
      
      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 20,
        head: [['Bloque', 'Total', 'Ocupados', 'Disponibles', 'Reservados']],
        body: detalles.map(d => [
          `${d.nombre} (${d.codigo})`, // Muestra nombre y código en el PDF también
          d.total, d.ocup, d.disp, d.resv
        ]),
        theme: 'grid',
        headStyles: { fillColor: [0, 123, 167] }
      });

      doc.save(`Reporte_${sectorSeleccionado.replace(/\s+/g, '_')}.pdf`);

    } catch (e) {
      console.error(e);
      alert('Error generando reporte. Revise la consola.');
    }
    setGenerandoReporte(false);
  };

  return (
    <div className={className}>
      
      {/* HEADER */}
      <div style={{ padding: '25px', background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)', color: 'white' }}>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold', display:'flex', alignItems:'center', gap:'10px' }}>
          <img src={logo} alt="Logo" style={{ width: '30px', height: '30px', background:'white', borderRadius:'8px', padding:'2px' }} />
          UNORICO SAMASHUNCHIK
        </h2>
        <p style={{ margin: '5px 0 0 0', fontSize: '12px', opacity: 0.9 }}>Otavalo - Ecuador</p>
      </div>

      <div style={{ padding: '20px', flex: 1, overflowY: 'auto' }}>
        
        {/* BUSCADOR */}
        <div style={{ marginBottom: '25px' }}>
          <h3 style={{ fontSize: '12px', color: '#6366f1', fontWeight:'bold', marginBottom:'10px', textTransform:'uppercase' }}>
            <Search size={14}/> Búsqueda
          </h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input 
              type="text" 
              placeholder="Ingrese cédula" 
              value={busqueda} 
              onChange={manejarBusqueda} 
              style={{ flex:1, padding:'8px', borderRadius:'6px', border:'1px solid #ccc' }} 
            />
            <button onClick={ubicarFallecido} disabled={busqueda.length<3} 
              style={{ background:'#6366f1', color:'white', border:'none', borderRadius:'6px', padding:'0 12px', cursor:'pointer' }}>
              <Navigation size={16}/> Ubicar
            </button>
          </div>
          {mensajeBusqueda && (
            <div style={{ fontSize:'12px', marginTop:'5px', color: mensajeBusqueda.tipo==='error'?'red': mensajeBusqueda.tipo==='warning'?'orange':'green' }}>
              {mensajeBusqueda.texto}
            </div>
          )}
          
          {resultados.length > 0 && (
             <ul style={{ listStyle:'none', padding:0, marginTop:'10px', border:'1px solid #eee', borderRadius:'6px' }}>
               {resultados.map(item => (
                 <li key={item.id} onClick={() => seleccionarResultado(item)} 
                   style={{ padding:'8px', borderBottom:'1px solid #eee', cursor:'pointer', fontSize:'12px', background:'white' }}>
                   <b>{item.nombre}</b> <br/><span style={{color:'#666'}}>{item.cedula}</span>
                 </li>
               ))}
             </ul>
          )}
        </div>

        {/* FILTRO BLOQUE */}
        <div style={{ marginBottom: '25px' }}>
          <h3 style={{ fontSize: '12px', color: '#6366f1', fontWeight:'bold', marginBottom:'10px', textTransform:'uppercase' }}>
            <Grid3X3 size={14}/> Filtrar por Bloque
          </h3>
          <select 
            value={bloqueActual} 
            onChange={(e) => {
              const codigo = e.target.value;
              setBloqueActual(codigo);
              const b = bloques.find(x => x.codigo === codigo);
              alSeleccionarBloque(codigo ? { codigo, nombre: b?.nombre } : null);
            }} 
            style={{ width:'100%', padding:'8px', borderRadius:'6px', border:'1px solid #ccc' }}
          >
            <option value="">-- Seleccione un bloque --</option>
            {/* ✅ AQUÍ ESTÁ LA CORRECCIÓN VISUAL QUE PEDISTE */}
            {bloques.map(b => (
              <option key={b.codigo} value={b.codigo}>
                {b.nombre} ({b.codigo})
              </option>
            ))}
          </select>
          
          {bloqueActual && (
            <button onClick={() => { setBloqueActual(''); alSeleccionarBloque(null); }} 
              style={{ marginTop: '5px', width: '100%', padding: '5px', borderRadius: '4px', border: '1px dashed #ccc', background: '#f9f9f9', color: '#666', cursor: 'pointer', fontSize:'11px' }}>
              ✕ Quitar filtro
            </button>
          )}
        </div>

        {/* REPORTE */}
        <div style={{ marginBottom: '25px' }}>
          <h3 style={{ fontSize: '12px', color: '#6366f1', fontWeight:'bold', marginBottom:'10px', textTransform:'uppercase' }}>
            <FileText size={14}/> Reporte por Sector
          </h3>
          <select value={sectorSeleccionado} onChange={(e) => setSectorSeleccionado(e.target.value)}
             style={{ width:'100%', padding:'8px', borderRadius:'6px', border:'1px solid #ccc', marginBottom:'8px' }}>
            <option value="">-- Seleccione un sector --</option>
            {sectores.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          
          {sectorSeleccionado && (
            <div style={{ maxHeight:'100px', overflowY:'auto', border:'1px solid #eee', padding:'5px', marginBottom:'8px', borderRadius:'6px' }}>
               <div style={{fontSize:'11px', display:'flex', justifyContent:'space-between', marginBottom:'5px'}}>
                 <span>Bloques del sector</span>
                 <span style={{color:'blue', cursor:'pointer'}} 
                   onClick={()=>setBloquesSeleccionados(bloquesSeleccionados.length===bloquesDelSector.length?[]:bloquesDelSector.map(b=>b.codigo))}>
                   {bloquesSeleccionados.length===bloquesDelSector.length?'Ninguno':'Todos'}
                 </span>
               </div>
               {bloquesDelSector.map(b => (
                 <label key={b.codigo} style={{ display:'flex', gap:'5px', fontSize:'12px', cursor:'pointer' }}>
                   <input type="checkbox" checked={bloquesSeleccionados.includes(b.codigo)}
                     onChange={(e) => {
                       if(e.target.checked) setBloquesSeleccionados([...bloquesSeleccionados, b.codigo]);
                       else setBloquesSeleccionados(bloquesSeleccionados.filter(x=>x!==b.codigo));
                     }} />
                   {b.nombre} ({b.codigo})
                 </label>
               ))}
            </div>
          )}
          
          <button onClick={generarReportePDF} disabled={generandoReporte}
             style={{ width:'100%', padding:'10px', background:'#6366f1', color:'white', border:'none', borderRadius:'6px', cursor:'pointer', opacity: generandoReporte?0.7:1 }}>
             {generandoReporte ? 'Generando...' : 'Generar Reporte PDF'}
          </button>
        </div>

        {/* SIMBOLOGÍA (CHECKBOXES COLORES) */}
        <div style={{ marginBottom: '25px' }}>
          <h3 style={{ fontSize: '12px', color: '#6366f1', fontWeight:'bold', marginBottom:'10px', textTransform:'uppercase' }}><Info size={14}/> Simbología de Estados</h3>
          <div style={{ background:'white', padding:'10px', borderRadius:'8px', border:'1px solid #eee' }}>
            
            {/* Opciones con las mayúsculas correctas para la lógica, pero texto bonito */}
            <label style={{ display:'flex', alignItems:'center', marginBottom:'8px', cursor:'pointer' }}>
              <input type="checkbox" checked={estadosSeleccionados.includes('Disponible')}
                onChange={() => toggleEstado('Disponible')} style={{ accentColor: '#22c55e', marginRight:'8px' }} />
              <span style={{ width:'15px', height:'15px', background:'#22c55e', borderRadius:'3px', marginRight:'8px' }}></span>
              <span style={{ fontSize:'13px' }}>Libre / Disponible</span>
            </label>

            <label style={{ display:'flex', alignItems:'center', marginBottom:'8px', cursor:'pointer' }}>
              <input type="checkbox" checked={estadosSeleccionados.includes('Ocupado')}
                onChange={() => toggleEstado('Ocupado')} style={{ accentColor: '#ef4444', marginRight:'8px' }} />
              <span style={{ width:'15px', height:'15px', background:'#ef4444', borderRadius:'3px', marginRight:'8px' }}></span>
              <span style={{ fontSize:'13px' }}>Ocupado</span>
            </label>

            <label style={{ display:'flex', alignItems:'center', cursor:'pointer' }}>
              <input type="checkbox" checked={estadosSeleccionados.includes('Reservado')}
                onChange={() => toggleEstado('Reservado')} style={{ accentColor: '#eab308', marginRight:'8px' }} />
              <span style={{ width:'15px', height:'15px', background:'#eab308', borderRadius:'3px', marginRight:'8px' }}></span>
              <span style={{ fontSize:'13px' }}>Reservado</span>
            </label>

          </div>
        </div>

        {/* CAPAS */}
        <div>
          <h3 style={{ fontSize: '12px', color: '#6366f1', fontWeight:'bold', marginBottom:'10px', textTransform:'uppercase' }}><Layers size={14}/> Capas del Mapa</h3>
          <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
            {capasConfig.map(capa => (
              <div key={capa.id} onClick={() => toggleCapa(capa.id)}
                style={{ display:'flex', alignItems:'center', gap:'10px', padding:'8px', borderRadius:'6px', cursor:'pointer',
                  background: capasVisibles[capa.id] ? '#eef2ff' : '#f9fafb', border: capasVisibles[capa.id] ? '1px solid #6366f1' : '1px solid transparent' }}>
                {capasVisibles[capa.id] ? <Eye size={14} color="#6366f1"/> : <EyeOff size={14} color="#94a3b8"/>}
                <span style={{ fontSize:'13px' }}>{capa.nombre}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};

export default Sidebar;