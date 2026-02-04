import React, { useState } from 'react';
import Sidebar from './components/ui/Sidebar';
import MapaCementerio from './components/mapa/MapaCementerio';
import './App.css';

function App() {
  const [nichoABuscar, setNichoABuscar] = useState({ codigo: null, ts: 0 });
  const [bloqueSeleccionado, setBloqueSeleccionado] = useState(null);
  const [sectorSeleccionado, setSectorSeleccionado] = useState(null); // Nuevo estado
  const [configuracionCapas, setConfiguracionCapas] = useState({
    'cementerio_general': true,
    'infraestructura': true,
    'bloques_geom': true,
    'nichos_geom': true
  });

  const [estadosVisibles, setEstadosVisibles] = useState([]);
  const [menuAbierto, setMenuAbierto] = useState(false);

  const listaCapas = [
    { id: 'cementerio_general', nombre: 'Límites del Cementerio' },
    { id: 'infraestructura', nombre: 'Caminos y Edificios' },
    { id: 'bloques_geom', nombre: 'Bloques / Manzanas' },
    { id: 'nichos_geom', nombre: 'Nichos Individuales' },
  ];

  const cerrarMenu = () => setMenuAbierto(false);

  // EFECTO PARA LEER URL PARAMETROS (Integración con sistema externo)
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codigoURL = params.get('buscar'); // ej. ?buscar=B01-N05
    if (codigoURL) {
      console.log("Detectado parámetro URL:", codigoURL);
      setNichoABuscar({ codigo: codigoURL, ts: Date.now() });
    }
  }, []);

  return (
    <div className="layout-principal">
      <button
        className="btn-hamburguesa"
        onClick={() => setMenuAbierto(true)}
      >
        ☰
      </button>

      <div
        className={`overlay-fondo ${menuAbierto ? 'activo' : ''}`}
        onClick={cerrarMenu}
      />

      <div className={`sidebar-wrapper ${menuAbierto ? 'abierto' : ''}`}>
        <button className="btn-cerrar" onClick={cerrarMenu}>✕</button>
        <Sidebar
          alBuscar={(codigo) => {
            setNichoABuscar({ codigo, ts: Date.now() });
            cerrarMenu();
          }}
          alCambiarCapas={setConfiguracionCapas}
          alSeleccionarBloque={(bloque) => { setBloqueSeleccionado(bloque); cerrarMenu(); }}
          alSeleccionarSector={(sector) => { setSectorSeleccionado(sector); }} // Nuevo prop
          capasConfig={listaCapas}
          className="sidebar-componente-interno"
          estadosSeleccionados={estadosVisibles}
          alCambiarEstados={setEstadosVisibles}
        />
      </div>

      <div className="mapa-wrapper">
        <MapaCementerio
          nichoSeleccionado={nichoABuscar}
          bloqueSeleccionado={bloqueSeleccionado}
          sectorSeleccionado={sectorSeleccionado} // Nuevo prop
          capasVisiblesEstado={configuracionCapas}
          estadosVisibles={estadosVisibles}
          alDeseleccionarNicho={() => setNichoABuscar({ codigo: null, ts: Date.now() })}
        />
      </div>
    </div>
  );
}

export default App;