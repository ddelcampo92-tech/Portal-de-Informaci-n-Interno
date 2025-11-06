proj4.defs('EPSG:32614', '+proj=utm +zone=14 +datum=WGS84 +units=m +no_defs');

const colores = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#34495e'];

// Mapeo de nombres técnicos a nombres de visualización (variable global)
const nombresCapas = {
  // Atlas de Inundaciones
  'atlas temporada 2020': 'Atlas Temporada 2020',
  'atlas temporada 2021': 'Atlas Temporada 2021',
  'atlas temporada 2022': 'Atlas Temporada 2022',
  'atlas temporada 2023': 'Atlas Temporada 2023',
  'atlas temporada 2024': 'Atlas Temporada 2024',
  // Inventario CAEM
  'cajas de captacion': 'Cajas de Captación',
  'cajas derivadoras': 'Cajas Derivadoras',
  'cajas rompedoras de presion': 'Cajas Rompedoras de Presión',
  'campamentos_edomex': 'Campamentos Grupo Tlaloc',
  'carcamos': 'Cárcamos',
  'fosas septicas': 'Fosas Sépticas',
  'galeria filtrante': 'Galería Filtrante',
  'lineas de conduccion-ap': 'Líneas de Conducción AP',
  'lineasdistribucion-drenaje': 'Líneas de Distribución Drenaje',
  'manantiales': 'Manantiales',
  'obras de toma': 'Obras de Toma',
  'plantas de bombeo': 'Plantas de Bombeo',
  'plantas de tratamiento': 'Plantas de Tratamiento',
  'pozos': 'Pozos',
  'tanques': 'Tanques',
  // Contexto Geográfico
  'cuerpos de agua': 'Cuerpos de Agua',
  'curvas de nivel': 'Curvas de Nivel',
  'estadomex': 'Límite Estatal',
  'estadomex_geojson': 'Límite Estatal (GeoJSON)',
  'municipios': 'Municipios',
  'municipios_geojson': 'Municipios (GeoJSON)',
  'regiones': 'Regionalización',
  'regiones_geojson': 'Regionalización (GeoJSON)',
  'riesgo de inundacion': 'Riesgo de Inundación',
  'rios y arroyos': 'Ríos y Arroyos'
};

let supabaseUrl = '';
let supabaseKey = '';
let capasConfig = {};
let capasActivas = {};
let capasData = {};
let ultimaCapaActivada = null; // Variable para rastrear la última capa activada
let measureMode = false;
let measurePoints = [];
let currentMeasureLine = null;
let measureLayer;
let profileMode = false;
let profileLine = null;
let searchMarker = null;
let areaMode = false;
let areaPoints = [];
let currentAreaPolygon = null;

const map = L.map('map', {
  zoomControl: true
}).setView([19.4326, -99.1332], 9);

map.zoomControl.setPosition('topright');

// Agregar escala gráfica en la parte inferior izquierda
L.control.scale({
  position: 'bottomleft',
  metric: true,
  imperial: false,
  maxWidth: 150
}).addTo(map);

let currentBasemap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
  maxZoom: 19
}).addTo(map);

// Crear un pane especial para las mediciones con z-index alto
map.createPane('measurePane');
map.getPane('measurePane').style.zIndex = 650;
map.getPane('measurePane').style.pointerEvents = 'none'; // No interferir con clics del mapa

measureLayer = L.layerGroup({
  pane: 'measurePane'
}).addTo(map);

map.on('mousemove', function(e) {
  document.getElementById('coordinates').textContent = 
    `Lat: ${e.latlng.lat.toFixed(4)}° | Lon: ${e.latlng.lng.toFixed(4)}°`;
});

// Funciones para el indicador de carga
function showLoading(message = 'Cargando información', subtext = 'Por favor espera...') {
  const indicator = document.getElementById('loading-indicator');
  const loadingContent = indicator.querySelector('.loading-content');
  loadingContent.querySelector('.loading-text').childNodes[0].textContent = message + ' ';
  loadingContent.querySelector('.loading-subtext').textContent = subtext;
  indicator.classList.add('show');
}

function hideLoading() {
  const indicator = document.getElementById('loading-indicator');
  indicator.classList.remove('show');
}

function changeBasemap(type) {
  map.removeLayer(currentBasemap);
  
  switch(type) {
    case 'osm':
      currentBasemap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
      });
      break;
    case 'satellite':
      currentBasemap = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri',
        maxZoom: 19
      });
      break;
    case 'topo':
      currentBasemap = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenTopoMap contributors',
        maxZoom: 17
      });
      break;
  }
  
  currentBasemap.addTo(map);
  
  document.querySelectorAll('.basemap-btn').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');
}

function reprojectGeometry(geom) {
  const reprojectCoords = (coords) => {
    if (typeof coords[0] === 'number') {
      return proj4('EPSG:32614', 'EPSG:4326', coords);
    } else {
      return coords.map(c => reprojectCoords(c));
    }
  };

  return {
    type: geom.type,
    coordinates: reprojectCoords(geom.coordinates)
  };
}

// Función para validar que una geometría tenga coordenadas válidas
function isValidGeometry(geom) {
  if (!geom || !geom.coordinates) return false;
  
  const validateCoords = (coords) => {
    if (typeof coords[0] === 'number') {
      // Es un par de coordenadas [lng, lat]
      const [lng, lat] = coords;
      return !isNaN(lng) && !isNaN(lat) && 
             isFinite(lng) && isFinite(lat) &&
             lng >= -180 && lng <= 180 &&
             lat >= -90 && lat <= 90;
    } else {
      // Es un array de coordenadas, validar recursivamente
      return coords.every(c => validateCoords(c));
    }
  };
  
  return validateCoords(geom.coordinates);
}

// Función para calcular el área geodésica de un polígono
function calcularAreaGeodesica(latlngs) {
  if (!latlngs || latlngs.length < 3) return 0;
  
  const R = 6371000; // Radio de la Tierra en metros
  let area = 0;
  
  if (latlngs.length > 2) {
    for (let i = 0; i < latlngs.length; i++) {
      const p1 = latlngs[i];
      const p2 = latlngs[(i + 1) % latlngs.length];
      
      const lat1 = p1.lat * Math.PI / 180;
      const lat2 = p2.lat * Math.PI / 180;
      const lng1 = p1.lng * Math.PI / 180;
      const lng2 = p2.lng * Math.PI / 180;
      
      area += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
    }
    area = Math.abs(area * R * R / 2);
  }
  
  return area;
}

function toggleSearch() {
  const searchInputs = document.getElementById('coord-search-inputs');
  const searchBtn = document.getElementById('search-btn');
  
  if (searchInputs.style.display === 'none') {
    searchInputs.style.display = 'block';
    searchBtn.classList.add('active');
  } else {
    searchInputs.style.display = 'none';
    searchBtn.classList.remove('active');
  }
}

function toggleMeasure() {
  measureMode = !measureMode;
  profileMode = false;
  areaMode = false;
  document.getElementById('measure-btn').classList.toggle('active', measureMode);
  document.getElementById('profile-btn').classList.remove('active');
  document.getElementById('area-btn').classList.remove('active');
  
  if (measureMode) {
    map.getContainer().style.cursor = 'crosshair';
    measurePoints = [];
    if (currentMeasureLine) {
      measureLayer.removeLayer(currentMeasureLine);
    }
    disableLayersInteractivity();
  } else {
    map.getContainer().style.cursor = '';
    enableLayersInteractivity();
  }
}

function toggleProfile() {
  profileMode = !profileMode;
  measureMode = false;
  areaMode = false;
  document.getElementById('profile-btn').classList.toggle('active', profileMode);
  document.getElementById('measure-btn').classList.remove('active');
  document.getElementById('area-btn').classList.remove('active');
  
  if (profileMode) {
    map.getContainer().style.cursor = 'crosshair';
    if (profileLine) {
      measureLayer.removeLayer(profileLine);
    }
    disableLayersInteractivity();
  } else {
    map.getContainer().style.cursor = '';
    document.getElementById('elevation-profile').classList.remove('show');
    enableLayersInteractivity();
  }
}

function toggleArea() {
  areaMode = !areaMode;
  measureMode = false;
  profileMode = false;
  document.getElementById('area-btn').classList.toggle('active', areaMode);
  document.getElementById('measure-btn').classList.remove('active');
  document.getElementById('profile-btn').classList.remove('active');
  
  if (areaMode) {
    // Limpiar todo cuando se activa para nueva medición
    measureLayer.clearLayers();
    if (currentAreaPolygon) {
      measureLayer.removeLayer(currentAreaPolygon);
      currentAreaPolygon = null;
    }
    map.getContainer().style.cursor = 'crosshair';
    areaPoints = [];
    disableLayersInteractivity();
  } else {
    // Limpiar todo cuando se desactiva
    map.getContainer().style.cursor = '';
    areaPoints = [];
    measureLayer.clearLayers();
    if (currentAreaPolygon) {
      measureLayer.removeLayer(currentAreaPolygon);
      currentAreaPolygon = null;
    }
    enableLayersInteractivity();
  }
}

// Función para limpiar todos los análisis (mediciones, perfiles, áreas)
function limpiarAnalisis() {
  // Desactivar todos los modos
  measureMode = false;
  profileMode = false;
  areaMode = false;
  
  // Remover clases activas de los botones
  const measureBtn = document.getElementById('measure-btn');
  const profileBtn = document.getElementById('profile-btn');
  const areaBtn = document.getElementById('area-btn');
  const measureBtnFloat = document.getElementById('measure-btn-float');
  const profileBtnFloat = document.getElementById('profile-btn-float');
  const areaBtnFloat = document.getElementById('area-btn-float');
  
  if (measureBtn) measureBtn.classList.remove('active');
  if (profileBtn) profileBtn.classList.remove('active');
  if (areaBtn) areaBtn.classList.remove('active');
  if (measureBtnFloat) measureBtnFloat.classList.remove('active');
  if (profileBtnFloat) profileBtnFloat.classList.remove('active');
  if (areaBtnFloat) areaBtnFloat.classList.remove('active');
  
  // Limpiar todas las capas de medición
  measureLayer.clearLayers();
  
  // Limpiar variables
  measurePoints = [];
  areaPoints = [];
  currentMeasureLine = null;
  currentAreaPolygon = null;
  profileLine = null;
  
  // Cerrar el panel de perfil de elevación si está abierto
  const elevationProfile = document.getElementById('elevation-profile');
  if (elevationProfile) {
    elevationProfile.classList.remove('show');
  }
  
  // Restaurar cursor y habilitar interactividad de capas
  map.getContainer().style.cursor = '';
  enableLayersInteractivity();
  
  console.log('✨ Análisis limpiado correctamente');
}

// Funciones para habilitar/deshabilitar interactividad de capas
function disableLayersInteractivity() {
  Object.keys(capasActivas).forEach(nombre => {
    const layer = capasActivas[nombre];
    if (layer && layer.getLayers) {
      layer.getLayers().forEach(l => {
        if (l.options) {
          l.options.interactive = false;
        }
        // Deshabilitar eventos
        if (l.off) {
          l.off('click');
        }
      });
    }
  });
}

function enableLayersInteractivity() {
  Object.keys(capasActivas).forEach(nombre => {
    const layer = capasActivas[nombre];
    if (layer && layer.getLayers) {
      layer.getLayers().forEach(l => {
        if (l.options) {
          l.options.interactive = true;
        }
      });
    }
  });
}

function closeProfile() {
  document.getElementById('elevation-profile').classList.remove('show');
  profileMode = false;
  document.getElementById('profile-btn').classList.remove('active');
  map.getContainer().style.cursor = '';
  enableLayersInteractivity();
}

// Variables para la ventana modal de simbología
let symbologyModalDragging = false;
let symbologyModalCurrentX;
let symbologyModalCurrentY;
let symbologyModalInitialX;
let symbologyModalInitialY;
let symbologyModalXOffset = 0;
let symbologyModalYOffset = 0;

function openSymbologyModal() {
  const modal = document.getElementById('symbology-modal');
  updateSymbology();
  modal.classList.add('show');
}

function closeSymbologyModal() {
  const modal = document.getElementById('symbology-modal');
  modal.classList.remove('show');
}

// Inicializar la funcionalidad de arrastre para la ventana de simbología
function initSymbologyDrag() {
  const modal = document.getElementById('symbology-modal');
  const header = document.getElementById('symbology-header');
  
  header.addEventListener('mousedown', dragStart);
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', dragEnd);
  
  function dragStart(e) {
    symbologyModalInitialX = e.clientX - symbologyModalXOffset;
    symbologyModalInitialY = e.clientY - symbologyModalYOffset;
    
    if (e.target === header || e.target.parentElement === header) {
      symbologyModalDragging = true;
      header.style.cursor = 'grabbing';
    }
  }
  
  function drag(e) {
    if (symbologyModalDragging) {
      e.preventDefault();
      
      symbologyModalCurrentX = e.clientX - symbologyModalInitialX;
      symbologyModalCurrentY = e.clientY - symbologyModalInitialY;
      
      symbologyModalXOffset = symbologyModalCurrentX;
      symbologyModalYOffset = symbologyModalCurrentY;
      
      setTranslate(symbologyModalCurrentX, symbologyModalCurrentY, modal);
    }
  }
  
  function dragEnd(e) {
    symbologyModalInitialX = symbologyModalCurrentX;
    symbologyModalInitialY = symbologyModalCurrentY;
    
    symbologyModalDragging = false;
    header.style.cursor = 'move';
  }
  
  function setTranslate(xPos, yPos, el) {
    el.style.transform = `translate(${xPos}px, ${yPos}px)`;
  }
}

// Inicializar el arrastre cuando se carga la página
window.addEventListener('DOMContentLoaded', function() {
  initSymbologyDrag();
});

