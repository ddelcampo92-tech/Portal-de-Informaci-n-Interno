proj4.defs('EPSG:32614', '+proj=utm +zone=14 +datum=WGS84 +units=m +no_defs');
    
    const colores = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#34495e'];
    
    let supabaseUrl = '';
    let supabaseKey = '';
    let capasConfig = {};
    let capasActivas = {};
    let capasData = {};
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

    function toggleSymbology() {
      const panel = document.getElementById('symbology-panel');
      const btn = document.getElementById('symbology-btn');
      
      if (panel.classList.contains('show')) {
        panel.classList.remove('show');
        btn.classList.remove('active');
      } else {
        updateSymbology();
        panel.classList.add('show');
        btn.classList.add('active');
      }
    }

    function updateSymbology() {
      const content = document.getElementById('symbology-content');
      
      // Definir capas del Inventario CAEM y sus campos
      const inventarioCAEM = {
        'Drenaje': 'PROYECTO',
        'inventario_aoe': 'name',
        'lineas de conduccion-ap': 'PROYECTO',
        'lineasdistribucion-drenaje': 'PROYECTO'
      };
      
      // Definir paletas de colores específicas para cada capa
      const colorPalettes = {
        'Drenaje': [
          '#440154', '#472878', '#3e4a89', '#31688e', '#26828e',
          '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#ead55a'
        ],
        'inventario_aoe': ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#34495e'],
        'lineas de conduccion-ap': [
          '#FF6B6B', '#EE5A6F', '#DC4872', '#C73E74', '#B03576',
          '#972D78', '#7C2679', '#611F7A', '#46197A', '#2B1479'
        ],
        'lineasdistribucion-drenaje': [
          '#3d3d3d', '#4a4a4a', '#575757', '#646464', '#717171',
          '#7e7e7e', '#8b8b8b', '#989898', '#a5a5a5', '#b2b2b2'
        ]
      };
      
      // Filtrar solo las capas activas que pertenecen al Inventario CAEM
      const activeInventoryLayers = Object.keys(capasActivas).filter(name => 
        Object.keys(inventarioCAEM).includes(name)
      );
      
      if (activeInventoryLayers.length === 0) {
        content.innerHTML = '<div class="symbology-empty">No hay capas del Inventario CAEM activas</div>';
        return;
      }
      
      let html = '';
      
      activeInventoryLayers.forEach(layerName => {
        const config = capasConfig[layerName];
        const layer = capasActivas[layerName];
        const fieldName = inventarioCAEM[layerName];
        const palette = colorPalettes[layerName];
        
        html += `<div class="symbology-layer">`;
        html += `<div class="symbology-layer-name">${layerName}</div>`;
        
        // Obtener valores únicos del campo especificado
        const uniqueValues = new Map(); // Map para contar ocurrencias
        
        if (layer && layer.getLayers) {
          layer.getLayers().forEach(l => {
            const props = l.feature ? l.feature.properties : {};
            const value = props[fieldName] || 'Sin dato';
            uniqueValues.set(value, (uniqueValues.get(value) || 0) + 1);
          });
        }
        
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
        
        // Ordenar valores alfabéticamente
        const sortedValues = Array.from(uniqueValues.entries()).sort((a, b) => 
          String(a[0]).localeCompare(String(b[0]))
        );
        
        // Mostrar cada valor único con su color y conteo
        sortedValues.forEach(([value, count], index) => {
          // Asignar color amarillo específicamente para "Colector" en capa Drenaje
          let color;
          if (layerName === 'Drenaje' && value === 'Colector') {
            color = '#FFEB3B'; // Amarillo brillante
          } else {
            color = palette[index % palette.length];
          }
          
          html += `<div class="symbology-item">`;
          
          if (geometryType === 'line') {
            html += `<div class="symbology-symbol line" style="background-color: ${color};"></div>`;
          } else if (geometryType === 'polygon') {
            html += `<div class="symbology-symbol" style="background-color: ${color}; opacity: 0.6;"></div>`;
          } else {
            html += `<div class="symbology-symbol point" style="background-color: ${color};"></div>`;
          }
          
          html += `<div class="symbology-label">`;
          html += `<div>${value}</div>`;
          html += `<div class="symbology-count">(${count} ${count === 1 ? 'elemento' : 'elementos'})</div>`;
          html += `</div>`;
          html += `</div>`;
        });
        
        html += `</div>`;
      });
      
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
          opacity: 0.8,
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
      
      const padding = { top: 30, right: 30, bottom: 55, left: 70 };
      const width = canvas.width - padding.left - padding.right;
      const height = canvas.height - padding.top - padding.bottom;
      
      // Limpiar canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Fondo
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Encontrar valores mínimos y máximos
      const minElev = Math.min(...elevations);
      const maxElev = Math.max(...elevations);
      const elevRange = maxElev - minElev;
      const maxDist = Math.max(...distances);
      
      // Dibujar líneas de cuadrícula y etiquetas del eje Y (elevación)
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 1;
      ctx.fillStyle = '#666';
      ctx.font = '11px Arial';
      
      const numYTicks = 5;
      for (let i = 0; i <= numYTicks; i++) {
        const y = padding.top + (height * i) / numYTicks;
        const elev = maxElev - (elevRange * i) / numYTicks;
        
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
      
      // Dibujar barras verticales más delgadas
      const numBars = Math.min(elevations.length, 150); // Limitar número de barras
      const barWidth = width / numBars;
      const step = Math.max(1, Math.floor(elevations.length / numBars));
      
      for (let i = 0; i < elevations.length; i += step) {
        const barIndex = Math.floor(i / step);
        const x = padding.left + (barIndex / numBars) * width;
        const normalizedElev = (elevations[i] - minElev) / elevRange;
        const barHeight = normalizedElev * height;
        const y = padding.top + height - barHeight;
        
        // Color uniforme en tono institucional
        ctx.fillStyle = '#8a2035';
        ctx.fillRect(x, y, Math.max(1, barWidth - 0.5), barHeight);
      }
      
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
      supabaseUrl = document.getElementById('url').value.trim();
      supabaseKey = document.getElementById('key').value.trim();
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
          'Drenaje',
          'inventario_aoe',
          'lineas de conduccion-ap',
          'lineas de conduccion-drenaje',
          'lineasdistribucion-drenaje',
          'rios y arroyos',
          'cuerpos de agua',
          'municipios',
          'regiones',
          'estadomex',
          // Agrega aquí más tablas de tu base de datos PH_AOA
          // Por ejemplo:
          // 'pozos',
          // 'plantas_tratamiento',
          // 'red_distribucion',
          // etc.
        ];
        
        console.log('🔍 Buscando capas en Supabase...');
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
            const r = await fetch(`${supabaseUrl}/rest/v1/${encodedTable}?select=*&limit=1`, {
              headers: { 
                'apikey': supabaseKey, 
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
              }
            });
            
            if (r.ok) {
              const sampleData = await r.json();
              const hasData = sampleData && sampleData.length > 0;
              
              console.log(`${hasData ? '✅' : '⚠️'} Tabla ${tbl}: ${hasData ? 'CON DATOS' : 'VACÍA'}`);
              
              // Asignar color específico
              let color;
              if (tbl.includes('cuerpos') || tbl.includes('agua')) {
                color = '#0077be'; // Azul para cuerpos de agua
              } else if (tbl.includes('rios') || tbl.includes('arroyos')) {
                color = '#4A90E2'; // Azul claro para ríos
              } else if (tbl === 'estadomex') {
                color = '#000000'; // Negro para límite estatal
              } else if (tbl.includes('Drenaje')) {
                color = '#8B4513'; // Café para drenaje
              } else if (tbl === 'lineasdistribucion-drenaje') {
                color = '#3d3d3d'; // Gris oscuro para líneas de distribución drenaje
              } else if (tbl === 'lineas de conduccion-drenaje') {
                color = '#505050'; // Gris fuerte para líneas de conducción drenaje
              } else if (tbl.includes('lineas')) {
                color = '#FF6B6B'; // Rojo para líneas de conducción
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
              console.log(`❌ Tabla ${tbl}: No accesible (${r.status})`);
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
      
      // Mapeo de nombres técnicos a nombres de visualización
      const nombresCapas = {
        'Drenaje': 'Drenaje',
        'inventario_aoe': 'Inventario DGAOE',
        'lineas de conduccion-ap': 'Lineas de Conducción AP',
        'lineas de conduccion-drenaje': 'Lineas de Conducción Drenaje',
        'lineasdistribucion-drenaje': 'Lineas de Distribución Drenaje',
        'rios y arroyos': 'Ríos y Arroyos',
        'cuerpos de agua': 'Cuerpos de Agua',
        'municipios': 'Municipios',
        'regiones': 'Regionalización',
        'estadomex': 'Límite Estatal'
      };
      
      // Obtener todas las capas disponibles
      const capasDisponibles = Object.keys(capasConfig);
      
      console.log('Capas disponibles en Supabase:', capasDisponibles);
      
      // Definir el orden específico para cada grupo
      const ordenInventarioCAEM = [
        'Drenaje',
        'inventario_aoe',
        'lineas de conduccion-ap',
        'lineas de conduccion-drenaje',
        'lineasdistribucion-drenaje'
      ];
      
      const ordenContextoGeografico = [
        'rios y arroyos',
        'cuerpos de agua',
        'municipios',
        'regiones',
        'estadomex'
      ];
      
      // Filtrar capas que existen en el orden definido
      const inventarioCAEM = ordenInventarioCAEM.filter(nombre => capasConfig[nombre]);
      const contextoGeografico = ordenContextoGeografico.filter(nombre => capasConfig[nombre]);
      
      // Identificar las capas que NO están en ninguno de los dos grupos anteriores
      const capasEnGrupos = [...ordenInventarioCAEM, ...ordenContextoGeografico];
      const otrasCapas = capasDisponibles.filter(nombre => !capasEnGrupos.includes(nombre));
      
      // Crear grupo Inventario CAEM (incluye capas predefinidas + capas nuevas automáticamente)
      if (inventarioCAEM.length > 0 || otrasCapas.length > 0) {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'layers-group';
        
        const titleDiv = document.createElement('div');
        titleDiv.className = 'layers-group-title';
        titleDiv.innerHTML = '<span>Inventario CAEM</span><span class="layers-group-toggle">▼</span>';
        titleDiv.onclick = () => toggleLayerGroup(titleDiv.nextElementSibling, titleDiv.querySelector('.layers-group-toggle'));
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'layers-group-content';
        
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
      
      // Crear grupo Contexto Geográfico
      if (contextoGeografico.length > 0) {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'layers-group';
        
        const titleDiv = document.createElement('div');
        titleDiv.className = 'layers-group-title';
        titleDiv.innerHTML = '<span>Contexto Geográfico</span><span class="layers-group-toggle">▼</span>';
        titleDiv.onclick = () => toggleLayerGroup(titleDiv.nextElementSibling, titleDiv.querySelector('.layers-group-toggle'));
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'layers-group-content';
        
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
      } else {
        if (capasActivas[nombre]) {
          map.removeLayer(capasActivas[nombre]);
          delete capasActivas[nombre];
        }
      }
      // Actualizar la simbología si el panel está abierto
      if (document.getElementById('symbology-panel').classList.contains('show')) {
        updateSymbology();
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
          const res = await fetch(`${supabaseUrl}/rest/v1/${encodedNombre}?select=*`, {
            headers: { 
              'apikey': supabaseKey, 
              'Authorization': `Bearer ${supabaseKey}`,
              'Range': '0-3999',  // Solicitar hasta 4000 registros
              'Prefer': 'count=exact'
            }
          });
          
          if (!res.ok) throw new Error('Error al cargar capa');
          data = await res.json();
          capasData[nombre] = data;
          
          // Mostrar información del rango descargado
          const contentRange = res.headers.get('Content-Range');
          if (contentRange) {
            const match = contentRange.match(/(\d+)-(\d+)\/(\d+)/);
            if (match) {
              const [, , , total] = match;
              console.log(`📥 Descargados ${data.length} de ${total} registros de ${nombre}`);
            }
          }
        }
        
        if (nombre === 'municipios') {
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
        else if (nombre === 'inventario_aoe') {
          const names = [...new Set(data.map(d => d.name))];
          const colorMap = {};
          names.forEach((n, idx) => {
            colorMap[n] = colores[idx % colores.length];
          });
          
          const geoJsonLayer = L.geoJSON(null, {
            pointToLayer: (feature, latlng) => {
              return L.circleMarker(latlng, {
                radius: 6,
                fillColor: colorMap[feature.properties.name] || '#999999',
                color: '#fff',
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
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
        else if (nombre === 'Drenaje') {
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
                radius: 6,
                fillColor: colorMap[proyecto] || '#999999',
                color: '#fff',
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
              });
            },
            style: (feature) => {
              const proyecto = feature.properties.PROYECTO || feature.properties.proyecto || 'Sin Proyecto';
              return {
                color: colorMap[proyecto] || '#999999',
                weight: 2,
                opacity: 0.8,
                fillOpacity: 0.5
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
                radius: 6,
                fillColor: colorMap[proyecto] || '#999999',
                color: '#fff',
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
              });
            },
            style: (feature) => {
              const proyecto = feature.properties.PROYECTO || feature.properties.proyecto || 'Sin Proyecto';
              return {
                color: colorMap[proyecto] || '#999999',
                weight: 1.5,  // Línea más delgada
                opacity: 0.8,
                fillOpacity: 0.3
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
                radius: 6,
                fillColor: colorMap[proyecto] || '#999999',
                color: '#fff',
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
              });
            },
            style: (feature) => {
              const proyecto = feature.properties.PROYECTO || feature.properties.proyecto || 'Sin Proyecto';
              return {
                color: colorMap[proyecto] || '#999999',
                weight: 2,
                opacity: 0.8,
                fillOpacity: 0.4
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
                radius: 6,
                fillColor: colorMap[proyecto] || '#999999',
                color: '#fff',
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
              });
            },
            style: (feature) => {
              const proyecto = feature.properties.PROYECTO || feature.properties.proyecto || 'Sin Proyecto';
              return {
                color: colorMap[proyecto] || '#999999',
                weight: 1.5,
                opacity: 0.8,
                fillOpacity: 0.3
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
        else if (nombre === 'estadomex') {
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
        else if (nombre === 'regiones') {
          // Regionalización: categorizada por municipi_1
          const municipios = [...new Set(data.map(d => d.municipi_1 || d.MUNICIPI_1 || 'Sin Municipio'))];
          const colorMap = {};
          
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
                opacity: 0.8,
                fillColor: colorMap[municipio] || '#999999',
                fillOpacity: 0.5
              };
            },
            onEachFeature: (feature, layer) => {
              const props = feature.properties;
              let popup = '<b>Regionalización</b><br>';
              popup += `<b>Municipio:</b> ${props.municipi_1 || props.MUNICIPI_1 || 'Sin Municipio'}<br>`;
              Object.keys(props).forEach(key => {
                if (key !== 'geom' && key !== 'municipi_1' && key !== 'MUNICIPI_1') {
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
                radius: 6,
                fillColor: config.color,
                color: '#fff',
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
              });
            },
            style: () => ({
              color: config.color,
              weight: 2,
              opacity: 0.7,
              fillOpacity: 0.3
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
        
        // Validar que la capa tenga bounds válidos antes de ajustar el mapa
        if (Object.keys(capasActivas).length === 1) {
          try {
            const bounds = capasActivas[nombre].getBounds();
            if (bounds && bounds.isValid()) {
              map.fitBounds(bounds);
            } else {
              console.warn(`La capa ${nombre} no tiene bounds válidos`);
            }
          } catch (err) {
            console.warn(`Error al obtener bounds de ${nombre}:`, err.message);
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
          const res = await fetch(`${supabaseUrl}/rest/v1/${encodedNombre}?select=*`, {
            headers: { 
              'apikey': supabaseKey, 
              'Authorization': `Bearer ${supabaseKey}`,
              'Range': '0-3999',  // Solicitar hasta 4000 registros
              'Prefer': 'count=exact'
            }
          });
          
          if (!res.ok) throw new Error('Error al descargar capa');
          data = await res.json();
          
          // Mostrar información del rango descargado
          const contentRange = res.headers.get('Content-Range');
          if (contentRange) {
            const match = contentRange.match(/(\d+)-(\d+)\/(\d+)/);
            if (match) {
              const [, , , total] = match;
              console.log(`📥 Descargados ${data.length} de ${total} registros de ${nombre}`);
            }
          }
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
      document.getElementById('transparency-value').textContent = valor + '%';
      
      // Recorrer todas las capas activas y ajustar la opacidad de los polígonos
      Object.keys(capasActivas).forEach(nombreCapa => {
        const capa = capasActivas[nombreCapa];
        
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
      });
    }
    
    // Función para ocultar/mostrar la barra lateral
    function toggleSidebar() {
      const sidebar = document.getElementById('sidebar');
      const mapElement = document.getElementById('map');
      const toggleContainer = document.getElementById('toggle-sidebar-container');
      const toggleBtn = document.getElementById('toggle-sidebar-btn');
      const searchContainer = document.getElementById('search-places-container');
      const symbologyContainer = document.getElementById('symbology-container');
      const deactivateContainer = document.getElementById('deactivate-layers-container');
      
      // Toggle las clases
      sidebar.classList.toggle('hidden');
      mapElement.classList.toggle('expanded');
      toggleContainer.classList.toggle('sidebar-hidden');
      toggleBtn.classList.toggle('sidebar-hidden');
      searchContainer.classList.toggle('sidebar-hidden');
      symbologyContainer.classList.toggle('sidebar-hidden');
      deactivateContainer.classList.toggle('sidebar-hidden');
      
      // Invalidar el tamaño del mapa después de la transición para que se ajuste correctamente
      setTimeout(() => {
        map.invalidateSize();
      }, 300);
    }