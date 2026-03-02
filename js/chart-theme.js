function cssVar(name, fallback = "") {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
}

function getLegendColor() {
    const theme = document.documentElement.getAttribute("data-theme");
    if (theme === "dark") return "#fff";
    return "#000";
}

function applyThemeToChart(chart) {
    if (!chart) return;

    const legendColor = getLegendColor();
    const tickColor = cssVar("--color-text-secondary", legendColor);
    const gridColor = cssVar("--color-border", "rgba(0,0,0,.1)");

    chart.options.plugins = chart.options.plugins || {};
    chart.options.plugins.legend = chart.options.plugins.legend || {};
    chart.options.plugins.legend.labels = chart.options.plugins.legend.labels || {};
    chart.options.plugins.legend.labels.color = legendColor;
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
    charts.forEach(applyThemeToChart);
    const obs = new MutationObserver(() => charts.forEach(applyThemeToChart));
    obs.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
    });
}