function updateSymbology() {
  const content = document.getElementById('symbology-content');
  
  // Definir capas del Inventario CAEM y sus campos
  // NOTA: Se priorizará el campo "tipo" o "TIPO" si existe en los datos
  const inventarioCAEM = {
    'cajas de captacion': 'tipo',
    'cajas derivadoras': 'tipo',
    'cajas rompedoras de presion': 'tipo',
    'campamentos_edomex': 'tipo',
    'carcamos': 'tipo',
    'fosas septicas': 'tipo',
    'galeria filtrante': 'tipo',
    'lineas de conduccion-ap': 'PROYECTO',
    'lineasdistribucion-drenaje': 'PROYECTO',
    'manantiales': 'tipo',
    'obras de toma': 'tipo',
    'plantas de bombeo': 'tipo',
    'plantas de tratamiento': 'tipo',
    'pozos': 'tipo',
    'tanques': 'tipo'
  };
  
  // Definir capas de Inundaciones
  const inundaciones = {
    'atlas temporada 2020': 'temp_lluv',
    'atlas temporada 2021': 'temp_lluv',
    'atlas temporada 2022': 'temp_lluv',
    'atlas temporada 2023': 'temp_lluv',
    'atlas temporada 2024': 'temp_lluv'
  };
  
  // Definir capas de Contexto Geográfico
  const contextoGeografico = {
    'cuerpos de agua': 'nombre',  // Mostrar por nombre
    'curvas de nivel': 'elevacion',
    'estadomex': 'nom_ent',  // Nombre de la entidad
    'estadomex_geojson': 'nom_ent',
    'municipios': 'municipi_1',  // Nombre del municipio
    'municipios_geojson': 'municipi_1',
    'regiones': 'municipi_1',  // Cambiar a municipi_1 según solicitud
    'regiones_geojson': 'municipi_1',
    'riesgo de inundacion': 'vulner_ri',
    'rios y arroyos': 'nombre'  // Mostrar por nombre
  };
  
  // Combinar todas las capas para la simbología
  const capasParaSimbologia = {...inventarioCAEM, ...inundaciones, ...contextoGeografico};
  
  // Función auxiliar para procesar una capa y obtener su HTML
  function processLayer(layerName, fieldName) {
    const layer = capasActivas[layerName];
    const displayName = nombresCapas[layerName] || layerName;
    const totalFeatures = layer && layer.getLayers ? layer.getLayers().length : 0;
    
    // PRIORIZAR EL CAMPO "tipo", "temp_lluv" o "PROYECTO" SI EXISTE (en diferentes variaciones)
    if (layer && layer.getLayers && layer.getLayers().length > 0) {
      const firstFeature = layer.getLayers()[0];
      const props = firstFeature.feature ? firstFeature.feature.properties : {};
      
      // Buscar el campo TIPO en diferentes variaciones
      if (props.hasOwnProperty('TIPO')) {
        fieldName = 'TIPO';
      } else if (props.hasOwnProperty('tipo')) {
        fieldName = 'tipo';
      } else if (props.hasOwnProperty('Tipo')) {
        fieldName = 'Tipo';
      }
      // Buscar el campo temp_lluv en diferentes variaciones
      else if (props.hasOwnProperty('temp_lluv')) {
        fieldName = 'temp_lluv';
      } else if (props.hasOwnProperty('TEMP_LLUV')) {
        fieldName = 'TEMP_LLUV';
      } else if (props.hasOwnProperty('Temp_Lluv')) {
        fieldName = 'Temp_Lluv';
      }
      // Buscar el campo PROYECTO en diferentes variaciones
      else if (props.hasOwnProperty('PROYECTO')) {
        fieldName = 'PROYECTO';
      } else if (props.hasOwnProperty('proyecto')) {
        fieldName = 'proyecto';
      } else if (props.hasOwnProperty('Proyecto')) {
        fieldName = 'Proyecto';
      }
      
      console.log(`📋 Capa: ${layerName}, Campo usado: ${fieldName}, Propiedades:`, Object.keys(props));
    }
    
    let html = `<div class="symbology-layer">`;
    html += `<div class="symbology-layer-name">${displayName} <span class="symbology-total">(${totalFeatures})</span></div>`;
    
    // Obtener valores únicos CON SUS COLORES REALES
    const uniqueValues = new Map();
    
    if (layer && layer.getLayers) {
      layer.getLayers().forEach(l => {
        const props = l.feature ? l.feature.properties : {};
        const value = props[fieldName];
        
        // SOLO agregar si el valor existe (NO agregar "Sin dato")
        if (value !== null && value !== undefined && value !== '') {
          // Obtener el color real del layer
          let realColor = '#999999';
          
          if (l.options && l.options.fillColor) {
            realColor = l.options.fillColor;
          } else if (l.options && l.options.color) {
            realColor = l.options.color;
          }
          
          if (!uniqueValues.has(value)) {
            uniqueValues.set(value, { count: 0, color: realColor });
          }
          uniqueValues.get(value).count++;
        }
      });
    }
    
    console.log(`  📊 ${layerName}: ${uniqueValues.size} valores únicos encontrados`);
    
    // Determinar el tipo de geometría
    let geometryType = 'point';
    if (layer && layer.getLayers && layer.getLayers().length > 0) {
      const firstLayer = layer.getLayers()[0];
      if (firstLayer instanceof L.Polyline && !(firstLayer instanceof L.Polygon)) {
        geometryType = 'line';
      } else if (firstLayer instanceof L.Polygon) {
        geometryType = 'polygon';
      }
    }
    
    // Si no hay valores únicos, mostrar un símbolo genérico con el color de la capa
    if (uniqueValues.size === 0 && totalFeatures > 0) {
      // Obtener el color de la primera feature de la capa
      let defaultColor = '#8a2035';
      if (layer && layer.getLayers && layer.getLayers().length > 0) {
        const firstLayer = layer.getLayers()[0];
        if (firstLayer.options && firstLayer.options.fillColor) {
          defaultColor = firstLayer.options.fillColor;
        } else if (firstLayer.options && firstLayer.options.color) {
          defaultColor = firstLayer.options.color;
        }
      }
      
      html += `<div class="symbology-item">`;
      
      if (geometryType === 'line') {
        html += `<div class="symbology-symbol line" style="background-color: ${defaultColor};"></div>`;
      } else if (geometryType === 'polygon') {
        html += `<div class="symbology-symbol" style="background-color: ${defaultColor}; opacity: 0.6;"></div>`;
      } else {
        html += `<div class="symbology-symbol point" style="background-color: ${defaultColor};"></div>`;
      }
      
      html += `<div class="symbology-label">`;
      html += `<div class="symbology-value">${displayName}</div>`;
      html += `<div class="symbology-count">(${totalFeatures})</div>`;
      html += `</div>`;
      html += `</div>`;
      
      html += `</div>`;
      return html;
    }
    
    // Ordenar valores alfabéticamente
    const sortedValues = Array.from(uniqueValues.entries()).sort((a, b) => 
      String(a[0]).localeCompare(String(b[0]))
    );
    
    // Mostrar cada valor único con su color REAL y conteo
    sortedValues.forEach(([value, data]) => {
      const color = data.color;
      const count = data.count;
      
      html += `<div class="symbology-item">`;
      
      if (geometryType === 'line') {
        html += `<div class="symbology-symbol line" style="background-color: ${color};"></div>`;
      } else if (geometryType === 'polygon') {
        html += `<div class="symbology-symbol" style="background-color: ${color}; opacity: 0.6;"></div>`;
      } else {
        html += `<div class="symbology-symbol point" style="background-color: ${color};"></div>`;
      }
      
      html += `<div class="symbology-label">`;
      html += `<div class="symbology-value">${value}</div>`;
      html += `<div class="symbology-count">(${count})</div>`;
      html += `</div>`;
      html += `</div>`;
    });
    
    html += `</div>`;
    return html;
  }
  
  // Filtrar solo las capas activas que pertenecen al Inventario CAEM o Inundaciones
  const activeInventoryLayers = Object.keys(capasActivas).filter(name => 
    Object.keys(capasParaSimbologia).includes(name)
  );
  
  if (activeInventoryLayers.length === 0) {
    content.innerHTML = '<div class="symbology-empty">No hay capas activas para mostrar en simbología</div>';
    return;
  }
  
  let html = '';
  
  // Crear secciones separadas para Inventario CAEM, Inundaciones y Contexto Geográfico
  const inventarioActiveLayers = activeInventoryLayers.filter(name => inventarioCAEM[name]);
  const inundacionesActiveLayers = activeInventoryLayers.filter(name => inundaciones[name]);
  const contextoActiveLayers = activeInventoryLayers.filter(name => contextoGeografico[name]);
  
  // Sección Inventario CAEM
  if (inventarioActiveLayers.length > 0) {
    const totalInventario = inventarioActiveLayers.reduce((sum, layerName) => {
      const layer = capasActivas[layerName];
      return sum + (layer && layer.getLayers ? layer.getLayers().length : 0);
    }, 0);
    
    html += `<div class="symbology-section">`;
    html += `<div class="symbology-section-title">Inventario CAEM <span class="symbology-section-count">(${totalInventario})</span></div>`;
    
    inventarioActiveLayers.forEach(layerName => {
      html += processLayer(layerName, capasParaSimbologia[layerName]);
    });
    
    html += `</div>`;
  }
  
  // Sección Inundaciones
  if (inundacionesActiveLayers.length > 0) {
    const totalInundaciones = inundacionesActiveLayers.reduce((sum, layerName) => {
      const layer = capasActivas[layerName];
      return sum + (layer && layer.getLayers ? layer.getLayers().length : 0);
    }, 0);
    
    html += `<div class="symbology-section">`;
    html += `<div class="symbology-section-title">Inundaciones <span class="symbology-section-count">(${totalInundaciones})</span></div>`;
    
    inundacionesActiveLayers.forEach(layerName => {
      html += processLayer(layerName, capasParaSimbologia[layerName]);
    });
    
    html += `</div>`;
  }
  
  // Sección Contexto Geográfico
  if (contextoActiveLayers.length > 0) {
    const totalContexto = contextoActiveLayers.reduce((sum, layerName) => {
      const layer = capasActivas[layerName];
      return sum + (layer && layer.getLayers ? layer.getLayers().length : 0);
    }, 0);
    
    html += `<div class="symbology-section">`;
    html += `<div class="symbology-section-title">Contexto Geográfico <span class="symbology-section-count">(${totalContexto})</span></div>`;
    
    contextoActiveLayers.forEach(layerName => {
      html += processLayer(layerName, capasParaSimbologia[layerName]);
    });
    
    html += `</div>`;
  }
  
  content.innerHTML = html;
}

// Variables para búsqueda de lugares
let searchPlacesMarker = null;
let searchTimeout = null;

function toggleSearchPlaces() {
  const panel = document.getElementById('search-places-panel');
  const btn = document.getElementById('search-places-btn');
  
  if (panel.classList.contains('show')) {
    panel.classList.remove('show');
    btn.classList.remove('active');
  } else {
    panel.classList.add('show');
    btn.classList.add('active');
    document.getElementById('search-places-input').focus();
  }
}

