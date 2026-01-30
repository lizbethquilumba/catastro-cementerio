import React, { useState } from 'react';
import Sidebar from './components/ui/Sidebar';
import MapaCementerio from './components/mapa/MapaCementerio';
import './App.css'; 

function App() {
  const [nichoABuscar, setNichoABuscar] = useState(null);
  const [bloqueSeleccionado, setBloqueSeleccionado] = useState(null);
  const [configuracionCapas, setConfiguracionCapas] = useState({
    'cementerio_general': true,
    'infraestructura': true,
    'bloques_geom': true,
    'nichos_geom': true
  });

  // --- NUEVO CÓDIGO AÑADIDO: FILTRO DE ESTADOS ---
  // Guardamos qué estados se deben mostrar. Por defecto: todos.
  // IMPORTANTE: Estos textos ('disponible', 'ocupado', 'reservado') deben ser 
  // IGUALES a como están escritos en tu base de datos (PostgreSQL).
  const [estadosVisibles, setEstadosVisibles] = useState(['disponible', 'ocupado', 'reservado']);

  // Estado para abrir/cerrar menú en móvil
  const [menuAbierto, setMenuAbierto] = useState(false);

  const listaCapas = [
    { id: 'cementerio_general', nombre: 'Límites del Cementerio' },
    { id: 'infraestructura', nombre: 'Caminos y Edificios' },
    { id: 'bloques_geom', nombre: 'Bloques / Manzanas' },
    { id: 'nichos_geom', nombre: 'Nichos Individuales' },
  ];

  // Función para cerrar el menú automáticamente al seleccionar algo
  const cerrarMenu = () => setMenuAbierto(false);

  return (
    <div className="layout-principal">
      
      {/* BOTÓN HAMBURGUESA (Solo visible en móvil por CSS) */}
      <button 
        className="btn-hamburguesa"
        onClick={() => setMenuAbierto(true)}
      >
        ☰
      </button>

      {/* OVERLAY OSCURO (Solo visible cuando el menú está abierto) */}
      <div 
        className={`overlay-fondo ${menuAbierto ? 'activo' : ''}`} 
        onClick={cerrarMenu}
      />

      {/* CONTENEDOR DEL SIDEBAR (Se mueve sin afectar el diseño interno) */}
      <div className={`sidebar-wrapper ${menuAbierto ? 'abierto' : ''}`}>
        
        {/* Botón X para cerrar dentro del menú */}
        <button className="btn-cerrar" onClick={cerrarMenu}>✕</button>

        {/* TU SIDEBAR ORIGINAL */}
        <Sidebar 
          alBuscar={(codigo) => { setNichoABuscar(codigo); cerrarMenu(); }}
          alCambiarCapas={setConfiguracionCapas}
          alSeleccionarBloque={(bloque) => { setBloqueSeleccionado(bloque); cerrarMenu(); }}
          capasConfig={listaCapas}
          className="sidebar-componente-interno" 
          
          // --- AQUÍ PASAMOS LAS PROPS NUEVAS AL SIDEBAR ---
          estadosSeleccionados={estadosVisibles}
          alCambiarEstados={setEstadosVisibles}
        />
      </div>

      {/* MAPA (Siempre ocupa el 100% del fondo en móvil) */}
      <div className="mapa-wrapper">
        <MapaCementerio 
          nichoSeleccionado={nichoABuscar}
          bloqueSeleccionado={bloqueSeleccionado}
          capasVisiblesEstado={configuracionCapas}
          
          // --- AQUÍ PASAMOS EL FILTRO AL MAPA ---
          estadosVisibles={estadosVisibles}
        />
      </div>

    </div>
  );
}

export default App;