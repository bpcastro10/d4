const client = ZAFClient.init();
let globalTooltip = null;

// Para guardar los límites originales de zoom
let originalScales = new WeakMap();

// Objeto para almacenar instancias de uPlot
let charts = {
    ticketsByDay: null // Solo mantendremos el gráfico de tickets por día
};

// Colores para los gráficos (compatibles con el tema de Zendesk)
const chartColors = {
    primary: '#03363d',    // Color principal de Zendesk
    secondary: '#68737d',  // Gris de Zendesk
    success: '#2f3941',    // Verde oscuro de Zendesk
    info: '#0d6efd',      // Azul de Zendesk
    warning: '#ffc107',    // Amarillo de Zendesk
    danger: '#dc3545',     // Rojo de Zendesk
    light: '#f8f9fa',      // Gris claro
    dark: '#2f3941'        // Gris oscuro de Zendesk
};

// Configuración de fechas por defecto
function setDefaultDates() {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    
    document.getElementById('startDate').value = startDate.toISOString().split('T')[0];
    document.getElementById('endDate').value = endDate.toISOString().split('T')[0];
}

// Inicializar la aplicación
async function init() {
    setDefaultDates();
    // Cargar el dashboard inicialmente con las fechas por defecto
    await updateDashboard();

    // Añadir event listener para el botón de filtro
    document.getElementById('applyFilter').addEventListener('click', async () => {
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        const alertDiv = document.getElementById('date-filter-alert');

        if (validateDates(startDate, endDate)) {
            alertDiv.classList.add('d-none'); // Ocultar alerta si es válido
            await updateDashboard(startDate, endDate);
        } else {
            alertDiv.classList.remove('d-none'); // Mostrar alerta si es inválido
        }
    });
}

// Función para validar las fechas
function validateDates(startDateStr, endDateStr) {
    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return false; // Una o ambas fechas no son válidas
    }
    if (startDate > endDate) {
        return false; // La fecha de inicio es posterior a la fecha de fin
    }
    return true;
}

// Configuración común para uPlot
const commonUPlotOptions = {
    responsive: true,
    plugins: [],
    zoom: {
        interactive: true,
        wheel: true,
        pinch: true,
        drag: {
            setScale: true,
            x: true,
            y: true,
        },
    },
    pan: {
        interactive: true,
    },
};