async function searchPlaces(event) {
  const query = event.target.value.trim();
  const resultsDiv = document.getElementById('search-places-results');
  const loadingDiv = document.getElementById('search-places-loading');
  
  // Limpiar timeout anterior
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }
  
  if (query.length < 3) {
    resultsDiv.innerHTML = '';
    return;
  }
  
  // Esperar 500ms después de que el usuario deje de escribir
  searchTimeout = setTimeout(async () => {
    loadingDiv.classList.add('show');
    resultsDiv.innerHTML = '';
    
    try {
      // Usar Nominatim de OpenStreetMap para búsqueda
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=mx`
      );
      
      if (!response.ok) throw new Error('Error en la búsqueda');
      
      const results = await response.json();
      loadingDiv.classList.remove('show');
      
      if (results.length === 0) {
        resultsDiv.innerHTML = '<div style="padding: 15px; text-align: center; color: #999; font-size: 12px;">No se encontraron resultados</div>';
        return;
      }
      
      resultsDiv.innerHTML = results.map(result => `
        <div class="search-result-item" onclick="goToPlace(${result.lat}, ${result.lon}, '${result.display_name.replace(/'/g, "\\'")}')">
          <div class="place-name">${result.display_name.split(',')[0]}</div>
          <div class="place-address">${result.display_name}</div>
        </div>
      `).join('');
      
    } catch (error) {
      loadingDiv.classList.remove('show');
      resultsDiv.innerHTML = '<div style="padding: 15px; text-align: center; color: #e74c3c; font-size: 12px;">⚠️ Error al buscar lugares</div>';
    }
  }, 500);
}

function goToPlace(lat, lon, name) {
  // Remover marcador anterior si existe
  if (searchPlacesMarker) {
    map.removeLayer(searchPlacesMarker);
  }
  
  // Crear nuevo marcador con ícono personalizado
  searchPlacesMarker = L.marker([lat, lon], {
    icon: L.divIcon({
      className: 'custom-search-marker',
      html: `
        <div style="
          background: linear-gradient(135deg, #8a2035 0%, #b99056 100%); 
          width: 30px; 
          height: 30px; 
          border-radius: 50% 50% 50% 0; 
          transform: rotate(-45deg); 
          border: 3px solid white; 
          box-shadow: 0 4px 8px rgba(0,0,0,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <div style="
            width: 12px; 
            height: 12px; 
            background: white; 
            border-radius: 50%;
            transform: rotate(45deg);
          "></div>
        </div>
      `,
      iconSize: [30, 30],
      iconAnchor: [15, 30],
      popupAnchor: [0, -30]
    })
  }).addTo(map);
  
  // Crear popup con el nombre del lugar
  searchPlacesMarker.bindPopup(`
    <div style="font-family: 'Segoe UI', Arial, sans-serif; padding: 5px;">
      <strong style="color: #8a2035; font-size: 13px;">${name.split(',')[0]}</strong><br>
      <span style="font-size: 11px; color: #666;">${name}</span><br>
      <span style="font-size: 10px; color: #999; margin-top: 5px; display: block;">
        ${lat.toFixed(6)}°, ${lon.toFixed(6)}°
      </span>
    </div>
  `).openPopup();
  
  // Centrar el mapa en la ubicación
  map.setView([lat, lon], 14, {
    animate: true,
    duration: 1
  });
  
  // Cerrar el panel de búsqueda
  document.getElementById('search-places-panel').classList.remove('show');
  document.getElementById('search-places-btn').classList.remove('active');
}

map.on('click', function(e) {
  // Si estamos en modo de medición, cerrar todos los popups para evitar interferencias
  if (measureMode || profileMode || areaMode) {
    map.closePopup();
  }
  
  if (measureMode) {
    // Prevenir que otros elementos capturen el evento
    if (e.originalEvent) {
      L.DomEvent.stopPropagation(e.originalEvent);
    }
    
    measurePoints.push(e.latlng);
    
    if (currentMeasureLine) {
      measureLayer.removeLayer(currentMeasureLine);
    }
    
    if (measurePoints.length > 1) {
      currentMeasureLine = L.polyline(measurePoints, {
        color: '#8a2035',
        weight: 3,
        opacity: 0.7
      }).addTo(measureLayer);
      
      let totalDistance = 0;
      for (let i = 0; i < measurePoints.length - 1; i++) {
        totalDistance += measurePoints[i].distanceTo(measurePoints[i + 1]);
      }
      
      const distanceKm = (totalDistance / 1000).toFixed(2);
      currentMeasureLine.bindPopup(`Distancia: ${distanceKm} km`).openPopup();
    }
    
    L.circleMarker(e.latlng, {
      radius: 5,
      color: '#8a2035',
      fillColor: '#fff',
      fillOpacity: 1,
      weight: 2
    }).addTo(measureLayer);
    
    return; // No propagar el evento
  }
  
  if (profileMode) {
    // Prevenir que otros elementos capturen el evento
    if (e.originalEvent) {
      L.DomEvent.stopPropagation(e.originalEvent);
    }
    
    if (!profileLine) {
      profileLine = {
        start: e.latlng,
        line: null
      };
      L.circleMarker(e.latlng, {
        radius: 5,
        color: '#b99056',
        fillColor: '#fff',
        fillOpacity: 1,
        weight: 2
      }).addTo(measureLayer);
    } else {
      const line = L.polyline([profileLine.start, e.latlng], {
        color: '#b99056',
        weight: 3,
        opacity: 0.7
      }).addTo(measureLayer);
      
      L.circleMarker(e.latlng, {
        radius: 5,
        color: '#b99056',
        fillColor: '#fff',
        fillOpacity: 1,
        weight: 2
      }).addTo(measureLayer);
      
      getElevationProfile(profileLine.start, e.latlng);
      profileLine = null;
    }
    
    return; // No propagar el evento
  }
  
  if (areaMode) {
    // Prevenir que otros elementos capturen el evento
    if (e.originalEvent) {
      L.DomEvent.stopPropagation(e.originalEvent);
    }
    
    // Si ya hay al menos 3 puntos, verificar si el clic está cerca del primer punto
    if (areaPoints.length >= 3) {
      const firstPoint = areaPoints[0];
      const distance = e.latlng.distanceTo(firstPoint);
      const tolerancePixels = 15; // Tolerancia en píxeles
      const tolerance = tolerancePixels * 40075000 / (256 * Math.pow(2, map.getZoom())); // Convertir píxeles a metros según el zoom
      
      if (distance < tolerance) {
        // Cerrar el polígono - copiar la lógica del clic derecho
        map.closePopup();
        
        // Remover el polígono temporal
        if (currentAreaPolygon) {
          measureLayer.removeLayer(currentAreaPolygon);
        }
        
        // Crear el polígono cerrado
        currentAreaPolygon = L.polygon(areaPoints, {
          color: '#8a2035',
          fillColor: '#b99056',
          weight: 3,
          opacity: 1,
          fillOpacity: 0.25
        }).addTo(measureLayer);
        
        // Calcular área
        let areaM2;
        try {
          areaM2 = L.GeometryUtil && L.GeometryUtil.geodesicArea 
            ? L.GeometryUtil.geodesicArea(areaPoints)
            : calcularAreaGeodesica(areaPoints);
        } catch (error) {
          areaM2 = calcularAreaGeodesica(areaPoints);
        }
        
        const areaKm2 = (areaM2 / 1000000).toFixed(4);
        const areaHa = (areaM2 / 10000).toFixed(2);
        
        // Calcular perímetro
        let perimeter = 0;
        for (let i = 0; i < areaPoints.length; i++) {
          const nextIndex = (i + 1) % areaPoints.length;
          perimeter += areaPoints[i].distanceTo(areaPoints[nextIndex]);
        }
        const perimeterKm = (perimeter / 1000).toFixed(3);
        
        // Crear y mostrar el popup
        const popupContent = `
          <div style="font-family: 'Segoe UI', Arial, sans-serif; padding: 8px; font-size: 11px;">
            <div style="line-height: 1.5;">
              <strong style="color: #8a2035; font-size: 11px;">Área:</strong><br>
              <span style="margin-left: 8px; font-size: 10px;">• ${areaKm2} km²</span><br>
              <span style="margin-left: 8px; font-size: 10px;">• ${areaHa} ha</span><br>
              <strong style="color: #8a2035; margin-top: 5px; display: inline-block; font-size: 11px;">Perímetro:</strong><br>
              <span style="margin-left: 8px; font-size: 10px;">• ${perimeterKm} km</span>
            </div>
          </div>
        `;
        
        currentAreaPolygon.bindPopup(popupContent, {
          maxWidth: 200,
          className: 'measurement-popup'
        }).openPopup();
        
        return; // No propagar el evento
      }
    }
    
    areaPoints.push(e.latlng);
    
    L.circleMarker(e.latlng, {
      radius: 5,
      color: '#8a2035',
      fillColor: '#fff',
      fillOpacity: 1,
      weight: 2
    }).addTo(measureLayer);
    
    if (currentAreaPolygon) {
      measureLayer.removeLayer(currentAreaPolygon);
    }
    
    // Mostrar polígono temporal sin popup
    if (areaPoints.length >= 2) {
      currentAreaPolygon = L.polyline(areaPoints, {
        color: '#8a2035',
        weight: 3,
        opacity: 0.8
      }).addTo(measureLayer);
    }
    
    return; // No propagar el evento
  }
});

// Evento de clic derecho para cerrar el polígono en modo área
map.on('contextmenu', function(e) {
  if (areaMode && areaPoints.length >= 3) {
    // Prevenir el menú contextual del navegador
    L.DomEvent.preventDefault(e);
    
    // Cerrar popups
    map.closePopup();
    
    // Prevenir propagación
    if (e.originalEvent) {
      L.DomEvent.stopPropagation(e.originalEvent);
    }
    
    // Remover el polígono temporal
    if (currentAreaPolygon) {
      measureLayer.removeLayer(currentAreaPolygon);
    }
    
    // Crear el polígono cerrado
    currentAreaPolygon = L.polygon(areaPoints, {
      color: '#8a2035',
      fillColor: '#b99056',
      weight: 3,
      opacity: 1,
      fillOpacity: 0.25
    }).addTo(measureLayer);
    
    // Calcular área usando nuestra función personalizada o L.GeometryUtil si está disponible
    let areaM2;
    try {
      areaM2 = L.GeometryUtil && L.GeometryUtil.geodesicArea 
        ? L.GeometryUtil.geodesicArea(areaPoints)
        : calcularAreaGeodesica(areaPoints);
    } catch (error) {
      areaM2 = calcularAreaGeodesica(areaPoints);
    }
    
    const areaKm2 = (areaM2 / 1000000).toFixed(4);
    const areaHa = (areaM2 / 10000).toFixed(2);
    
    // Calcular perímetro
    let perimeter = 0;
    for (let i = 0; i < areaPoints.length; i++) {
      const nextIndex = (i + 1) % areaPoints.length;
      perimeter += areaPoints[i].distanceTo(areaPoints[nextIndex]);
    }
    const perimeterKm = (perimeter / 1000).toFixed(3);
    
    // Crear y mostrar el popup inmediatamente
    const popupContent = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; padding: 8px; font-size: 11px;">
        <div style="line-height: 1.5;">
          <strong style="color: #8a2035; font-size: 11px;">Área:</strong><br>
          <span style="margin-left: 8px; font-size: 10px;">• ${areaKm2} km²</span><br>
          <span style="margin-left: 8px; font-size: 10px;">• ${areaHa} ha</span><br>
          <strong style="color: #8a2035; margin-top: 5px; display: inline-block; font-size: 11px;">Perímetro:</strong><br>
          <span style="margin-left: 8px; font-size: 10px;">• ${perimeterKm} km</span>
        </div>
      </div>
    `;
    
    currentAreaPolygon.bindPopup(popupContent, {
      maxWidth: 180,
      className: 'area-popup'
    });
    
    // Abrir el popup en el centro del polígono
    const bounds = currentAreaPolygon.getBounds();
    const center = bounds.getCenter();
    currentAreaPolygon.openPopup(center);
    
    // Desactivar el modo de medición de área
    areaMode = false;
    document.getElementById('area-btn').classList.remove('active');
    map.getContainer().style.cursor = '';
    enableLayersInteractivity();
  }
});

async function getElevationProfile(start, end) {
  const status = document.getElementById('status');
  showLoading('Generando perfil de elevación', 'Consultando elevaciones del terreno...');
  status.textContent = '🔄 Obteniendo perfil de elevación...';
  status.className = 'status-info';
  
  const numPoints = 100;
  const elevations = [];
  const distances = [];
  
  const totalDistance = start.distanceTo(end);
  
  for (let i = 0; i <= numPoints; i++) {
    const fraction = i / numPoints;
    const lat = start.lat + (end.lat - start.lat) * fraction;
    const lng = start.lng + (end.lng - start.lng) * fraction;
    
    const distance = (totalDistance * fraction) / 1000; // en km
    distances.push(distance);
    
    try {
      const response = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`);
      const data = await response.json();
      const elevation = data.results[0].elevation;
      elevations.push(elevation);
    } catch (error) {
      elevations.push(0);
    }
  }
  
  status.textContent = '✅ Perfil de elevación generado';
  status.className = 'status-success';
  
  hideLoading();
  
  // Mostrar el panel del perfil de elevación
  document.getElementById('elevation-profile').classList.add('show');
  
  drawElevationChart(distances, elevations);
}

function buscarCoordenadas() {
  const lat = parseFloat(document.getElementById('search-lat').value);
  const lon = parseFloat(document.getElementById('search-lon').value);
  
  if (isNaN(lat) || isNaN(lon)) {
    alert('Por favor ingresa coordenadas válidas');
    return;
  }
  
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    alert('Coordenadas fuera de rango válido');
    return;
  }
  
  if (searchMarker) {
    map.removeLayer(searchMarker);
  }
  
  searchMarker = L.marker([lat, lon], {
    icon: L.divIcon({
      className: 'search-marker',
      html: '<div style="background: #8a2035; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    })
  }).addTo(map);
  
  searchMarker.bindPopup(`<b>Ubicación buscada</b><br>Lat: ${lat.toFixed(4)}°<br>Lon: ${lon.toFixed(4)}°`).openPopup();
  
  map.setView([lat, lon], 14);
}

function drawElevationChart(distances, elevations) {
  const canvas = document.getElementById('elevation-chart');
  const ctx = canvas.getContext('2d');
  
  // Ajustar el tamaño del canvas
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  
  const padding = { top: 45, right: 30, bottom: 55, left: 70 };
  const width = canvas.width - padding.left - padding.right;
  const height = canvas.height - padding.top - padding.bottom;
  
  // Limpiar canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Fondo
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Encontrar valores mínimos y máximos con margen adicional
  const minElev = Math.min(...elevations);
  const maxElev = Math.max(...elevations);
  const elevRange = maxElev - minElev;
  // Agregar 10% de margen arriba y abajo para dar espacio
  const elevMargin = elevRange * 0.1;
  const displayMinElev = minElev - elevMargin;
  const displayMaxElev = maxElev + elevMargin;
  const displayRange = displayMaxElev - displayMinElev;
  const maxDist = Math.max(...distances);
  
  // Dibujar líneas de cuadrícula y etiquetas del eje Y (elevación)
  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#666';
  ctx.font = '11px Arial';
  
  const numYTicks = 5;
  for (let i = 0; i <= numYTicks; i++) {
    const y = padding.top + (height * i) / numYTicks;
    const elev = displayMaxElev - (displayRange * i) / numYTicks;
    
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + width, y);
    ctx.stroke();
    
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(elev) + 'm', padding.left - 10, y + 4);
  }
  
  // Dibujar líneas de cuadrícula y etiquetas del eje X (distancia)
  const numXTicks = 6;
  for (let i = 0; i <= numXTicks; i++) {
    const x = padding.left + (width * i) / numXTicks;
    const dist = (maxDist * i) / numXTicks;
    
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + height);
    ctx.stroke();
    
    ctx.textAlign = 'center';
    ctx.fillText(dist.toFixed(1) + 'km', x, padding.top + height + 20);
  }
  
  // Etiqueta del eje X
  ctx.fillStyle = '#47161D';
  ctx.font = 'bold 12px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('Distancia (km)', padding.left + width / 2, canvas.height - 15);
  
  // Etiqueta del eje Y
  ctx.save();
  ctx.fillStyle = '#47161D';
  ctx.font = 'bold 12px Arial';
  ctx.translate(15, padding.top + height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText('Elevación (m)', 0, 0);
  ctx.restore();
  
  // Dibujar área de relleno bajo la línea
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top + height);
  
  for (let i = 0; i < elevations.length; i++) {
    const x = padding.left + (distances[i] / maxDist) * width;
    const normalizedElev = (elevations[i] - displayMinElev) / displayRange;
    const y = padding.top + height - (normalizedElev * height);
    
    if (i === 0) {
      ctx.lineTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  
  ctx.lineTo(padding.left + width, padding.top + height);
  ctx.closePath();
  ctx.fillStyle = 'rgba(138, 32, 53, 0.15)';
  ctx.fill();
  
  // Dibujar línea de perfil suave
  ctx.beginPath();
  ctx.strokeStyle = '#8a2035';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  
  for (let i = 0; i < elevations.length; i++) {
    const x = padding.left + (distances[i] / maxDist) * width;
    const normalizedElev = (elevations[i] - displayMinElev) / displayRange;
    const y = padding.top + height - (normalizedElev * height);
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  
  ctx.stroke();
  
  // Marco del gráfico
  ctx.strokeStyle = '#47161D';
  ctx.lineWidth = 2;
  ctx.strokeRect(padding.left, padding.top, width, height);
  
  // Información adicional en la parte superior
  ctx.fillStyle = '#47161D';
  ctx.font = 'bold 10px Arial';
  ctx.textAlign = 'center';
  const info = `Min: ${Math.round(minElev)}m | Max: ${Math.round(maxElev)}m | Diferencia: ${Math.round(elevRange)}m | Distancia: ${maxDist.toFixed(2)}km`;
  ctx.fillText(info, padding.left + width / 2, padding.top - 10);
}

async function conectar() {
  // Configuración de Supabase pre-establecida
  supabaseUrl = document.getElementById('url').value.trim() || 'https://ppdpjvfpujjfbwpuifmi.supabase.co';
  supabaseKey = document.getElementById('key').value.trim() || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwZHBqdmZwdWpqZmJ3cHVpZm1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA1MDAzMDksImV4cCI6MjA3NjA3NjMwOX0.2Pm_217ZLaYS-W8fDyE7bEr0IP0Y-fNZwVkuboBRRDo';
  
  // Establecer los valores en los campos si están vacíos
  document.getElementById('url').value = supabaseUrl;
  document.getElementById('key').value = supabaseKey;
  
  const status = document.getElementById('status');
  
  if (!supabaseUrl || !supabaseKey) {
    status.textContent = '⚠️ Completa URL y API Key';
    status.className = 'status-error';
    return;
  }
  
  showLoading('Conectando', 'Descubriendo capas disponibles...');
  status.textContent = '🔄 Conectando y descubriendo capas...';
  status.className = 'status-info';
  
  try {
    // Nombres exactos de las tablas en Supabase (con espacios y guiones)
    // NOTA: Puedes agregar más tablas aquí según las tengas en tu base de datos PH_AOA
    const tablasEsperadas = [
      // Atlas de Inundaciones
      'atlas temporada 2020',
      'atlas temporada 2021',
      'atlas temporada 2022',
      'atlas temporada 2023',
      'atlas temporada 2024',
      // Inventario CAEM
      'cajas de captacion',
      'cajas derivadoras',
      'cajas rompedoras de presion',
      'campamentos_edomex',
      'carcamos',
      'fosas septicas',
      'galeria filtrante',
      'lineas de conduccion-ap',
      'lineasdistribucion-drenaje',
      'manantiales',
      'obras de toma',
      'plantas de bombeo',
      'plantas de tratamiento',
      'pozos',
      'tanques',
      // Contexto Geográfico
      'cuerpos de agua',
      'curvas de nivel',
      'estadomex',
      'estadomex_geojson',
      'municipios',
      'municipios_geojson',
      'regiones',
      'regiones_geojson',
      'riesgo de inundacion',
      'rios y arroyos'
      // Agrega aquí más tablas según las vayas creando en Supabase
    ];
    
    console.log('🔍 Buscando capas en Supabase...');
    console.log('📋 URL de Supabase:', supabaseUrl);
    console.log('📋 Tablas esperadas:', tablasEsperadas);
    
    // Intentar listar todas las tablas disponibles
    try {
      const schemaRes = await fetch(`${supabaseUrl}/rest/v1/`, {
        headers: { 
          'apikey': supabaseKey, 
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        }
      });
      if (schemaRes.ok) {
        console.log('✅ Conexión a Supabase exitosa');
      } else {
        console.error('❌ Error de conexión:', schemaRes.status, schemaRes.statusText);
      }
    } catch (e) {
      console.warn('⚠️ No se pudo verificar la conexión:', e.message);
    }
    
    capasConfig = {};
    let colorIdx = 0;
    
    // Intentar conectar a cada tabla directamente
    const promesas = tablasEsperadas.map(async tbl => {
      try {
        // Codificar el nombre de la tabla para la URL (espacios y caracteres especiales)
        const encodedTable = encodeURIComponent(tbl);
        const testUrl = `${supabaseUrl}/rest/v1/${encodedTable}?select=*&limit=1`;
        console.log(`🔍 Probando tabla: ${tbl} (URL: ${testUrl})`);
        
        const r = await fetch(testUrl, {
          headers: { 
            'apikey': supabaseKey, 
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (r.ok) {
          const sampleData = await r.json();
          const hasData = sampleData && sampleData.length > 0;
          
          console.log(`${hasData ? '✅' : '⚠️'} Tabla ${tbl}: ${hasData ? 'CON DATOS' : 'VACÍA'} - Registros: ${sampleData.length}`);
          
          // Asignar color específico
          let color;
          if (tbl.includes('atlas temporada')) {
            // Azul fuerte para todas las capas de inundaciones
            color = '#0066CC'; // Azul fuerte que resalta
          } else if (tbl === 'riesgo de inundacion') {
            color = '#1E88E5'; // Azul medio para riesgo de inundacion (será categorizado)
          } else if (tbl === 'curvas de nivel') {
            color = '#795548'; // Café para curvas de nivel
          } else if (tbl.includes('cuerpos') || (tbl.includes('agua') && !tbl.includes('atlas'))) {
            color = '#0077be'; // Azul para cuerpos de agua
          } else if (tbl.includes('rios') || tbl.includes('arroyos')) {
            color = '#4A90E2'; // Azul claro para ríos
          } else if (tbl === 'estadomex' || tbl === 'estadomex_geojson') {
            color = '#000000'; // Negro para límite estatal
          } else if (tbl.includes('cajas')) {
            color = '#b48a3f'; // Naranja para cajas
          } else if (tbl === 'campamentos_edomex') {
            color = '#4CAF50'; // Verde para campamentos Tlaloc
          } else if (tbl === 'carcamos') {
            color = '#e98a3f'; // Naranja oscuro para cárcamos
          } else if (tbl === 'fosas septicas') {
            color = '#774720ff'; // Café para fosas sépticas
          } else if (tbl === 'galeria filtrante') {
            color = '#722bb4'; // Cian para galería filtrante
          } else if (tbl === 'manantiales') {
            color = '#2b51b4'; // Cian claro para manantiales
          } else if (tbl === 'obras de toma') {
            color = '#26C6DA'; // Cian medio para obras de toma
          } else if (tbl.includes('plantas de bombeo')) {
            color = '#9C27B0'; // Morado para plantas de bombeo
          } else if (tbl.includes('plantas de tratamiento')) {
            color = '#673AB7'; // Morado oscuro para plantas de tratamiento
          } else if (tbl === 'pozos') {
            color = '#3F51B5'; // Índigo para pozos
          } else if (tbl === 'tanques') {
            color = '#2196F3'; // Azul para tanques
          } else if (tbl === 'lineasdistribucion-drenaje') {
            color = '#3d3d3d'; // Gris oscuro para líneas de distribución drenaje
          } else if (tbl.includes('lineas')) {
            color = '#FF6B6B'; // Rojo para líneas de conducción
          } else if (tbl.includes('municipios')) {
            color = '#8a2035'; // Vino para municipios
          } else if (tbl.includes('regiones')) {
            color = '#9C27B0'; // Morado para regiones
          } else {
            color = colores[colorIdx % colores.length];
            colorIdx++;
          }
          
          capasConfig[tbl] = {
            tipo: null,
            srid: null,
            columna_geom: 'geom',
            color: color,
            hasData: hasData
          };
          
          return tbl;
        } else {
          const errorText = await r.text();
          console.log(`❌ Tabla ${tbl}: No accesible (${r.status}) - ${errorText.substring(0, 100)}`);
        }
        return null;
      } catch (err) {
        console.log(`❌ Error al acceder a ${tbl}:`, err.message);
        return null;
      }
    });
    
    await Promise.all(promesas);
    
    const capasEncontradas = Object.keys(capasConfig);
    const capasConDatos = capasEncontradas.filter(c => capasConfig[c].hasData);
    const capasVacias = capasEncontradas.filter(c => !capasConfig[c].hasData);
    
    console.log('📋 Capas encontradas:', capasEncontradas);
    console.log(`✅ Capas con datos (${capasConDatos.length}):`, capasConDatos);
    console.log(`⚠️ Capas vacías (${capasVacias.length}):`, capasVacias);
    
    if (capasEncontradas.length === 0) {
      throw new Error('No se encontraron capas espaciales.');
    }
    
    let mensaje = `✅ Conectado - ${capasEncontradas.length} capas encontradas`;
    if (capasVacias.length > 0) {
      mensaje += ` (${capasVacias.length} vacías)`;
    }
    
    status.textContent = mensaje;
    status.className = 'status-success';
    hideLoading();
    mostrarCapas();
  } catch (err) {
    console.error('❌ Error de conexión:', err);
    status.textContent = '❌ Error: ' + err.message;
    status.className = 'status-error';
    hideLoading();
  }
}

function mostrarCapas() {
  const layersDiv = document.getElementById('layers');
  const layersSection = document.getElementById('layers-section');
  layersSection.style.display = 'block';
  layersDiv.innerHTML = '';
  
  // Obtener todas las capas disponibles
  const capasDisponibles = Object.keys(capasConfig);
  
  console.log('Capas disponibles en Supabase:', capasDisponibles);
  
  // Definir el orden específico para cada grupo
  const ordenInundaciones = [
    'atlas temporada 2020',
    'atlas temporada 2021',
    'atlas temporada 2022',
    'atlas temporada 2023',
    'atlas temporada 2024'
  ];
  
  const ordenInventarioCAEM = [
    'cajas de captacion',
    'cajas derivadoras',
    'cajas rompedoras de presion',
    'campamentos_edomex',
    'carcamos',
    'fosas septicas',
    'galeria filtrante',
    'lineas de conduccion-ap',
    'lineasdistribucion-drenaje',
    'manantiales',
    'obras de toma',
    'plantas de bombeo',
    'plantas de tratamiento',
    'pozos',
    'tanques'
  ];
  
  const ordenContextoGeografico = [
    'rios y arroyos',
    'cuerpos de agua',
    'curvas de nivel',
    'riesgo de inundacion',
    'municipios',
    'regiones',
    'regiones_geojson',
    'estadomex',
    'estadomex_geojson'
  ];
  
  // Filtrar capas que existen en el orden definido
  const inundaciones = ordenInundaciones.filter(nombre => capasConfig[nombre]);
  const inventarioCAEM = ordenInventarioCAEM.filter(nombre => capasConfig[nombre]);
  const contextoGeografico = ordenContextoGeografico.filter(nombre => capasConfig[nombre]);
  
  // Identificar las capas que NO están en ninguno de los tres grupos anteriores
  const capasEnGrupos = [...ordenInundaciones, ...ordenInventarioCAEM, ...ordenContextoGeografico];
  const otrasCapas = capasDisponibles.filter(nombre => !capasEnGrupos.includes(nombre));
  
  // Crear grupo Inventario CAEM (incluye capas predefinidas + capas nuevas automáticamente)
  if (inventarioCAEM.length > 0 || otrasCapas.length > 0) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'layers-group';
    
    const titleDiv = document.createElement('div');
    titleDiv.className = 'layers-group-title';
    titleDiv.innerHTML = '<span>Inventario CAEM</span><span class="layers-group-toggle collapsed">▼</span>';
    titleDiv.onclick = () => toggleLayerGroup(titleDiv.nextElementSibling, titleDiv.querySelector('.layers-group-toggle'));
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'layers-group-content collapsed';
    
    // Agregar capas predefinidas del Inventario CAEM
    inventarioCAEM.forEach(nombre => {
      contentDiv.appendChild(createLayerItem(nombre, nombresCapas[nombre] || nombre));
    });
    
    // NUEVO: Agregar automáticamente las capas nuevas al Inventario CAEM
    if (otrasCapas.length > 0) {
      // Ordenar alfabéticamente las capas nuevas
      otrasCapas.sort().forEach(nombre => {
        contentDiv.appendChild(createLayerItem(nombre, nombresCapas[nombre] || nombre));
      });
    }
    
    groupDiv.appendChild(titleDiv);
    groupDiv.appendChild(contentDiv);
    layersDiv.appendChild(groupDiv);
  }
  
  // Crear grupo Inundaciones
  if (inundaciones.length > 0) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'layers-group';
    
    const titleDiv = document.createElement('div');
    titleDiv.className = 'layers-group-title';
    titleDiv.innerHTML = '<span>Inundaciones</span><span class="layers-group-toggle collapsed">▼</span>';
    titleDiv.onclick = () => toggleLayerGroup(titleDiv.nextElementSibling, titleDiv.querySelector('.layers-group-toggle'));
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'layers-group-content collapsed';
    
    inundaciones.forEach(nombre => {
      contentDiv.appendChild(createLayerItem(nombre, nombresCapas[nombre] || nombre));
    });
    
    groupDiv.appendChild(titleDiv);
    groupDiv.appendChild(contentDiv);
    layersDiv.appendChild(groupDiv);
  }
  
  // Crear grupo Contexto Geográfico
  if (contextoGeografico.length > 0) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'layers-group';
    
    const titleDiv = document.createElement('div');
    titleDiv.className = 'layers-group-title';
    titleDiv.innerHTML = '<span>Contexto Geográfico</span><span class="layers-group-toggle collapsed">▼</span>';
    titleDiv.onclick = () => toggleLayerGroup(titleDiv.nextElementSibling, titleDiv.querySelector('.layers-group-toggle'));
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'layers-group-content collapsed';
    
    contextoGeografico.forEach(nombre => {
      contentDiv.appendChild(createLayerItem(nombre, nombresCapas[nombre] || nombre));
    });
    
    groupDiv.appendChild(titleDiv);
    groupDiv.appendChild(contentDiv);
    layersDiv.appendChild(groupDiv);
  }
}

function toggleLayerGroup(contentDiv, toggleIcon) {
  contentDiv.classList.toggle('collapsed');
  toggleIcon.classList.toggle('collapsed');
}

function createLayerItem(nombre, nombreDisplay) {
  const div = document.createElement('div');
  div.className = 'layer-item';
  
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = `layer_${nombre}`;
  checkbox.onchange = () => toggleCapa(nombre, checkbox.checked);
  
  const label = document.createElement('label');
  label.textContent = nombreDisplay || nombre;
  label.htmlFor = `layer_${nombre}`;
  
  // Agregar indicador si la capa está vacía
  if (capasConfig[nombre] && !capasConfig[nombre].hasData) {
    const emptyBadge = document.createElement('span');
    emptyBadge.textContent = ' (vacía)';
    emptyBadge.style.color = '#ff6b6b';
    emptyBadge.style.fontSize = '10px';
    emptyBadge.style.fontWeight = 'normal';
    label.appendChild(emptyBadge);
    checkbox.disabled = true;
    checkbox.title = 'Esta capa no contiene datos';
  }
  
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'layer-actions';
  
  const zoomBtn = document.createElement('button');
  zoomBtn.className = 'zoom-btn';
  zoomBtn.innerHTML = '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="14" fill="none" stroke="#b99056" stroke-width="3"/><line x1="34" y1="34" x2="46" y2="46" stroke="#b99056" stroke-width="4" stroke-linecap="round"/><line x1="24" y1="18" x2="24" y2="30" stroke="#b99056" stroke-width="2.5"/><line x1="18" y1="24" x2="30" y2="24" stroke="#b99056" stroke-width="2.5"/></svg>';
  zoomBtn.title = `Zoom a ${nombreDisplay || nombre}`;
  zoomBtn.onclick = (e) => {
    e.stopPropagation();
    zoomToCapa(nombre);
  };
  
  const downloadBtn = document.createElement('button');
  downloadBtn.className = 'download-btn';
  downloadBtn.innerHTML = '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M32 8 L32 40 M20 28 L32 40 L44 28" stroke="#b99056" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect x="12" y="48" width="40" height="6" rx="2" fill="#b99056"/></svg>';
  downloadBtn.title = `Descargar ${nombreDisplay || nombre}`;
  downloadBtn.onclick = (e) => {
    e.stopPropagation();
    descargarCapa(nombre);
  };
  
  actionsDiv.appendChild(zoomBtn);
  actionsDiv.appendChild(downloadBtn);
  
  div.appendChild(checkbox);
  div.appendChild(label);
  div.appendChild(actionsDiv);
  
  return div;
}

async function toggleCapa(nombre, activar) {
  if (activar) {
    await cargarCapa(nombre);
    ultimaCapaActivada = nombre; // Rastrear la última capa activada
    console.log(`🎯 Última capa activada: ${nombre}`);
    
    // Abrir automáticamente la ventana de simbología
    openSymbologyModal();
  } else {
    if (capasActivas[nombre]) {
      // Si es la capa de regiones, eliminar las etiquetas PRIMERO
      if ((nombre === 'regiones' || nombre === 'regiones_geojson')) {
        if (capasActivas[nombre].labels && Array.isArray(capasActivas[nombre].labels)) {
          console.log(`🏷️ Eliminando ${capasActivas[nombre].labels.length} etiquetas de ${nombre}`);
          capasActivas[nombre].labels.forEach(label => {
            if (map.hasLayer(label)) {
              map.removeLayer(label);
            }
          });
          // Limpiar el array de etiquetas
          capasActivas[nombre].labels = [];
        }
      }
      
      // Luego remover la capa del mapa
      if (map.hasLayer(capasActivas[nombre])) {
        map.removeLayer(capasActivas[nombre]);
      }
      
      delete capasActivas[nombre];
      
      // Si se desactiva la última capa activada, actualizar a null o a otra capa activa
      if (ultimaCapaActivada === nombre) {
        const capasActivasArray = Object.keys(capasActivas);
        ultimaCapaActivada = capasActivasArray.length > 0 ? capasActivasArray[capasActivasArray.length - 1] : null;
      }
    }
    
    // Actualizar la simbología si la ventana está abierta
    const modal = document.getElementById('symbology-modal');
    if (modal.classList.contains('show')) {
      updateSymbology();
      
      // Si no quedan capas activas para mostrar en simbología, cerrar la ventana
      const capasParaSimbologia = [
        'cajas de captacion', 'cajas derivadoras', 'cajas rompedoras de presion',
        'campamentos_edomex', 'carcamos', 'fosas septicas', 'galeria filtrante',
        'lineas de conduccion-ap', 'lineasdistribucion-drenaje', 'manantiales',
        'obras de toma', 'plantas de bombeo', 'plantas de tratamiento', 'pozos', 'tanques',
        'atlas temporada 2020', 'atlas temporada 2021', 'atlas temporada 2022',
        'atlas temporada 2023', 'atlas temporada 2024',
        'cuerpos de agua', 'curvas de nivel', 'estadomex', 'estadomex_geojson',
        'municipios', 'municipios_geojson', 'regiones', 'regiones_geojson',
        'riesgo de inundacion', 'rios y arroyos'
      ];
      
      const hasSymbologyLayers = Object.keys(capasActivas).some(name => 
        capasParaSimbologia.includes(name)
      );
      
      if (!hasSymbologyLayers) {
        closeSymbologyModal();
      }
    }
  }
}

async function zoomToCapa(nombre) {
  const status = document.getElementById('status');
  
  if (!capasActivas[nombre]) {
    // Si la capa no está activa, activarla primero
    document.getElementById(`layer_${nombre}`).checked = true;
    await cargarCapa(nombre);
  }
  
  if (capasActivas[nombre]) {
    try {
      const bounds = capasActivas[nombre].getBounds();
      if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [50, 50] });
        status.textContent = `📍 Centrado en ${nombre}`;
        status.className = 'status-success';
      } else {
        status.textContent = `⚠️ No se puede centrar en ${nombre}`;
        status.className = 'status-error';
      }
    } catch (err) {
      status.textContent = `❌ Error al centrar: ${err.message}`;
      status.className = 'status-error';
    }
  }
}

async function cargarCapa(nombre) {
  const status = document.getElementById('status');
  showLoading(`Cargando capa: ${nombre}`, 'Obteniendo datos del servidor...');
  status.textContent = `🔄 Cargando ${nombre}...`;
  status.className = 'status-info';
  
  try {
    const config = capasConfig[nombre];
    
    let data = capasData[nombre];
    
    if (!data) {
      // Codificar el nombre de la tabla para la URL (espacios y caracteres especiales)
      const encodedNombre = encodeURIComponent(nombre);
      const fetchUrl = `${supabaseUrl}/rest/v1/${encodedNombre}?select=*`;
      console.log(`📥 Cargando datos de: ${nombre}`);
      console.log(`📍 URL: ${fetchUrl}`);
      
      // Cargar TODOS los registros usando paginación automática
      data = [];
      let offset = 0;
      const pageSize = 1000; // Cargar 1000 registros por página
      let hasMore = true;
      
      while (hasMore) {
        const rangeEnd = offset + pageSize - 1;
        console.log(`📄 Cargando registros ${offset}-${rangeEnd}...`);
        
        const res = await fetch(fetchUrl, {
          headers: { 
            'apikey': supabaseKey, 
            'Authorization': `Bearer ${supabaseKey}`,
            'Range': `${offset}-${rangeEnd}`,
            'Prefer': 'count=exact'
          }
        });
        
        if (!res.ok) {
          const errorText = await res.text();
          console.error(`❌ Error al cargar ${nombre}:`, res.status, errorText);
          throw new Error(`Error al cargar capa (${res.status}): ${errorText.substring(0, 100)}`);
        }
        
        const pageData = await res.json();
        data = data.concat(pageData);
        
        // Verificar si hay más datos
        const contentRange = res.headers.get('Content-Range');
        if (contentRange) {
          const match = contentRange.match(/(\d+)-(\d+)\/(\d+)/);
          if (match) {
            const [, start, end, total] = match;
            console.log(`✅ Cargados ${data.length} de ${total} registros`);
            
            // Si ya cargamos todos, terminamos
            if (parseInt(end) >= parseInt(total) - 1 || pageData.length < pageSize) {
              hasMore = false;
            } else {
              offset += pageSize;
              // Actualizar el mensaje de carga
              showLoading(`Cargando ${nombre}`, `${data.length} de ${total} registros...`);
            }
          } else {
            hasMore = false;
          }
        } else {
          // Si no hay Content-Range, asumimos que no hay más datos
          hasMore = false;
        }
      }
      
      capasData[nombre] = data;
      console.log(`🎉 Carga completa de ${nombre}: ${data.length} registros totales`);
    }
    
    if (nombre === 'municipios' || nombre === 'municipios_geojson') {
      const geoJsonLayer = L.geoJSON(null, {
        style: () => ({
          color: '#8a2035',
          weight: 2,
          opacity: 1,
          fillOpacity: 0,
          dashArray: '5, 5'  // Línea punteada
        }),
        onEachFeature: (feature, layer) => {
          const props = feature.properties;
          let popup = '<b>' + nombre + '</b><br>';
          popup += `<b>Municipio:</b> ${props.municipi_1}<br>`;
          Object.keys(props).forEach(key => {
            if (key !== 'geom' && key !== 'municipi_1') {
              popup += `${key}: ${props[key]}<br>`;
            }
          });
          layer.bindPopup(popup);
        }
      });
      
      data.forEach(row => {
        if (row.geom) {
          let geometry = typeof row.geom === 'string' ? JSON.parse(row.geom) : row.geom;
          if (geometry.coordinates) {
            geometry = reprojectGeometry(geometry);
            
            // Validar que las coordenadas sean válidas
            if (isValidGeometry(geometry)) {
              geoJsonLayer.addData({
                type: 'Feature',
                properties: row,
                geometry: geometry
              });
            } else {
              console.warn(`Geometría inválida encontrada en ${nombre}`);
            }
          }
        }
      });
      
      const featureCount = geoJsonLayer.getLayers().length;
      console.log(`✅ ${nombre}: ${featureCount} features válidas de ${data.length} registros`);
      
      if (featureCount === 0) {
        throw new Error('No se encontraron geometrías válidas en la capa');
      }
      
      geoJsonLayer.addTo(map);
      capasActivas[nombre] = geoJsonLayer;
    }
    else if (nombre === 'atlas temporada 2024') {
      const names = [...new Set(data.map(d => d.name))];
      const colorMap = {};
      names.forEach((n, idx) => {
        colorMap[n] = colores[idx % colores.length];
      });
      
      const geoJsonLayer = L.geoJSON(null, {
        pointToLayer: (feature, latlng) => {
          return L.circleMarker(latlng, {
            radius: 7,
            fillColor: colorMap[feature.properties.name] || '#0066CC',
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 1
          });
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties;
          let popup = '<b>' + nombre + '</b><br>';
          popup += `<b>Name:</b> ${props.name}<br>`;
          Object.keys(props).forEach(key => {
            if (key !== 'geom' && key !== 'name') {
              popup += `${key}: ${props[key]}<br>`;
            }
          });
          layer.bindPopup(popup);
        }
      });
      
      data.forEach(row => {
        if (row.geom) {
          let geometry = typeof row.geom === 'string' ? JSON.parse(row.geom) : row.geom;
          if (geometry.coordinates) {
            geometry = reprojectGeometry(geometry);
            
            // Validar que las coordenadas sean válidas
            if (isValidGeometry(geometry)) {
              geoJsonLayer.addData({
                type: 'Feature',
                properties: row,
                geometry: geometry
              });
            } else {
              console.warn(`Geometría inválida encontrada en ${nombre}`);
            }
          }
        }
      });
      
      const featureCount = geoJsonLayer.getLayers().length;
      console.log(`✅ ${nombre}: ${featureCount} features válidas de ${data.length} registros`);
      
      if (featureCount === 0) {
        throw new Error('No se encontraron geometrías válidas en la capa');
      }
      
      geoJsonLayer.addTo(map);
      capasActivas[nombre] = geoJsonLayer;
    }
    else if (nombre === 'cajas de captacion') {
      // Paleta de colores sólidos de morado a amarillo
      const coloresDrenaje = [
        '#440154', '#472878', '#3e4a89', '#31688e', '#26828e',
        '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#ead55a'
      ];
      
      // Obtener todos los proyectos únicos
      const proyectos = [...new Set(data.map(d => d.PROYECTO || d.proyecto || 'Sin Proyecto'))];
      const colorMap = {};
      proyectos.forEach((p, idx) => {
        // Asignar amarillo específicamente para "Colector"
        if (p === 'Colector') {
          colorMap[p] = '#FFEB3B'; // Amarillo brillante
        } else {
          colorMap[p] = coloresDrenaje[idx % coloresDrenaje.length];
        }
      });
      
      const geoJsonLayer = L.geoJSON(null, {
        pointToLayer: (feature, latlng) => {
          const proyecto = feature.properties.PROYECTO || feature.properties.proyecto || 'Sin Proyecto';
          return L.circleMarker(latlng, {
            radius: 7,
            fillColor: colorMap[proyecto] || '#b48a3f',
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 1
          });
        },
        style: (feature) => {
          const proyecto = feature.properties.PROYECTO || feature.properties.proyecto || 'Sin Proyecto';
          return {
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillColor: colorMap[proyecto] || '#999999',
            fillOpacity: 1
          };
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties;
          let popup = '<b>' + nombre + '</b><br>';
          popup += `<b>Proyecto:</b> ${props.PROYECTO || props.proyecto || 'Sin Proyecto'}<br>`;
          Object.keys(props).forEach(key => {
            if (key !== 'geom' && key !== 'PROYECTO' && key !== 'proyecto') {
              popup += `${key}: ${props[key]}<br>`;
            }
          });
          layer.bindPopup(popup);
        }
      });
      
      data.forEach(row => {
        if (row.geom) {
          let geometry = typeof row.geom === 'string' ? JSON.parse(row.geom) : row.geom;
          if (geometry.coordinates) {
            geometry = reprojectGeometry(geometry);
            
            if (isValidGeometry(geometry)) {
              geoJsonLayer.addData({
                type: 'Feature',
                properties: row,
                geometry: geometry
              });
            } else {
              console.warn(`Geometría inválida encontrada en ${nombre}`);
            }
          }
        }
      });
      
      const featureCount = geoJsonLayer.getLayers().length;
      console.log(`✅ ${nombre}: ${featureCount} features válidas de ${data.length} registros`);
      
      if (featureCount === 0) {
        throw new Error('No se encontraron geometrías válidas en la capa');
      }
      
      geoJsonLayer.addTo(map);
      capasActivas[nombre] = geoJsonLayer;
    }
    else if (nombre === 'campamentos_edomex') {
      // Estilo para Campamentos Grupo Tlaloc - Verde
      const tipos = [...new Set(data.map(d => d.tipo || d.TIPO || 'Sin Tipo'))];
      const colorMap = {};
      
      // Generar tonos de verde para cada tipo
      const tonosVerdes = ['#2E7D32', '#388E3C', '#43A047', '#4CAF50', '#66BB6A', '#81C784', '#A5D6A7'];
      
      tipos.forEach((t, idx) => {
        colorMap[t] = tonosVerdes[idx % tonosVerdes.length];
      });
      
      const geoJsonLayer = L.geoJSON(null, {
        pointToLayer: (feature, latlng) => {
          const tipo = feature.properties.tipo || feature.properties.TIPO || 'Sin Tipo';
          return L.circleMarker(latlng, {
            radius: 7,
            fillColor: colorMap[tipo] || '#4CAF50',
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 1
          });
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties;
          let popup = '<b>Campamentos Grupo Tlaloc</b><br>';
          popup += `<b>Tipo:</b> ${props.tipo || props.TIPO || 'Sin Tipo'}<br>`;
          Object.keys(props).forEach(key => {
            if (key !== 'geom' && key !== 'tipo' && key !== 'TIPO') {
              popup += `${key}: ${props[key]}<br>`;
            }
          });
          layer.bindPopup(popup);
        }
      });
      
      data.forEach(row => {
        const geomField = config.columna_geom || 'geom';
        if (row[geomField]) {
          let geometry = typeof row[geomField] === 'string' ? JSON.parse(row[geomField]) : row[geomField];
          
          if (geometry.coordinates) {
            geometry = reprojectGeometry(geometry);
            
            if (isValidGeometry(geometry)) {
              geoJsonLayer.addData({
                type: 'Feature',
                properties: row,
                geometry: geometry
              });
            } else {
              console.warn(`Geometría inválida encontrada en ${nombre}`);
            }
          }
        }
      });
      
      const featureCount = geoJsonLayer.getLayers().length;
      console.log(`✅ ${nombre}: ${featureCount} features válidas de ${data.length} registros`);
      
      if (featureCount === 0) {
        throw new Error('No se encontraron geometrías válidas en la capa');
      }
      
      geoJsonLayer.addTo(map);
      capasActivas[nombre] = geoJsonLayer;
    }
    else if (nombre === 'lineas de conduccion-drenaje') {
      // Paleta de colores variados para drenaje
      const coloresDrenaje = [
        '#8B4513', '#A0522D', '#D2691E', '#CD853F', '#B8860B',
        '#8B7355', '#654321', '#7B3F00', '#996515', '#6F4E37'
      ];
      
      // Obtener todos los proyectos únicos
      const proyectos = [...new Set(data.map(d => d.PROYECTO || d.proyecto || 'Sin Proyecto'))];
      const colorMap = {};
      proyectos.forEach((p, idx) => {
        colorMap[p] = coloresDrenaje[idx % coloresDrenaje.length];
      });
      
      const geoJsonLayer = L.geoJSON(null, {
        pointToLayer: (feature, latlng) => {
          const proyecto = feature.properties.PROYECTO || feature.properties.proyecto || 'Sin Proyecto';
          return L.circleMarker(latlng, {
            radius: 7,
            fillColor: colorMap[proyecto] || '#8B4513',
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 1
          });
        },
        style: (feature) => {
          const proyecto = feature.properties.PROYECTO || feature.properties.proyecto || 'Sin Proyecto';
          return {
            color: colorMap[proyecto] || '#999999',
            weight: 1.5,  // Línea más delgada
            opacity: 1,
            fillOpacity: 1
          };
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties;
          let popup = '<b>' + nombre + '</b><br>';
          popup += `<b>Proyecto:</b> ${props.PROYECTO || props.proyecto || 'Sin Proyecto'}<br>`;
          Object.keys(props).forEach(key => {
            if (key !== 'geom' && key !== 'PROYECTO' && key !== 'proyecto') {
              popup += `${key}: ${props[key]}<br>`;
            }
          });
          layer.bindPopup(popup);
        }
      });

      data.forEach(row => {
        const geomField = config.columna_geom || 'geom';
        if (row[geomField]) {
          let geometry = typeof row[geomField] === 'string' ? JSON.parse(row[geomField]) : row[geomField];
          
          if (geometry.coordinates) {
            geometry = reprojectGeometry(geometry);
            
            if (isValidGeometry(geometry)) {
              geoJsonLayer.addData({
                type: 'Feature',
                properties: row,
                geometry: geometry
              });
            } else {
              console.warn(`Geometría inválida encontrada en ${nombre}`, geometry);
            }
          }
        }
      });

      const featureCount = geoJsonLayer.getLayers().length;
      console.log(`✅ ${nombre}: ${featureCount} features válidas de ${data.length} registros`);
      
      if (featureCount === 0) {
        throw new Error('No se encontraron geometrías válidas en la capa');
      }

      geoJsonLayer.addTo(map);
      capasActivas[nombre] = geoJsonLayer;
    }
    else if (nombre === 'lineas de conduccion-ap') {
      // Paleta de colores para líneas de conducción AP
      const coloresAP = [
        '#FF6B6B', '#EE5A6F', '#DC4872', '#C73E74', '#B03576',
        '#972D78', '#7C2679', '#611F7A', '#46197A', '#2B1479'
      ];
      
      // Obtener todos los proyectos únicos
      const proyectos = [...new Set(data.map(d => d.PROYECTO || d.proyecto || 'Sin Proyecto'))];
      const colorMap = {};
      proyectos.forEach((p, idx) => {
        colorMap[p] = coloresAP[idx % coloresAP.length];
      });
      
      const geoJsonLayer = L.geoJSON(null, {
        pointToLayer: (feature, latlng) => {
          const proyecto = feature.properties.PROYECTO || feature.properties.proyecto || 'Sin Proyecto';
          return L.circleMarker(latlng, {
            radius: 7,
            fillColor: colorMap[proyecto] || '#FF6B6B',
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 1
          });
        },
        style: (feature) => {
          const proyecto = feature.properties.PROYECTO || feature.properties.proyecto || 'Sin Proyecto';
          return {
            color: colorMap[proyecto] || '#999999',
            weight: 2,
            opacity: 1,
            fillOpacity: 1
          };
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties;
          let popup = '<b>' + nombre + '</b><br>';
          popup += `<b>Proyecto:</b> ${props.PROYECTO || props.proyecto || 'Sin Proyecto'}<br>`;
          Object.keys(props).forEach(key => {
            if (key !== 'geom' && key !== 'PROYECTO' && key !== 'proyecto') {
              popup += `${key}: ${props[key]}<br>`;
            }
          });
          layer.bindPopup(popup);
        }
      });
      
      data.forEach(row => {
        if (row.geom) {
          let geometry = typeof row.geom === 'string' ? JSON.parse(row.geom) : row.geom;
          if (geometry.coordinates) {
            geometry = reprojectGeometry(geometry);
            
            if (isValidGeometry(geometry)) {
              geoJsonLayer.addData({
                type: 'Feature',
                properties: row,
                geometry: geometry
              });
            } else {
              console.warn(`Geometría inválida encontrada en ${nombre}`);
            }
          }
        }
      });
      
      const featureCount = geoJsonLayer.getLayers().length;
      console.log(`✅ ${nombre}: ${featureCount} features válidas de ${data.length} registros`);
      
      if (featureCount === 0) {
        throw new Error('No se encontraron geometrías válidas en la capa');
      }

      geoJsonLayer.addTo(map);
      capasActivas[nombre] = geoJsonLayer;
    }
    else if (nombre === 'lineasdistribucion-drenaje') {
      // Paleta de colores para líneas de distribución drenaje
      const coloresDistDrenaje = [
        '#3d3d3d', '#4a4a4a', '#575757', '#646464', '#717171',
        '#7e7e7e', '#8b8b8b', '#989898', '#a5a5a5', '#b2b2b2'
      ];
      
      // Obtener todos los proyectos únicos
      const proyectos = [...new Set(data.map(d => d.PROYECTO || d.proyecto || 'Sin Proyecto'))];
      const colorMap = {};
      proyectos.forEach((p, idx) => {
        colorMap[p] = coloresDistDrenaje[idx % coloresDistDrenaje.length];
      });
      
      const geoJsonLayer = L.geoJSON(null, {
        pointToLayer: (feature, latlng) => {
          const proyecto = feature.properties.PROYECTO || feature.properties.proyecto || 'Sin Proyecto';
          return L.circleMarker(latlng, {
            radius: 7,
            fillColor: colorMap[proyecto] || '#3d3d3d',
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 1
          });
        },
        style: (feature) => {
          const proyecto = feature.properties.PROYECTO || feature.properties.proyecto || 'Sin Proyecto';
          return {
            color: colorMap[proyecto] || '#999999',
            weight: 1.5,
            opacity: 1,
            fillOpacity: 1
          };
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties;
          let popup = '<b>' + nombre + '</b><br>';
          popup += `<b>Proyecto:</b> ${props.PROYECTO || props.proyecto || 'Sin Proyecto'}<br>`;
          Object.keys(props).forEach(key => {
            if (key !== 'geom' && key !== 'PROYECTO' && key !== 'proyecto') {
              popup += `${key}: ${props[key]}<br>`;
            }
          });
          layer.bindPopup(popup);
        }
      });
      
      data.forEach(row => {
        const geomField = config.columna_geom || 'geom';
        if (row[geomField]) {
          let geometry = typeof row[geomField] === 'string' ? JSON.parse(row[geomField]) : row[geomField];
          
          if (geometry.coordinates) {
            geometry = reprojectGeometry(geometry);
            
            if (isValidGeometry(geometry)) {
              geoJsonLayer.addData({
                type: 'Feature',
                properties: row,
                geometry: geometry
              });
            } else {
              console.warn(`Geometría inválida encontrada en ${nombre}`, geometry);
            }
          }
        }
      });

      const featureCount = geoJsonLayer.getLayers().length;
      console.log(`✅ ${nombre}: ${featureCount} features válidas de ${data.length} registros`);
      
      if (featureCount === 0) {
        throw new Error('No se encontraron geometrías válidas en la capa');
      }

      geoJsonLayer.addTo(map);
      capasActivas[nombre] = geoJsonLayer;
    }
    else if (nombre === 'estadomex' || nombre === 'estadomex_geojson') {
      // Límite Estatal: solo contorno negro sin relleno
      const geoJsonLayer = L.geoJSON(null, {
        style: () => ({
          color: '#000000',
          weight: 3,
          opacity: 1,
          fillOpacity: 0  // Sin relleno
        }),
        onEachFeature: (feature, layer) => {
          const props = feature.properties;
          let popup = '<b>Límite Estatal</b><br>';
          Object.keys(props).forEach(key => {
            if (key !== 'geom') {
              popup += `${key}: ${props[key]}<br>`;
            }
          });
          layer.bindPopup(popup);
        }
      });
      
      data.forEach(row => {
        const geomField = config.columna_geom || 'geom';
        if (row[geomField]) {
          let geometry = typeof row[geomField] === 'string' ? JSON.parse(row[geomField]) : row[geomField];
          
          if (geometry.coordinates) {
            geometry = reprojectGeometry(geometry);
            
            if (isValidGeometry(geometry)) {
              geoJsonLayer.addData({
                type: 'Feature',
                properties: row,
                geometry: geometry
              });
            } else {
              console.warn(`Geometría inválida encontrada en ${nombre}`);
            }
          }
        }
      });
      
      const featureCount = geoJsonLayer.getLayers().length;
      console.log(`✅ ${nombre}: ${featureCount} features válidas de ${data.length} registros`);
      
      if (featureCount === 0) {
        throw new Error('No se encontraron geometrías válidas en la capa');
      }

      geoJsonLayer.addTo(map);
      capasActivas[nombre] = geoJsonLayer;
    }
    else if (nombre === 'regiones' || nombre === 'regiones_geojson') {
      // Regionalización: categorizada por municipi_1
      const municipios = [...new Set(data.map(d => d.municipi_1 || d.MUNICIPI_1 || 'Sin Municipio'))];
      const colorMap = {};
      
      // Array para guardar todas las etiquetas de esta capa
      const layerLabels = [];
      
      // Generar colores para cada municipio
      municipios.forEach((m, idx) => {
        colorMap[m] = colores[idx % colores.length];
      });
      
      const geoJsonLayer = L.geoJSON(null, {
        style: (feature) => {
          const municipio = feature.properties.municipi_1 || feature.properties.MUNICIPI_1 || 'Sin Municipio';
          return {
            color: colorMap[municipio] || '#999999',
            weight: 2,
            opacity: 1,
            fillColor: colorMap[municipio] || '#999999',
            fillOpacity: 1
          };
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties;
          const municipioLabel = props.municipi_1 || props.MUNICIPI_1 || 'Sin Municipio';
          
          // Crear popup
          let popup = '<b>Regionalización</b><br>';
          popup += `<b>Municipio:</b> ${municipioLabel}<br>`;
          Object.keys(props).forEach(key => {
            if (key !== 'geom' && key !== 'municipi_1' && key !== 'MUNICIPI_1') {
              popup += `${key}: ${props[key]}<br>`;
            }
          });
          layer.bindPopup(popup);
          
          // Agregar etiqueta permanente con el nombre del municipio
          if (municipioLabel && municipioLabel !== 'Sin Municipio') {
            const bounds = layer.getBounds();
            const center = bounds.getCenter();
            
            // Calcular el desplazamiento hacia la izquierda (20% del ancho del bounds)
            const boundsWidth = bounds.getEast() - bounds.getWest();
            const offsetLng = boundsWidth * 0.20;
            
            // Aplicar el desplazamiento
            const adjustedCenter = L.latLng(center.lat, center.lng - offsetLng);
            
            const label = L.marker(adjustedCenter, {
              icon: L.divIcon({
                className: 'region-label',
                html: `<div style="
                  font-size: 11px;
                  font-weight: 700;
                  color: #000000;
                  text-align: center;
                  white-space: nowrap;
                  text-shadow: 
                    -1px -1px 0 #fff,
                    1px -1px 0 #fff,
                    -1px 1px 0 #fff,
                    1px 1px 0 #fff,
                    -2px 0 0 #fff,
                    2px 0 0 #fff,
                    0 -2px 0 #fff,
                    0 2px 0 #fff;
                  pointer-events: none;
                  padding: 2px 4px;
                ">${municipioLabel}</div>`,
                iconSize: [0, 0],
                iconAnchor: [0, 0]
              }),
              interactive: false
            });
            
            // Guardar referencia a la etiqueta
            layerLabels.push(label);
            label.addTo(map);
          }
        }
      });
      
      data.forEach(row => {
        const geomField = config.columna_geom || 'geom';
        if (row[geomField]) {
          let geometry = typeof row[geomField] === 'string' ? JSON.parse(row[geomField]) : row[geomField];
          
          if (geometry.coordinates) {
            geometry = reprojectGeometry(geometry);
            
            if (isValidGeometry(geometry)) {
              geoJsonLayer.addData({
                type: 'Feature',
                properties: row,
                geometry: geometry
              });
            } else {
              console.warn(`Geometría inválida encontrada en ${nombre}`);
            }
          }
        }
      });
      
      const featureCount = geoJsonLayer.getLayers().length;
      console.log(`✅ ${nombre}: ${featureCount} features válidas de ${data.length} registros`);
      
      if (featureCount === 0) {
        throw new Error('No se encontraron geometrías válidas en la capa');
      }

      geoJsonLayer.addTo(map);
      capasActivas[nombre] = geoJsonLayer;
      
      // Guardar las etiquetas asociadas a esta capa
      geoJsonLayer.labels = layerLabels;
    }
    else if (nombre === 'riesgo de inundacion') {
      // Categorización para Riesgo de Inundación por campo "vulner_ri"
      // Gama de tonos azules: ALTA = azul más fuerte
      const colorMapRiesgo = {
        'ALTA': '#08306bff',      // Azul muy oscuro/fuerte
        'MEDIA': '#2979b9ff',     // Azul medio
        'BAJA': '#73b2d8ff',      // Azul claro
        'MUY BAJA': '#c8dcf0ff'   // Azul muy claro
      };
      
      const geoJsonLayer = L.geoJSON(null, {
        pointToLayer: (feature, latlng) => {
          const vulner = (feature.properties.vulner_ri || 'SIN DATOS').toUpperCase();
          const color = colorMapRiesgo[vulner] || '#1E88E5';
          return L.circleMarker(latlng, {
            radius: 7,
            fillColor: color,
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 1
          });
        },
        style: (feature) => {
          const vulner = (feature.properties.vulner_ri || 'SIN DATOS').toUpperCase();
          const color = colorMapRiesgo[vulner] || '#1E88E5';
          return {
            color: '#ffffff',
            weight: 1,
            opacity: 1,
            fillColor: color,
            fillOpacity: 1
          };
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties;
          let popup = '<b>Riesgo de Inundación</b><br>';
          popup += `<b>Vulnerabilidad:</b> ${props.vulner_ri || 'Sin Datos'}<br>`;
          Object.keys(props).forEach(key => {
            if (key !== 'geom' && key !== 'vulner_ri') {
              popup += `${key}: ${props[key]}<br>`;
            }
          });
          layer.bindPopup(popup);
        }
      });
      
      data.forEach(row => {
        const geomField = config.columna_geom || 'geom';
        if (row[geomField]) {
          let geometry = typeof row[geomField] === 'string' ? JSON.parse(row[geomField]) : row[geomField];
          
          if (geometry.coordinates) {
            geometry = reprojectGeometry(geometry);
            
            if (isValidGeometry(geometry)) {
              geoJsonLayer.addData({
                type: 'Feature',
                properties: row,
                geometry: geometry
              });
            } else {
              console.warn(`Geometría inválida encontrada en ${nombre}`);
            }
          }
        }
      });
      
      const featureCount = geoJsonLayer.getLayers().length;
      console.log(`✅ ${nombre}: ${featureCount} features válidas de ${data.length} registros`);
      
      if (featureCount === 0) {
        throw new Error('No se encontraron geometrías válidas en la capa');
      }

      geoJsonLayer.addTo(map);
      capasActivas[nombre] = geoJsonLayer;
    }
    else {
      const geoJsonLayer = L.geoJSON(null, {
        pointToLayer: (feature, latlng) => {
          return L.circleMarker(latlng, {
            radius: 7,
            fillColor: config.color,
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 1
          });
        },
        style: () => ({
          color: '#ffffff',
          weight: 2,
          opacity: 1,
          fillColor: config.color,
          fillOpacity: 1
        }),
        onEachFeature: (feature, layer) => {
          const props = feature.properties;
          let popup = '<b>' + nombre + '</b><br>';
          Object.keys(props).forEach(key => {
            if (key !== 'geom') {
              popup += `${key}: ${props[key]}<br>`;
            }
          });
          layer.bindPopup(popup);
        }
      });

      data.forEach(row => {
        const geomField = config.columna_geom || 'geom';
        if (row[geomField]) {
          let geometry = typeof row[geomField] === 'string' ? JSON.parse(row[geomField]) : row[geomField];
          
          if (geometry.coordinates) {
            geometry = reprojectGeometry(geometry);
            
            // Validar que las coordenadas sean válidas
            if (isValidGeometry(geometry)) {
              geoJsonLayer.addData({
                type: 'Feature',
                properties: row,
                geometry: geometry
              });
            } else {
              console.warn(`Geometría inválida encontrada en ${nombre}`, geometry);
            }
          }
        }
      });

      const featureCount = geoJsonLayer.getLayers().length;
      console.log(`✅ ${nombre}: ${featureCount} features válidas de ${data.length} registros`);
      
      if (featureCount === 0) {
        throw new Error('No se encontraron geometrías válidas en la capa');
      }

      geoJsonLayer.addTo(map);
      capasActivas[nombre] = geoJsonLayer;
    }
    
    // Hacer zoom inicial a estadomex si existe
    if (nombre === 'estadomex' && capasActivas['estadomex']) {
      try {
        const bounds = capasActivas['estadomex'].getBounds();
        if (bounds && bounds.isValid()) {
          map.fitBounds(bounds, { padding: [20, 20] });
          console.log('🗺️ Zoom ajustado a los límites del Estado de México');
        }
      } catch (err) {
        console.warn(`Error al obtener bounds de estadomex:`, err.message);
      }
    }
    
    status.textContent = `✅ ${nombre} cargado (${data.length} features)`;
    status.className = 'status-success';
    hideLoading();
  } catch (err) {
    status.textContent = `❌ Error en ${nombre}: ${err.message}`;
    status.className = 'status-error';
    document.getElementById(`layer_${nombre}`).checked = false;
    hideLoading();
  }
}

