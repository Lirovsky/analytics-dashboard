function cssVar(name, fallback = "") {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
}

function getLegendColor() {
    // Se quiser "branco no dark e preto no light" de forma explícita:
    const theme = document.documentElement.getAttribute("data-theme");
    if (theme === "dark") return "#fff";
    return "#000";
    // Alternativa melhor (segue teus tokens do theme.css):
    // return cssVar("--color-text-primary", theme === "dark" ? "#fff" : "#000");
}

function applyThemeToChart(chart) {
    if (!chart) return;

    const legendColor = getLegendColor();
    const tickColor = cssVar("--color-text-secondary", legendColor);
    const gridColor = cssVar("--color-border", "rgba(0,0,0,.1)");

    // Legenda
    chart.options.plugins = chart.options.plugins || {};
    chart.options.plugins.legend = chart.options.plugins.legend || {};
    chart.options.plugins.legend.labels = chart.options.plugins.legend.labels || {};
    chart.options.plugins.legend.labels.color = legendColor;

    // (Opcional, mas geralmente necessário no dark) Eixos
    if (chart.options.scales) {
        Object.values(chart.options.scales).forEach((axis) => {
            axis.ticks = axis.ticks || {};
            axis.grid = axis.grid || {};
            axis.ticks.color = tickColor;
            axis.grid.color = gridColor;
        });
    }

    chart.update("none");
}

function registerChartThemeSync(charts) {
    // aplica no load
    charts.forEach(applyThemeToChart);

    // reaplica quando data-theme mudar (theme.js altera isso)
    const obs = new MutationObserver(() => charts.forEach(applyThemeToChart));
    obs.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
    });
}

// Exemplo: depois de criar todos os charts
// registerChartThemeSync([chartVendor, chartArea, chartSistema, chartTime, chartDesafio, chartMoney, chartOrigem]);