// Plugin para tooltips
function tooltipPlugin() {
    return {
        hooks: {
            setCursor: [
                (u) => {
                    if (!globalTooltip) {
                        globalTooltip = document.createElement("div");
                        globalTooltip.className = "uplot-tooltip";
                        globalTooltip.style.position = "absolute";
                        globalTooltip.style.pointerEvents = "none";
                        globalTooltip.style.zIndex = "100";
                        document.body.appendChild(globalTooltip);
                    }
                    const { left, top } = u.cursor;
                    const idx = u.cursor.idx;
                    if (idx !== null && u.data[0][idx] !== undefined) {
                        let tooltipContent = '';
                        if (u.series && u.data && u.data[0] && u.data[0][idx] !== undefined) {
                            if (u.scales.x.time) {
                                tooltipContent += `Fecha/Hora: ${uPlot.fmtDate(new Date(u.data[0][idx] * 1000), "{YYYY}-{MM}-{DD} {H}:{mm}")}<br>`;
                            } else {
                                const label = u.axes[0].values[u.data[0][idx]];
                                tooltipContent += `Categoría: ${label}<br>`;
                            }

                            for(let i = 1; i < u.series.length; i++) {
                                if (u.series[i].label && u.data[i] && u.data[i][idx] !== undefined && u.data[i][idx] !== null) {
                                    tooltipContent += `${u.series[i].label}: ${u.data[i][idx]}<br>`;
                                }
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
                        globalTooltip.style.display = "none";
                    }
                }
            ],
            setSeries: [
                () => { if (globalTooltip) globalTooltip.style.display = "none"; }
            ],
            setScale: [
                () => { if (globalTooltip) globalTooltip.style.display = "none"; }
            ],
            ready: [
                (u) => { u.root.addEventListener('mouseleave', () => { if (globalTooltip) globalTooltip.style.display = "none"; }); }
            ]
        }
    };
}

// Plugin para reset de zoom
function zoomResetPlugin() {
    return {
        hooks: {
            ready: [
                (u) => {
                    if (!originalScales.has(u)) {
                        originalScales.set(u, {
                            xMin: u.scales.x.min,
                            xMax: u.scales.x.max,
                            yMin: u.scales.y.min,
                            yMax: u.scales.y.max
                        });
                    }
                    u.over.addEventListener("dblclick", () => {
                        const orig = originalScales.get(u);
                        if (orig) {
                            u.setScale("x", { min: orig.xMin, max: orig.xMax });
                            u.setScale("y", { min: orig.yMin, max: orig.yMax });
                        }
                    });
                }
            ]
        }
    };
}

// Obtener datos de tickets
async function getTicketData() {
    try {
        const tickets = await client.get('ticket.list');
        return tickets['ticket.list'];
    } catch (error) {
        console.error('Error al obtener tickets:', error);
        return [];
    }
}

// Actualizar el dashboard
async function updateDashboard(startDate = null, endDate = null) {
    try {
        const tickets = await fetchZendeskTickets(startDate, endDate);
        const analysis = analyzeTickets(tickets);
        updateMetrics(analysis);
        updateCharts(analysis);
    } catch (error) {
        console.error('Error al actualizar el dashboard:', error);
        document.querySelector('.container-fluid').innerHTML = `
            <div class="alert alert-danger" role="alert">
                Error al cargar los datos. Por favor, intente nuevamente más tarde.
            </div>
        `;
    }
}

// Obtener tickets de Zendesk usando la API REST
async function fetchZendeskTickets(startDate = null, endDate = null) {
    try {
        let url = '/api/v2/tickets.json';
        const params = new URLSearchParams();

        if (startDate) {
            // Zendesk API espera timestamps ISO 8601 o UNIX en segundos
            // Convertir la fecha de inicio a inicio del día en UTC
            const startDateTime = new Date(startDate + 'T00:00:00Z');
            params.append('start_time', Math.floor(startDateTime.getTime() / 1000));
        }
        if (endDate) {
            // Convertir la fecha de fin a fin del día (23:59:59) en UTC
            const endDateTime = new Date(endDate + 'T23:59:59Z');
            params.append('end_time', Math.floor(endDateTime.getTime() / 1000));
        }

        if (params.toString()) {
            url += `?${params.toString()}`;
        }

        // Obtener tickets usando la API REST de Zendesk a través de ZAF
        const response = await client.request({
            url: url,
            type: 'GET',
            contentType: 'application/json',
            headers: {
                'Accept': 'application/json'
            }
        });

        return response.tickets.map(ticket => ({
            id: ticket.id,
            status: ticket.status,
            created_at: ticket.created_at,
            subject: ticket.subject,
            priority: ticket.priority || 'normal'
        }));
    } catch (error) {
        console.error('Error al obtener tickets de Zendesk:', error);
        throw error;
    }
}

// Analizar tickets
function analyzeTickets(tickets) {
    try {
        // Convertir fechas a objetos Date
        const ticketsWithDates = tickets.map(ticket => ({
            ...ticket,
            created_at: new Date(ticket.created_at)
        }));

        // Análisis básico
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
        console.error('Error al analizar tickets:', error);
        throw error;
    }
}

// Función para actualizar las métricas
function updateMetrics(data) {
    if (data) {
        document.getElementById('total-tickets').textContent = data.total_tickets || '0';
        
        if (data.tickets_by_date && data.tickets_by_date.date && data.tickets_by_date.count) {
            const today = new Date().toISOString().split('T')[0];
            const todayIndex = data.tickets_by_date.date.indexOf(today);
            const ticketsToday = todayIndex !== -1 ? data.tickets_by_date.count[todayIndex] : 0;
            document.getElementById('tickets-hoy').textContent = ticketsToday;
        }

        document.getElementById('tickets-pendientes').textContent = 'N/A'; // o eliminar
        document.getElementById('tasa-resolucion').textContent = 'N/A'; // o eliminar
    }
}

// Función para crear el gráfico de Tickets por Día
function createTicketsByDayChart(data) {
    console.log("Creating Tickets by Day Chart (uPlot)", data);
    const container = document.getElementById('projection-chart'); // Mantener el ID del contenedor si no se cambia en el HTML
    if (!container) return;

    // Destruir gráfico existente si lo hay
    if (charts.ticketsByDay) {
         charts.ticketsByDay.destroy();
         container.innerHTML = ''; // Limpiar el div
    }

    // Adaptar datos de tickets_by_date del backend para uPlot
     if (data && data.tickets_by_date && data.tickets_by_date.date && data.tickets_by_date.count) {
        const dates = data.tickets_by_date.date.map(d => new Date(d).getTime() / 1000); // Timestamps históricos
        const counts = data.tickets_by_date.count;

        // No hay futureDates si solo mostramos tickets reales históricos
        const allDates = dates;

        // Datos para Tickets reales (solo hasta la última fecha histórica)
        const realTicketsData = counts; // Ahora es directo, ya no se combinan datos futuros

        const opts = {
            ...commonUPlotOptions,
            title: "Tickets por Día",
             width: container.offsetWidth,
            height: 350,
            scales: {
                x: { time: true },
                y: { auto: true, min: 0 },
            },
            series: [
                {},
                { label: "Tickets reales", stroke: chartColors.primary, width: 2, fill: "rgba(13, 110, 253, 0.1)"},
            ],
             axes: [
                {   // x-axis
                    values: (u, ticks, space) => ticks.map(ts => uPlot.fmtDate(new Date(ts * 1000), "{MMM} {DD}")),
                },
                {   // y-axis
                     size: (u, values, space) => u.axisFontSize,
                }
            ],
             plugins: [tooltipPlugin(), zoomPlugin()]
        };

        const plotData = [allDates, realTicketsData];

        charts.ticketsByDay = new uPlot(opts, plotData, container);

     } else {
         container.innerHTML = '<p>No hay datos disponibles para el gráfico de Tickets por Día.</p>';
    }
}

// Función para actualizar todos los gráficos
function updateCharts(data) {
    console.log("Updating charts with data:", data);

     Object.keys(charts).forEach(key => {
        if (charts[key]) {
            try {
                 charts[key].destroy();
            } catch (e) {
                 console.error(`Error destroying chart ${key}:`, e);
            }
            charts[key] = null; // Limpiar la referencia
            const container = document.getElementById(`${key}-chart`);
            if(container) container.innerHTML = '';
        }
     });

    createTicketsByDayChart(data);
}

// Inicialización de la aplicación ZAF
client.on('app.activated', () => {
    console.log('Zendesk app activated');
    updateDashboard();
    // Actualizar cada 5 minutos (ajustar según límites de la API de Zendesk)
    setInterval(updateDashboard, 5 * 60 * 1000);
});

// Consideraciones adicionales para ZAF:
// - Manejo de errores más robusto.
// - Considerar límites de tasa de la API de Zendesk si se hacen muchas llamadas directas.
// - Seguridad: asegurar que las llamadas al backend sean seguras en producción.
// - Posible uso de Setting API para URLs de backend u otras configuraciones.
// - Internacionalización si es necesario.

// Inicializar la aplicación cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', init); 