async function descargarCapa(nombre) {
  const status = document.getElementById('status');
  showLoading(`Preparando descarga: ${nombre}`, 'Generando archivo GeoJSON...');
  status.textContent = `⬇️ Descargando ${nombre}...`;
  status.className = 'status-info';
  
  try {
    let data = capasData[nombre];
    
    if (!data) {
      // Codificar el nombre de la tabla para la URL (espacios y caracteres especiales)
      const encodedNombre = encodeURIComponent(nombre);
      
      // Cargar TODOS los registros usando paginación automática
      data = [];
      let offset = 0;
      const pageSize = 1000; // Cargar 1000 registros por página
      let hasMore = true;
      
      while (hasMore) {
        const rangeEnd = offset + pageSize - 1;
        console.log(`📄 Descargando registros ${offset}-${rangeEnd}...`);
        
        const res = await fetch(`${supabaseUrl}/rest/v1/${encodedNombre}?select=*`, {
          headers: { 
            'apikey': supabaseKey, 
            'Authorization': `Bearer ${supabaseKey}`,
            'Range': `${offset}-${rangeEnd}`,
            'Prefer': 'count=exact'
          }
        });
        
        if (!res.ok) throw new Error('Error al descargar capa');
        
        const pageData = await res.json();
        data = data.concat(pageData);
        
        // Verificar si hay más datos
        const contentRange = res.headers.get('Content-Range');
        if (contentRange) {
          const match = contentRange.match(/(\d+)-(\d+)\/(\d+)/);
          if (match) {
            const [, start, end, total] = match;
            console.log(`📥 Descargados ${data.length} de ${total} registros de ${nombre}`);
            
            // Actualizar mensaje de progreso
            showLoading(`Descargando ${nombre}`, `${data.length} de ${total} registros...`);
            
            // Si ya descargamos todos, terminamos
            if (parseInt(end) >= parseInt(total) - 1 || pageData.length < pageSize) {
              hasMore = false;
            } else {
              offset += pageSize;
            }
          } else {
            hasMore = false;
          }
        } else {
          hasMore = false;
        }
      }
      
      console.log(`🎉 Descarga completa: ${data.length} registros totales`);
    }
    
    const config = capasConfig[nombre];
    const geomField = config.columna_geom || 'geom';
    
    const geojson = {
      type: 'FeatureCollection',
      features: data.map(row => {
        let geometry = row[geomField];
        if (typeof geometry === 'string') {
          geometry = JSON.parse(geometry);
        }
        
        if (geometry && geometry.coordinates) {
          geometry = reprojectGeometry(geometry);
        }
        
        const properties = { ...row };
        delete properties[geomField];
        
        return {
          type: 'Feature',
          properties: properties,
          geometry: geometry
        };
      })
    };
    
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nombre}.geojson`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    status.textContent = `✅ ${nombre}.geojson descargado (${data.length} features)`;
    status.className = 'status-success';
    hideLoading();
  } catch (err) {
    status.textContent = `❌ Error al descargar: ${err.message}`;
    status.className = 'status-error';
    hideLoading();
  }
}

// Función para apagar todas las capas activas
function apagarTodasLasCapas() {
  const checkboxes = document.querySelectorAll('input[id^="layer_"]');
  checkboxes.forEach(checkbox => {
    if (checkbox.checked) {
      checkbox.checked = false;
      const layerName = checkbox.id.replace('layer_', '');
      descargarCapa_off(layerName);
    }
  });
  
  const status = document.getElementById('status');
  status.textContent = '✅ Todas las capas han sido apagadas';
  status.className = 'status-success';
  
  setTimeout(() => {
    status.textContent = 'Listo';
    status.className = '';
  }, 2000);
}

// Función para desactivar una capa
function descargarCapa_off(nombre) {
  if (capasActivas[nombre]) {
    map.removeLayer(capasActivas[nombre]);
    delete capasActivas[nombre];
  }
}

// Función para ajustar la transparencia de polígonos
function ajustarTransparencia(valor) {
  const opacidad = valor / 100;
  
  // Actualizar ambos displays de transparencia (sidebar y flotante)
  const transparencyValue = document.getElementById('transparency-value');
  const transparencyValueFloat = document.getElementById('transparency-value-float');
  const polygonTransparency = document.getElementById('polygon-transparency');
  const polygonTransparencyFloat = document.getElementById('polygon-transparency-float');
  
  if (transparencyValue) transparencyValue.textContent = valor + '%';
  if (transparencyValueFloat) transparencyValueFloat.textContent = valor + '%';
  
  // Sincronizar ambos sliders
  if (polygonTransparency) polygonTransparency.value = valor;
  if (polygonTransparencyFloat) polygonTransparencyFloat.value = valor;
  
  // Aplicar transparencia solo a la última capa activada
  if (ultimaCapaActivada && capasActivas[ultimaCapaActivada]) {
    const capa = capasActivas[ultimaCapaActivada];
    
    if (capa && capa.eachLayer) {
      capa.eachLayer(layer => {
        // Verificar si es un polígono (no un punto ni una línea)
        if (layer.setStyle && layer.feature && layer.feature.geometry) {
          const geomType = layer.feature.geometry.type;
          if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
            layer.setStyle({
              fillOpacity: opacidad
            });
          }
        }
      });
      console.log(`🎨 Transparencia ajustada a ${valor}% para la capa: ${ultimaCapaActivada}`);
    }
  } else {
    console.log('⚠️ No hay ninguna capa activada para ajustar transparencia');
  }
}

// Función para ocultar/mostrar la barra lateral
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const mapElement = document.getElementById('map');
  const toggleContainer = document.getElementById('toggle-sidebar-container');
  const toggleBtn = document.getElementById('toggle-sidebar-btn');
  const searchContainer = document.getElementById('search-places-container');
  const deactivateContainer = document.getElementById('deactivate-layers-container');
  const zoomInicioContainer = document.getElementById('zoom-inicio-container');
  const toolsContainer = document.getElementById('tools-container');
  
  // Toggle las clases
  sidebar.classList.toggle('hidden');
  mapElement.classList.toggle('expanded');
  toggleContainer.classList.toggle('sidebar-hidden');
  toggleBtn.classList.toggle('sidebar-hidden');
  
  // Aplicar toggle solo si los elementos existen
  if (searchContainer) searchContainer.classList.toggle('sidebar-hidden');
  if (deactivateContainer) deactivateContainer.classList.toggle('sidebar-hidden');
  if (zoomInicioContainer) zoomInicioContainer.classList.toggle('sidebar-hidden');
  if (toolsContainer) toolsContainer.classList.toggle('sidebar-hidden');
  
  // Invalidar el tamaño del mapa inmediatamente y después de la transición
  // Esto asegura que el mapa se redibuje correctamente en toda el área expandida
  setTimeout(() => {
    map.invalidateSize({
      animate: true,
      pan: false
    });
  }, 50);
  
  setTimeout(() => {
    map.invalidateSize({
      animate: true,
      pan: false
    });
  }, 350);
}

// Función para hacer zoom al estado inicial
function zoomInicio() {
  // Si existe la capa de estadomex, hacer zoom a ella
  if (capasActivas['estadomex']) {
    try {
      const bounds = capasActivas['estadomex'].getBounds();
      if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [20, 20] });
        console.log('🗺️ Zoom ajustado a los límites del Estado de México');
        return;
      }
    } catch (err) {
      console.warn(`Error al obtener bounds de estadomex:`, err.message);
    }
  }
  
  // Si no existe estadomex o hubo error, volver a la vista inicial predeterminada
  map.setView([19.4326, -99.1332], 9);
  console.log('🗺️ Zoom ajustado a la vista inicial predeterminada');
}

// Función para mostrar/ocultar el panel de herramientas flotante
function toggleToolsPanel() {
  const toolsBtn = document.getElementById('tools-btn');
  const toolsPanel = document.getElementById('tools-panel');
  
  toolsBtn.classList.toggle('active');
  toolsPanel.classList.toggle('show');
}

// Función para mostrar/ocultar el panel de mapas base
function toggleBasemapPanel() {
  const basemapBtn = document.getElementById('basemap-btn');
  const basemapPanel = document.getElementById('basemap-panel');
  
  basemapBtn.classList.toggle('active');
  basemapPanel.classList.toggle('show');
}

// Función para cambiar el mapa base desde el botón flotante
function changeBasemapFloat(type) {
  changeBasemap(type);
  
  // Actualizar estados visuales
  document.querySelectorAll('.basemap-option').forEach(btn => {
    btn.classList.remove('active');
  });
  document.getElementById('basemap-' + type).classList.add('active');
  
  // Cerrar el panel después de seleccionar
  setTimeout(() => {
    toggleBasemapPanel();
  }, 300);
}

// Función para mostrar/ocultar los inputs de búsqueda de coordenadas en el panel flotante
function toggleSearchCoord() {
  const coordInputs = document.getElementById('coord-search-inputs-float');
  const searchBtn = document.getElementById('search-btn-float');
  
  if (coordInputs.style.display === 'none' || coordInputs.style.display === '') {
    coordInputs.style.display = 'block';
    searchBtn.style.background = 'linear-gradient(135deg, #b99056 0%, #8a2035 100%)';
  } else {
    coordInputs.style.display = 'none';
    searchBtn.style.background = '';
  }
}

// Función para buscar coordenadas desde el panel flotante
function buscarCoordenadasFloat() {
  const lat = parseFloat(document.getElementById('search-lat-float').value);
  const lon = parseFloat(document.getElementById('search-lon-float').value);
  
  if (isNaN(lat) || isNaN(lon)) {
    alert('Por favor ingresa coordenadas válidas');
    return;
  }
  
  // Remover marcador anterior si existe
  if (searchMarker) {
    map.removeLayer(searchMarker);
  }
  
  // Crear nuevo marcador
  searchMarker = L.marker([lat, lon], {
    icon: L.icon({
      iconUrl: 'data:image/svg+xml;base64,' + btoa(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32">
          <path fill="#8a2035" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
      `),
      iconSize: [32, 32],
      iconAnchor: [16, 32]
    })
  }).addTo(map);
  
  // Centrar el mapa en las coordenadas
  map.setView([lat, lon], 15);
  
  // Cerrar el panel de herramientas
  toggleToolsPanel();
  
  // Ocultar los inputs
  document.getElementById('coord-search-inputs-float').style.display = 'none';
  document.getElementById('search-btn-float').style.background = '';
}

