const client = ZAFClient.init();
let globalTooltip = null;
let originalScales = new WeakMap();

// Objeto para almacenar instancias de uPlot
let charts = {
    ticketsByDay: null
};

// Debug: Agregar logs de estado
console.log('ZAF Client inicializado:', client);

// Colores para los gráficos
const chartColors = {
    primary: '#03363d',
    secondary: '#68737d',
    success: '#2f3941',
    info: '#0d6efd',
    warning: '#ffc107',
    danger: '#dc3545',
    light: '#f8f9fa',
    dark: '#2f3941'
};

// Función para mostrar estado en la UI
function showStatus(message, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${message}`);
    
    // Mostrar en la UI también
    const statusDiv = document.getElementById('app-status') || createStatusDiv();
    statusDiv.innerHTML = `
        <div class="alert alert-${type === 'error' ? 'danger' : type === 'success' ? 'success' : 'info'}" role="alert">
            ${message}
        </div>
    `;
}

function createStatusDiv() {
    const statusDiv = document.createElement('div');
    statusDiv.id = 'app-status';
    statusDiv.style.position = 'fixed';
    statusDiv.style.top = '10px';
    statusDiv.style.right = '10px';
    statusDiv.style.zIndex = '9999';
    statusDiv.style.maxWidth = '300px';
    document.body.appendChild(statusDiv);
    return statusDiv;
}

// Configuración de campos de fecha (sin valores por defecto)
function initializeDateFields() {
    try {
        const startDateElement = document.getElementById('startDate');
        const endDateElement = document.getElementById('endDate');
        
        if (startDateElement && endDateElement) {
            // Dejar los campos vacíos para mostrar todos los tickets inicialmente
            startDateElement.value = '';
            endDateElement.value = '';
            showStatus('Campos de fecha inicializados (sin filtro)', 'success');
        } else {
            showStatus('Error: Elementos de fecha no encontrados', 'error');
        }
    } catch (error) {
        showStatus(`Error inicializando campos de fecha: ${error.message}`, 'error');
    }
}

// Inicializar la aplicación
async function init() {
    try {
        showStatus('Inicializando aplicación...', 'info');
        
        // Verificar que ZAF está disponible
        if (!client) {
            throw new Error('ZAF Client no disponible');
        }
        
        // Verificar contexto de Zendesk
        try {
            const context = await client.context();
            showStatus(`Contexto ZAF obtenido: ${context.location}`, 'success');
        } catch (e) {
            showStatus(`Advertencia: No se pudo obtener contexto ZAF: ${e.message}`, 'warning');
        }
        
        initializeDateFields();
        
        // Event listeners para filtros
        const applyFilterBtn = document.getElementById('applyFilter');
        if (applyFilterBtn) {
            applyFilterBtn.addEventListener('click', async () => {
                showStatus('Aplicando filtro...', 'info');
                const startDateElement = document.getElementById('startDate');
                const endDateElement = document.getElementById('endDate');
                const alertDiv = document.getElementById('date-filter-alert');

                if (startDateElement && endDateElement) {
                    const startDate = startDateElement.value;
                    const endDate = endDateElement.value;

                    // Permitir campos vacíos para mostrar todos los tickets
                    if ((startDate || endDate) && !validateDates(startDate, endDate)) {
                        if (alertDiv) alertDiv.classList.remove('d-none');
                        showStatus('Fechas inválidas seleccionadas', 'error');
                        return;
                    }

                    if (alertDiv) alertDiv.classList.add('d-none');
                    
                    // Si ambos campos están vacíos, mostrar todos los tickets
                    if (!startDate && !endDate) {
                        showStatus('Mostrando todos los tickets', 'info');
                        await updateDashboard(null, null);
                    } else {
                        showStatus(`Filtrando tickets${startDate ? ' desde ' + startDate : ''}${endDate ? ' hasta ' + endDate : ''}`, 'info');
                        await updateDashboard(startDate || null, endDate || null);
                    }
                }
            });
            showStatus('Event listeners configurados', 'success');
        }

        // Cargar todos los tickets inicialmente (sin filtro de fechas)
        await updateDashboard();
        showStatus('Aplicación inicializada - Mostrando todos los tickets', 'success');
        
    } catch (error) {
        showStatus(`Error crítico en inicialización: ${error.message}`, 'error');
        console.error('Error completo:', error);
    }
}

// Función para validar las fechas (permitir campos vacíos)
function validateDates(startDateStr, endDateStr) {
    // Si ambos están vacíos, es válido (mostrar todos)
    if (!startDateStr && !endDateStr) return true;
    
    // Si solo uno está vacío, también es válido
    if (!startDateStr || !endDateStr) return true;
    
    // Si ambos tienen valores, validar que sean fechas válidas y lógicas
    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return false;
    }
    if (startDate > endDate) {
        return false;
    }
    return true;
}

// Configuración común para uPlot
const commonUPlotOptions = {
    responsive: true,
    plugins: []
};

// Plugin para tooltips
function tooltipPlugin() {
    return {
        hooks: {
            setCursor: [
                (u) => {
                    try {
                        if (!globalTooltip) {
                            globalTooltip = document.createElement("div");
                            globalTooltip.className = "uplot-tooltip";
                            globalTooltip.style.cssText = `
                                position: absolute;
                                pointer-events: none;
                                z-index: 100;
                                background: rgba(0, 0, 0, 0.8);
                                color: #fff;
                                padding: 8px 12px;
                                border-radius: 4px;
                                font-size: 14px;
                                white-space: nowrap;
                                display: none;
                            `;
                            document.body.appendChild(globalTooltip);
                        }
                        
                        const { left, top } = u.cursor;
                        const idx = u.cursor.idx;
                        
                        if (idx !== null && u.data[0] && u.data[0][idx] !== undefined) {
                            let tooltipContent = '';
                            
                            if (u.scales && u.scales.x && u.scales.x.time) {
                                tooltipContent += `Fecha: ${uPlot.fmtDate(new Date(u.data[0][idx] * 1000), "{YYYY}-{MM}-{DD}")}<br>`;
                            }

                            for(let i = 1; i < u.series.length; i++) {
                                if (u.series[i].label && u.data[i] && u.data[i][idx] !== undefined && u.data[i][idx] !== null) {
                                    tooltipContent += `${u.series[i].label}: ${u.data[i][idx]}<br>`;
                                }
                            }

                            if (tooltipContent) {
                                globalTooltip.innerHTML = tooltipContent;
                                globalTooltip.style.display = "block";
                                const chartRect = u.root.getBoundingClientRect();
                                globalTooltip.style.left = (chartRect.left + left + window.scrollX + 10) + "px";
                                globalTooltip.style.top = (chartRect.top + top + window.scrollY - 30) + "px";
                            } else {
                                globalTooltip.style.display = "none";
                            }
                        } else {
                            if (globalTooltip) globalTooltip.style.display = "none";
                        }
                    } catch (error) {
                        console.error('Error en tooltip:', error);
                    }
                }
            ],
            setSeries: [() => { if (globalTooltip) globalTooltip.style.display = "none"; }],
            setScale: [() => { if (globalTooltip) globalTooltip.style.display = "none"; }],
            ready: [(u) => { 
                if (u.root) {
                    u.root.addEventListener('mouseleave', () => { 
                        if (globalTooltip) globalTooltip.style.display = "none"; 
                    }); 
                }
            }]
        }
    };
}

// Plugin para reset de zoom
function zoomResetPlugin() {
    return {
        hooks: {
            ready: [
                (u) => {
                    try {
                        if (!originalScales.has(u)) {
                            originalScales.set(u, {
                                xMin: u.scales.x.min,
                                xMax: u.scales.x.max,
                                yMin: u.scales.y.min,
                                yMax: u.scales.y.max
                            });
                        }
                        
                        if (u.over) {
                            u.over.addEventListener("dblclick", () => {
                                const orig = originalScales.get(u);
                                if (orig) {
                                    u.setScale("x", { min: orig.xMin, max: orig.xMax });
                                    u.setScale("y", { min: orig.yMin, max: orig.yMax });
                                }
                            });
                        }
                    } catch (error) {
                        console.error('Error en zoomResetPlugin:', error);
                    }
                }
            ]
        }
    };
}

// Actualizar el dashboard
async function updateDashboard(startDate = null, endDate = null) {
    try {
        showStatus('Cargando datos del dashboard...', 'info');
        
        const tickets = await fetchZendeskTickets(startDate, endDate);
        showStatus(`${tickets.length} tickets obtenidos`, 'success');
        
        const analysis = analyzeTickets(tickets);
        showStatus('Análisis de datos completado', 'success');
        
        updateMetrics(analysis);
        updateCharts(analysis);
        
        showStatus('Dashboard actualizado correctamente', 'success');
        
    } catch (error) {
        showStatus(`Error actualizando dashboard: ${error.message}`, 'error');
        console.error('Error completo:', error);
    }
}

// Obtener tickets de Zendesk
async function fetchZendeskTickets(startDate = null, endDate = null) {
    try {
        if (!startDate && !endDate) {
            showStatus('Obteniendo TODOS los tickets de Zendesk...', 'info');
        } else {
            showStatus('Obteniendo tickets filtrados de Zendesk...', 'info');
        }
        
        // Construir query para Search API
        let query = 'type:ticket';
        
        // Solo agregar filtros de fecha si se proporcionan
        if (startDate && endDate) {
            query += ` created>=${startDate} created<=${endDate}`;
        } else if (startDate) {
            query += ` created>=${startDate}`;
        } else if (endDate) {
            query += ` created<=${endDate}`;
        }
        // Si no hay fechas, la query queda como 'type:ticket' para obtener todos

        console.log('Query de búsqueda:', query);

        const response = await client.request({
            url: `/api/v2/search.json?query=${encodeURIComponent(query)}`,
            type: 'GET',
            contentType: 'application/json'
        });

        console.log('Respuesta de API:', response);

        if (response && response.results) {
            const tickets = response.results.map(ticket => ({
                id: ticket.id,
                status: ticket.status,
                created_at: ticket.created_at,
                subject: ticket.subject,
                priority: ticket.priority || 'normal'
            }));
            
            const filterMsg = !startDate && !endDate ? 'todos los tickets' : `tickets filtrados`;
            showStatus(`API exitosa: ${tickets.length} ${filterMsg}`, 'success');
            return tickets;
        }
        
        throw new Error('Respuesta de API vacía o inválida');
        
    } catch (error) {
        const filterMsg = !startDate && !endDate ? 'todos los tickets' : 'tickets filtrados';
        showStatus(`Error en API para ${filterMsg}: ${error.message}. Usando datos simulados...`, 'warning');
        console.error('Error de API:', error);
        
        // Fallback con datos simulados
        return generateMockTickets(startDate, endDate);
    }
}

// Generar datos simulados
function generateMockTickets(startDate = null, endDate = null) {
    if (!startDate && !endDate) {
        showStatus('Generando datos simulados para TODOS los tickets...', 'info');
    } else {
        showStatus('Generando datos simulados con filtro de fechas...', 'info');
    }
    
    const mockTickets = [];
    
    // Si no hay filtros, generar datos para los últimos 90 días
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const count = Math.floor(Math.random() * 20) + 1;
        for (let i = 0; i < count; i++) {
            mockTickets.push({
                id: Math.floor(Math.random() * 100000),
                status: ['new', 'open', 'pending', 'solved'][Math.floor(Math.random() * 4)],
                created_at: new Date(d).toISOString(),
                subject: `Ticket simulado ${i + 1}`,
                priority: ['low', 'normal', 'high', 'urgent'][Math.floor(Math.random() * 4)]
            });
        }
    }
    
    const filterMsg = !startDate && !endDate ? 'todos los tickets simulados' : 'tickets simulados filtrados';
    showStatus(`${mockTickets.length} ${filterMsg} generados`, 'success');
    return mockTickets;
}

// Analizar tickets
function analyzeTickets(tickets) {
    try {
        if (!Array.isArray(tickets)) {
            tickets = [];
        }

        const ticketsWithDates = tickets.map(ticket => ({
            ...ticket,
            created_at: new Date(ticket.created_at)
        })).filter(ticket => !isNaN(ticket.created_at.getTime()));

        const analysis = {
            total_tickets: ticketsWithDates.length,
            tickets_by_date: {
                date: [],
                count: []
            }
        };

        // Distribución por fecha
        const dateCounts = {};
        ticketsWithDates.forEach(ticket => {
            const date = ticket.created_at.toISOString().split('T')[0];
            dateCounts[date] = (dateCounts[date] || 0) + 1;
        });
        
        const sortedDates = Object.keys(dateCounts).sort();
        analysis.tickets_by_date.date = sortedDates;
        analysis.tickets_by_date.count = sortedDates.map(date => dateCounts[date]);

        return analysis;
    } catch (error) {
        console.error('Error analizando tickets:', error);
        return { total_tickets: 0, tickets_by_date: { date: [], count: [] } };
    }
}

// Actualizar métricas
function updateMetrics(data) {
    try {
        const totalTicketsElement = document.getElementById('total-tickets');
        if (totalTicketsElement) {
            totalTicketsElement.textContent = data.total_tickets || '0';
        }
        
        if (data.tickets_by_date && data.tickets_by_date.date && data.tickets_by_date.count) {
            const today = new Date().toISOString().split('T')[0];
            const todayIndex = data.tickets_by_date.date.indexOf(today);
            const ticketsToday = todayIndex !== -1 ? data.tickets_by_date.count[todayIndex] : 0;
            
            const ticketsHoyElement = document.getElementById('tickets-hoy');
            if (ticketsHoyElement) {
                ticketsHoyElement.textContent = ticketsToday;
            }
        }

        const ticketsPendientesElement = document.getElementById('tickets-pendientes');
        if (ticketsPendientesElement) ticketsPendientesElement.textContent = 'N/A';
        
        const tasaResolucionElement = document.getElementById('tasa-resolucion');
        if (tasaResolucionElement) tasaResolucionElement.textContent = 'N/A';
        
    } catch (error) {
        console.error('Error actualizando métricas:', error);
    }
}

// Crear gráfico
function createTicketsByDayChart(data) {
    try {
        showStatus('Creando gráfico de tickets...', 'info');
        
        const container = document.getElementById('projection-chart');
        if (!container) {
            throw new Error('Container del gráfico no encontrado');
        }

        // Limpiar gráfico anterior
        if (charts.ticketsByDay) {
            charts.ticketsByDay.destroy();
            container.innerHTML = '';
        }

        if (!data || !data.tickets_by_date || !data.tickets_by_date.date || !data.tickets_by_date.count) {
            container.innerHTML = '<div class="alert alert-info">No hay datos disponibles para el gráfico.</div>';
            return;
        }

        const dates = data.tickets_by_date.date.map(d => new Date(d).getTime() / 1000);
        const counts = data.tickets_by_date.count;

        if (dates.length === 0) {
            container.innerHTML = '<div class="alert alert-info">No hay datos en el rango seleccionado.</div>';
            return;
        }

        const opts = {
            ...commonUPlotOptions,
            title: "Tickets por Día",
            width: container.offsetWidth || 600,
            height: 350,
            scales: {
                x: { time: true },
                y: { auto: true, min: 0 },
            },
            series: [
                {},
                { 
                    label: "Tickets", 
                    stroke: chartColors.primary, 
                    width: 2, 
                    fill: "rgba(3, 54, 61, 0.1)"
                },
            ],
            axes: [
                {
                    values: (u, ticks) => ticks.map(ts => {
                        try {
                            return uPlot.fmtDate(new Date(ts * 1000), "{MMM} {DD}");
                        } catch (e) {
                            return '';
                        }
                    }),
                },
                { size: 60 }
            ],
            plugins: [tooltipPlugin(), zoomResetPlugin()]
        };

        const plotData = [dates, counts];
        charts.ticketsByDay = new uPlot(opts, plotData, container);
        
        showStatus('Gráfico creado exitosamente', 'success');

    } catch (error) {
        showStatus(`Error creando gráfico: ${error.message}`, 'error');
        const container = document.getElementById('projection-chart');
        if (container) {
            container.innerHTML = `<div class="alert alert-danger">Error creando gráfico: ${error.message}</div>`;
        }
    }
}

// Actualizar gráficos
function updateCharts(data) {
    try {
        Object.keys(charts).forEach(key => {
            if (charts[key]) {
                try {
                    charts[key].destroy();
                } catch (e) {
                    console.error(`Error destroying chart ${key}:`, e);
                }
                charts[key] = null;
            }
        });

        createTicketsByDayChart(data);
    } catch (error) {
        console.error('Error actualizando gráficos:', error);
    }
}

// Eventos ZAF
client.on('app.activated', () => {
    showStatus('App ZAF activada', 'success');
    init();
});

client.on('app.deactivated', () => {
    showStatus('App ZAF desactivada', 'info');
});

// Resize handler
window.addEventListener('resize', () => {
    setTimeout(() => {
        Object.keys(charts).forEach(key => {
            if (charts[key] && charts[key].root && charts[key].root.parentElement) {
                try {
                    charts[key].setSize({ 
                        width: charts[key].root.parentElement.offsetWidth, 
                        height: 350 
                    });
                } catch (e) {
                    console.error(`Error resizing chart ${key}:`, e);
                }
            }
        });
    }, 100);
});

// Inicialización DOM
document.addEventListener('DOMContentLoaded', () => {
    showStatus('DOM cargado, inicializando...', 'info');
    init();
});