// ========== FUNCIONES PARA MANEJO DE KML/KMZ ==========

// Variable global para almacenar las capas KML cargadas
let kmlLayers = [];
let kmlLayerCounter = 0;

// Función para manejar la carga de archivos KML/KMZ
async function handleKmlUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const fileName = file.name;
  const fileExtension = fileName.split('.').pop().toLowerCase();

  try {
    showLoading('Cargando archivo', 'Procesando ' + fileName + '...');

    if (fileExtension === 'kmz') {
      // Procesar archivo KMZ (comprimido)
      await processKmzFile(file, fileName);
    } else if (fileExtension === 'kml') {
      // Procesar archivo KML
      await processKmlFile(file, fileName);
    } else {
      alert('Por favor selecciona un archivo KML o KMZ válido');
      hideLoading();
      return;
    }

    // Limpiar el input para poder cargar el mismo archivo nuevamente si es necesario
    event.target.value = '';
    hideLoading();

  } catch (error) {
    console.error('Error al cargar el archivo:', error);
    alert('Error al cargar el archivo: ' + error.message);
    hideLoading();
  }
}

// Función para procesar archivos KMZ
async function processKmzFile(file, fileName) {
  const zip = new JSZip();
  const contents = await zip.loadAsync(file);
  
  // Buscar el archivo .kml dentro del KMZ
  let kmlFile = null;
  for (let filename in contents.files) {
    if (filename.toLowerCase().endsWith('.kml')) {
      kmlFile = contents.files[filename];
      break;
    }
  }

  if (!kmlFile) {
    throw new Error('No se encontró archivo KML dentro del KMZ');
  }

  const kmlText = await kmlFile.async('string');
  loadKmlFromText(kmlText, fileName);
}

// Función para procesar archivos KML
async function processKmlFile(file, fileName) {
  const reader = new FileReader();
  
  return new Promise((resolve, reject) => {
    reader.onload = function(e) {
      try {
        const kmlText = e.target.result;
        loadKmlFromText(kmlText, fileName);
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = function() {
      reject(new Error('Error al leer el archivo'));
    };
    
    reader.readAsText(file);
  });
}

// Función para cargar KML desde texto
function loadKmlFromText(kmlText, fileName) {
  try {
    // Crear un blob y URL temporal para el archivo
    const blob = new Blob([kmlText], { type: 'application/vnd.google-earth.kml+xml' });
    const url = URL.createObjectURL(blob);

    // Usar leaflet-omnivore para cargar el KML
    const kmlLayer = omnivore.kml(url);
    
    kmlLayer.on('ready', function() {
      // Liberar la URL temporal
      URL.revokeObjectURL(url);
      
      // Array para guardar las features individuales
      const features = [];
      
      // Aplicar estilos personalizados a las características
      kmlLayer.eachLayer(function(layer) {
        if (layer.setStyle) {
          layer.setStyle({
            color: '#8a2035',
            weight: 3,
            opacity: 1,
            fillColor: '#b99056',
            fillOpacity: 1
          });
        }
        
        // Guardar referencia a cada feature con su nombre y bounds
        const featureName = (layer.feature && layer.feature.properties && layer.feature.properties.name) 
          ? layer.feature.properties.name 
          : 'Sin nombre';
        
        features.push({
          name: featureName,
          layer: layer,
          bounds: layer.getBounds ? layer.getBounds() : null
        });
        
        // Agregar popup con información
        if (layer.feature && layer.feature.properties) {
          const props = layer.feature.properties;
          
          // Lista de propiedades técnicas que no queremos mostrar
          const technicalProps = [
            'stroke', 'stroke-opacity', 'stroke-width', 
            'fill', 'fill-opacity', 
            'marker-color', 'marker-size', 'marker-symbol',
            'styleUrl', 'styleHash', 'styleMapHash',
            '_storage_options', '_umap_options'
          ];
          
          let popupContent = '<div style="max-width: 250px;">';
          popupContent += '<b style="color: #8a2035; font-size: 14px; display: block; margin-bottom: 8px;">' + (props.name || 'Sin nombre') + '</b>';
          
          if (props.description) {
            popupContent += '<div style="font-size: 12px; color: #666; margin-bottom: 8px;">' + props.description + '</div>';
          }
          
          // Agregar otras propiedades, filtrando las técnicas
          for (let key in props) {
            // Filtrar propiedades que no queremos mostrar
            if (key !== 'name' && 
                key !== 'description' && 
                !technicalProps.includes(key) && 
                !key.startsWith('_') &&
                props[key]) {
              popupContent += '<div style="font-size: 11px; margin: 4px 0;"><b>' + key + ':</b> ' + props[key] + '</div>';
            }
          }
          
          popupContent += '</div>';
          layer.bindPopup(popupContent);
        }
      });
      
      // Agregar la capa al mapa
      kmlLayer.addTo(map);
      
      // Contar características
      let featureCount = features.length;
      
      // Guardar información de la capa
      kmlLayerCounter++;
      const layerInfo = {
        id: 'kml_' + kmlLayerCounter,
        name: fileName,
        layer: kmlLayer,
        visible: true,
        featureCount: featureCount,
        features: features // Guardar las features individuales
      };
      
      kmlLayers.push(layerInfo);
      
      // Actualizar la lista en la interfaz
      updateKmlLayersList();
      
      // Hacer zoom a la extensión de la capa
      try {
        const bounds = kmlLayer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [50, 50] });
        }
      } catch (e) {
        console.log('No se pudo hacer zoom automático');
      }
    });
    
    kmlLayer.on('error', function(e) {
      console.error('Error al cargar KML:', e);
      alert('Error al procesar el archivo KML');
    });
    
  } catch (error) {
    console.error('Error en loadKmlFromText:', error);
    throw error;
  }
}

// Función para actualizar la lista de capas KML
function updateKmlLayersList() {
  const container = document.getElementById('kml-layers-list-sidebar');
  const clearBtn = document.getElementById('clear-kml-btn');
  
  if (kmlLayers.length === 0) {
    container.innerHTML = '<div class="kml-empty-state">No hay archivos cargados</div>';
    clearBtn.disabled = true;
    return;
  }
  
  clearBtn.disabled = false;
  container.innerHTML = '';
  
  kmlLayers.forEach((layerInfo, index) => {
    const item = document.createElement('div');
    item.className = 'kml-layer-item';
    
    // Crear el header con info básica y acciones
    const hasMultipleFeatures = layerInfo.features && layerInfo.features.length > 1;
    
    item.innerHTML = `
      <div class="kml-layer-header">
        <div class="kml-layer-info">
          <div class="kml-layer-name" title="${layerInfo.name}">${layerInfo.name}</div>
          <div class="kml-layer-features">${layerInfo.featureCount} objeto(s)</div>
        </div>
        <div class="kml-layer-actions">
          ${hasMultipleFeatures ? `
          <button class="kml-expand-btn" onclick="toggleKmlFeaturesList(${index})" title="Ver objetos">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#b99056">
              <path d="M7 10l5 5 5-5z"/>
            </svg>
          </button>
          ` : ''}
          <button class="kml-action-btn visibility-btn ${layerInfo.visible ? '' : 'hidden'}" 
                  onclick="toggleKmlLayerVisibility(${index})" 
                  title="${layerInfo.visible ? 'Ocultar' : 'Mostrar'}">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#8a2035">
              ${layerInfo.visible ? 
                '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>' :
                '<path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>'
              }
            </svg>
          </button>
          <button class="kml-action-btn" onclick="zoomToKmlLayer(${index})" title="Zoom a capa">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#8a2035">
              <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              <path d="M12 10h-2v2H9v-2H7V9h2V7h1v2h2v1z"/>
            </svg>
          </button>
          <button class="kml-action-btn" onclick="removeKmlLayer(${index})" title="Eliminar">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#8a2035">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </button>
        </div>
      </div>
    `;
    
    // Si tiene múltiples features, agregar la lista expandible
    if (hasMultipleFeatures) {
      const featuresList = document.createElement('div');
      featuresList.className = 'kml-features-list';
      featuresList.id = `kml-features-${index}`;
      
      layerInfo.features.forEach((feature, featureIndex) => {
        const featureItem = document.createElement('div');
        featureItem.className = 'kml-feature-item';
        featureItem.innerHTML = `
          <div class="kml-feature-name" title="${feature.name}">${feature.name}</div>
          <button class="kml-feature-zoom-btn" onclick="zoomToKmlFeature(${index}, ${featureIndex})" title="Zoom">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#8a2035">
              <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              <path d="M12 10h-2v2H9v-2H7V9h2V7h1v2h2v1z"/>
            </svg>
          </button>
        `;
        featuresList.appendChild(featureItem);
      });
      
      item.appendChild(featuresList);
    }
    
    container.appendChild(item);
  });
}

// Función para expandir/colapsar la lista de features
function toggleKmlFeaturesList(index) {
  const featuresList = document.getElementById(`kml-features-${index}`);
  const expandBtn = event.currentTarget;
  
  if (featuresList) {
    featuresList.classList.toggle('expanded');
    expandBtn.classList.toggle('expanded');
  }
}

// Función para hacer zoom a una feature específica
function zoomToKmlFeature(layerIndex, featureIndex) {
  if (layerIndex < 0 || layerIndex >= kmlLayers.length) return;
  
  const layerInfo = kmlLayers[layerIndex];
  if (!layerInfo.features || featureIndex < 0 || featureIndex >= layerInfo.features.length) return;
  
  const feature = layerInfo.features[featureIndex];
  
  // Si la capa está oculta, mostrarla primero
  if (!layerInfo.visible) {
    layerInfo.layer.addTo(map);
    layerInfo.visible = true;
    updateKmlLayersList();
  }
  
  // Hacer zoom a la feature
  if (feature.bounds && feature.bounds.isValid()) {
    map.fitBounds(feature.bounds, { padding: [50, 50] });
    
    // Si tiene popup, abrirlo
    if (feature.layer && feature.layer.getPopup) {
      setTimeout(() => {
        feature.layer.openPopup();
      }, 300);
    }
  } else if (feature.layer && feature.layer.getLatLng) {
    // Para puntos
    const latlng = feature.layer.getLatLng();
    map.setView(latlng, 16);
    setTimeout(() => {
      if (feature.layer.openPopup) {
        feature.layer.openPopup();
      }
    }, 300);
  }
}

// Función para alternar la visibilidad de una capa KML
function toggleKmlLayerVisibility(index) {
  if (index < 0 || index >= kmlLayers.length) return;
  
  const layerInfo = kmlLayers[index];
  
  if (layerInfo.visible) {
    map.removeLayer(layerInfo.layer);
    layerInfo.visible = false;
  } else {
    layerInfo.layer.addTo(map);
    layerInfo.visible = true;
  }
  
  updateKmlLayersList();
}

// Función para hacer zoom a una capa KML
function zoomToKmlLayer(index) {
  if (index < 0 || index >= kmlLayers.length) return;
  
  const layerInfo = kmlLayers[index];
  
  // Si la capa está oculta, mostrarla primero
  if (!layerInfo.visible) {
    layerInfo.layer.addTo(map);
    layerInfo.visible = true;
    updateKmlLayersList();
  }
  
  try {
    const bounds = layerInfo.layer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  } catch (e) {
    console.error('Error al hacer zoom:', e);
    alert('No se pudo calcular la extensión de esta capa');
  }
}

// Función para eliminar una capa KML específica
function removeKmlLayer(index) {
  if (index < 0 || index >= kmlLayers.length) return;
  
  const layerInfo = kmlLayers[index];
  
  // Remover la capa del mapa
  if (layerInfo.visible) {
    map.removeLayer(layerInfo.layer);
  }
  
  // Remover de la lista
  kmlLayers.splice(index, 1);
  
  // Actualizar la interfaz
  updateKmlLayersList();
}

// Función para limpiar todas las capas KML
function clearAllKml() {
  if (kmlLayers.length === 0) {
    return;
  }
  
  // Remover todas las capas del mapa
  kmlLayers.forEach(layerInfo => {
    if (layerInfo.visible) {
      map.removeLayer(layerInfo.layer);
    }
  });
  
  // Limpiar el array
  kmlLayers = [];
  
  // Actualizar la interfaz
  updateKmlLayersList();
}

// ========== FIN DE FUNCIONES KML/KMZ ==========

// Conectar automáticamente a Supabase al cargar la página
window.addEventListener('DOMContentLoaded', function() {
  console.log('🚀 Conectando automáticamente a Supabase...');
  // Esperar un momento para que el DOM esté completamente cargado
  setTimeout(function() {
    conectar();
  }, 500);
});
