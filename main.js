
const scatterPlotSvg = d3.select('#vis');
const scatterViewBoxWidth = 960;
const scatterViewBoxHeight = 600;
const scatterMargin = { top: 40, right: 40, bottom: 60, left: 70 };
const scatterInnerWidth = scatterViewBoxWidth - scatterMargin.left - scatterMargin.right;
const scatterInnerHeight = scatterViewBoxHeight - scatterMargin.top - scatterMargin.bottom;
const gScatter = scatterPlotSvg.append('g')
    .attr('transform', `translate(${scatterMargin.left},${scatterMargin.top})`);

scatterPlotSvg.append("text")
    .attr("x", scatterViewBoxWidth / 2)
    .attr("y", scatterMargin.top / 2 + 5)
    .attr("text-anchor", "middle")
    .style("font-size", "18px")
    .style("font-weight", "bold")
    .text("Music Lyrics (t-SNE)");

gScatter.append("text")
    .attr("class", "x-axis-label")
    .attr("x", scatterInnerWidth / 2)
    .attr("y", scatterInnerHeight + scatterMargin.bottom - 15)
    .attr("text-anchor", "middle")
    .style("font-size", "14px")
    .text("t-SNE Dimension 1");

gScatter.append("text")
    .attr("class", "y-axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -scatterInnerHeight / 2)
    .attr("y", -scatterMargin.left + 20)
    .attr("text-anchor", "middle")
    .style("font-size", "14px")
    .text("t-SNE Dimension 2");

gScatter.append('defs')
    .append('clipPath')
    .attr('id', 'chart-clip')
    .append('rect')
    .attr('width', scatterInnerWidth)
    .attr('height', scatterInnerHeight);

const contentGroup = gScatter.append('g')
    .attr('clip-path', 'url(#chart-clip)');


let allRawData = [];
let circlesSelection;
let brushInstance;
let brushGroup;
let originalXScale, originalYScale;
let currentXScale, currentYScale;
let xAxisG, yAxisG;
let xAxisGenerator, yAxisGenerator;
let zoomBehavior;
let isBrushActive = false;
let activeBrushSelection = null;

const EMOTIONS_LIST = ["anger", "sadness", "joy", "fear", "love", "surprise"];
let activeEmotions = new Set();
let activeGenreTags = new Set();
let allUniqueGenres = [];
let currentSearchTerm = "";

let cumulativeBarFilters = [];

const CIRCLE_RADIUS = 3.5;
const CIRCLE_OPACITY_DEFAULT = 0.7;
const CIRCLE_OPACITY_DIMMED = 0.1;
const CIRCLE_OPACITY_HIGHLIGHTED = 1;
const VERY_LOW_OPACITY_FOR_FILTERED_OUT = 0.02;
const TOOLTIP_OFFSET_X = 15;
const TOOLTIP_OFFSET_Y = 15;
const ZOOM_SCALE_EXTENT = [0.5, 10];
const ZOOM_TRANSITION_DURATION = 750;


function parseLengthToSeconds(lengthStr) {
    if (!lengthStr || typeof lengthStr !== 'string' || !lengthStr.includes(':')) return null;
    const parts = lengthStr.split(':');
    if (parts.length !== 2) return null;
    const minutes = parseInt(parts[0], 10);
    const seconds = parseInt(parts[1], 10);
    if (isNaN(minutes) || isNaN(seconds)) return null;
    return minutes * 60 + seconds;
}

const statChartMargin = { top: 20, right: 20, bottom: 50, left: 45 };
const statChartHeight = 220;


function setupStatChart(svgId, chartTitle) {
    const svg = d3.select(`#${svgId}`);
    svg.html("");
    const parentWidth = svg.node().getBoundingClientRect().width;
    const innerWidth = parentWidth > 0 ? parentWidth - statChartMargin.left - statChartMargin.right : 200;
    const innerHeight = statChartHeight - statChartMargin.top - statChartMargin.bottom;
    svg.attr("height", statChartHeight);
    const g = svg.append("g").attr("transform", `translate(${statChartMargin.left},${statChartMargin.top})`);
    g.append("g").attr("class", "x-axis axis");
    g.append("g").attr("class", "y-axis axis");
    g.append("text")
        .attr("class", "no-data-message")
        .attr("x", innerWidth / 2)
        .attr("y", innerHeight / 2)
        .attr("text-anchor", "middle")
        .style("font-size", "12px")
        .style("fill", "#888")
        .text("데이터 없음 (No data)");
    return { svg, g, innerWidth, innerHeight, parentWidth };
}

function showNoDataMessage(chartG, innerWidth, innerHeight, message = "Select data by using filters or brush") {
    chartG.selectAll(".bar").remove();
    chartG.select(".x-axis").selectAll("*").remove();
    chartG.select(".y-axis").selectAll("*").remove();
    chartG.select(".no-data-message").text(message).style("display", "block");
}

function hideNoDataMessage(chartG) {
    chartG.select(".no-data-message").style("display", "none");
}

function clearCumulativeBarFiltersAndVisuals() {
    cumulativeBarFilters = [];
    d3.selectAll(".stat-chart-svg .bar")
        .classed("bar-single-clicked", false)
        .classed("bar-dimmed", false);
}

function updateActiveBarVisuals() {
    d3.selectAll(".stat-chart-svg .bar")
        .classed("bar-single-clicked", false)
        .classed("bar-dimmed", false);

    cumulativeBarFilters.forEach(filter => {
        d3.select(`#${filter.chartId}`).selectAll('.bar').each(function(d_bar) {
            let match = false;
            if (filter.chartType === 'emotion' && d_bar.emotion === filter.barData.emotion) match = true;
            else if (filter.chartType === 'tempo' && d_bar.x0 === filter.barData.x0 && d_bar.x1 === filter.barData.x1) match = true;
            else if (filter.chartType === 'length' && d_bar.x0 === filter.barData.x0 && d_bar.x1 === filter.barData.x1) match = true;
            else if (filter.chartType === 'year' && d_bar.year === filter.barData.year) match = true;

            if (match) {
                d3.select(this).classed("bar-single-clicked", true);
            }
        });
    });
}


function handleBarSingleClick(event, chartType, barDatum, chartId) {
    const clickedFilter = { chartType, barData: barDatum, chartId };
    const existingFilterIndex = cumulativeBarFilters.findIndex(
        f => f.chartType === chartType && JSON.stringify(f.barData) === JSON.stringify(barDatum)
    );

    if (existingFilterIndex > -1) {
        if (existingFilterIndex === cumulativeBarFilters.length - 1) {
            cumulativeBarFilters.pop();
        } else {
            cumulativeBarFilters.splice(existingFilterIndex);
        }
    } else {
        const sameTypeIndex = cumulativeBarFilters.findIndex(f => f.chartType === chartType);
        if (sameTypeIndex > -1) {
            cumulativeBarFilters[sameTypeIndex] = clickedFilter;
            cumulativeBarFilters.splice(sameTypeIndex + 1);
        } else {
            cumulativeBarFilters.push(clickedFilter);
        }
    }

    updateActiveBarVisuals();
    updateScatterPlotVisuals();
    updateStatsCharts(getFilteredDataForStatsUpdate());
}

function getFilteredDataForStatsUpdate() {
    let dataToFilter = allRawData;

    
    dataToFilter = dataToFilter.filter(d => {
        const isEmotionVisible = activeEmotions.size === 0 || activeEmotions.has(d.emotion);
        const songGenres = d.genreArray || [];
        const isGenreVisible = activeGenreTags.size === 0 ||
            Array.from(activeGenreTags).some(filterTag => songGenres.includes(filterTag));
        return isEmotionVisible && isGenreVisible;
    });

    
    cumulativeBarFilters.forEach(filter => {
        dataToFilter = dataToFilter.filter(d => {
            if (filter.chartType === 'emotion') return d.emotion === filter.barData.emotion;
            if (filter.chartType === 'tempo') return d.tempo >= filter.barData.x0 && d.tempo < filter.barData.x1;
            if (filter.chartType === 'length') return d.lengthInSeconds >= filter.barData.x0 && d.lengthInSeconds < filter.barData.x1;
            if (filter.chartType === 'year') return d.releaseYear === filter.barData.year;
            return true;
        });
    });

    
    if (isBrushActive && activeBrushSelection) {
        const [[selX0, selY0], [selX1, selY1]] = activeBrushSelection;
        dataToFilter = dataToFilter.filter(d => {
            const xVal = currentXScale(d.x);
            const yVal = currentYScale(d.y);
            return selX0 <= xVal && xVal <= selX1 && selY0 <= yVal && yVal <= selY1;
        });
    }

    return dataToFilter;
}


function drawEmotionDistributionChart(data) {
    const chartId = "emotion-stat-chart";
    const { g, innerWidth, innerHeight } = setupStatChart(chartId);
    if (!data || data.length === 0) {
        showNoDataMessage(g, innerWidth, innerHeight);
        return;
    }
    hideNoDataMessage(g);

    const emotionCounts = d3.rollup(data, v => v.length, d => d.emotion);
    const emotionData = Array.from(emotionCounts, ([key, value]) => ({ emotion: key, count: value }))
        .sort((a, b) => d3.descending(a.count, b.count));

    const xScale = d3.scaleBand()
        .domain(emotionData.map(d => d.emotion))
        .range([0, innerWidth])
        .padding(0.2);
    const yScale = d3.scaleLinear()
        .domain([0, d3.max(emotionData, d => d.count) || 1])
        .nice()
        .range([innerHeight, 0]);

    g.select(".x-axis")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(xScale))
        .selectAll("text")
        .style("text-anchor", "end")
        .attr("dx", "-.8em")
        .attr("dy", ".15em")
        .attr("transform", "rotate(-45)");

    g.select(".y-axis")
        .call(d3.axisLeft(yScale)
            .ticks(Math.min(5, d3.max(emotionData, d => d.count) || 1))
            .tickFormat(d3.format("d")));

    g.selectAll(".bar")
        .data(emotionData, d => d.emotion)
        .join("rect")
        .attr("class", "bar")
        .attr("x", d => xScale(d.emotion))
        .attr("y", d => yScale(d.count))
        .attr("width", xScale.bandwidth())
        .attr("height", d => innerHeight - yScale(d.count))
        .on("click", (event, d_bar) => handleBarSingleClick(event, 'emotion', d_bar, chartId));
}


function drawTempoDistributionChart(data) {
    const chartId = "tempo-stat-chart";
    const { g, innerWidth, innerHeight } = setupStatChart(chartId);

    const tempos = data.map(d => d.tempo).filter(t => t != null && !isNaN(t));
    if (tempos.length === 0) {
        showNoDataMessage(g, innerWidth, innerHeight);
        return;
    }
    hideNoDataMessage(g);

    const xScale = d3.scaleLinear()
        .domain(d3.extent(tempos))
        .nice()
        .range([0, innerWidth]);

    const histogram = d3.histogram()
        .value(d => d)
        .domain(xScale.domain())
        .thresholds(xScale.ticks(10));

    const bins = histogram(tempos);
    const yScale = d3.scaleLinear()
        .domain([0, d3.max(bins, d => d.length) || 1])
        .nice()
        .range([innerHeight, 0]);

    g.select(".x-axis")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(xScale).ticks(5));
    g.select(".y-axis")
        .call(d3.axisLeft(yScale)
            .ticks(Math.min(5, d3.max(bins, d => d.length) || 1))
            .tickFormat(d3.format("d")));

    g.selectAll(".bar")
        .data(bins)
        .join("rect")
        .attr("class", "bar")
        .attr("x", d => xScale(d.x0) + 1)
        .attr("width", d => Math.max(0, xScale(d.x1) - xScale(d.x0) - 1))
        .attr("y", d => yScale(d.length))
        .attr("height", d => innerHeight - yScale(d.length))
        .on("click", (event, d_bar) =>
            handleBarSingleClick(event, 'tempo', { x0: d_bar.x0, x1: d_bar.x1 }, chartId)
        );
}


function drawLengthDistributionChart(data) {
    const chartId = "length-stat-chart";
    const { g, innerWidth, innerHeight } = setupStatChart(chartId);

    const lengthsInSeconds = data.map(d => d.lengthInSeconds).filter(l => l != null && !isNaN(l));
    if (lengthsInSeconds.length === 0) {
        showNoDataMessage(g, innerWidth, innerHeight);
        return;
    }
    hideNoDataMessage(g);

    const xScale = d3.scaleLinear()
        .domain(d3.extent(lengthsInSeconds))
        .nice()
        .range([0, innerWidth]);

    const histogram = d3.histogram()
        .value(d => d)
        .domain(xScale.domain())
        .thresholds(xScale.ticks(10));

    const bins = histogram(lengthsInSeconds);
    const yScale = d3.scaleLinear()
        .domain([0, d3.max(bins, d => d.length) || 1])
        .nice()
        .range([innerHeight, 0]);

    g.select(".x-axis")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(xScale).ticks(5).tickFormat(d => `${Math.floor(d / 60)}:${String(d % 60).padStart(2, '0')}`));
    g.select(".y-axis")
        .call(d3.axisLeft(yScale)
            .ticks(Math.min(5, d3.max(bins, d => d.length) || 1))
            .tickFormat(d3.format("d")));

    g.selectAll(".bar")
        .data(bins)
        .join("rect")
        .attr("class", "bar")
        .attr("x", d => xScale(d.x0) + 1)
        .attr("width", d => Math.max(0, xScale(d.x1) - xScale(d.x0) - 1))
        .attr("y", d => yScale(d.length))
        .attr("height", d => innerHeight - yScale(d.length))
        .on("click", (event, d_bar) =>
            handleBarSingleClick(event, 'length', { x0: d_bar.x0, x1: d_bar.x1 }, chartId)
        );
}


function drawReleaseYearChart(data) {
    const chartId = "release-year-stat-chart";
    const { g, innerWidth, innerHeight } = setupStatChart(chartId);

    const years = data.map(d => d.releaseYear).filter(y => y != null && !isNaN(y));
    if (years.length === 0) {
        showNoDataMessage(g, innerWidth, innerHeight);
        return;
    }
    hideNoDataMessage(g);

    const yearCounts = d3.rollup(years, v => v.length, d => d);
    const yearData = Array.from(yearCounts, ([key, value]) => ({ year: key, count: value }))
        .sort((a, b) => d3.ascending(a.year, b.year));

    const xScale = d3.scaleBand()
        .domain(yearData.map(d => d.year.toString()))
        .range([0, innerWidth])
        .padding(0.2);
    const yScale = d3.scaleLinear()
        .domain([0, d3.max(yearData, d => d.count) || 1])
        .nice()
        .range([innerHeight, 0]);

    g.select(".x-axis")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(
            d3.axisBottom(xScale)
                .tickValues(xScale.domain().filter((d, i) => !(i % Math.max(1, Math.floor(yearData.length / 5)))))
        )
        .selectAll("text")
        .style("text-anchor", "end")
        .attr("dx", "-.8em")
        .attr("dy", ".15em")
        .attr("transform", "rotate(-45)");

    g.select(".y-axis")
        .call(d3.axisLeft(yScale)
            .ticks(Math.min(5, d3.max(yearData, d => d.count) || 1))
            .tickFormat(d3.format("d")));

    g.selectAll(".bar")
        .data(yearData, d => d.year)
        .join("rect")
        .attr("class", "bar")
        .attr("x", d => xScale(d.year.toString()))
        .attr("y", d => yScale(d.count))
        .attr("width", xScale.bandwidth())
        .attr("height", d => innerHeight - yScale(d.count))
        .on("click", (event, d_bar) =>
            handleBarSingleClick(event, 'year', d_bar, chartId)
        );
}

function updateStatsCharts(dataForCharts) {
    drawEmotionDistributionChart(dataForCharts);
    drawTempoDistributionChart(dataForCharts);
    drawLengthDistributionChart(dataForCharts);
    drawReleaseYearChart(dataForCharts);
    updateActiveBarVisuals();
}

function clearAllStatsCharts() {
    const emptyData = [];
    drawEmotionDistributionChart(emptyData);
    drawTempoDistributionChart(emptyData);
    drawLengthDistributionChart(emptyData);
    drawReleaseYearChart(emptyData);
}

function updateActiveGenreTagsDisplay() {
    const container = d3.select("#active-genre-tags");
    container.html("");
    activeGenreTags.forEach(tag => {
        const tagEl = container.append("span").attr("class", "genre-tag").text(tag);
        tagEl.append("span")
            .attr("class", "remove-genre")
            .attr("data-genre", tag)
            .html("&times;")
            .on("click", function() {
                const genreToRemove = d3.select(this).attr("data-genre");
                activeGenreTags.delete(genreToRemove);
                updateActiveGenreTagsDisplay();
                handleFilterChange();
            });
    });
}

function addGenreFilterTag(genreName) {
    const newGenre = genreName.trim().toLowerCase();
    if (newGenre && !activeGenreTags.has(newGenre)) {
        activeGenreTags.add(newGenre);
        updateActiveGenreTagsDisplay();
        handleFilterChange();
    }
    d3.select("#genre-input").property("value", "");
}

function handleFilterChange() {
    clearCumulativeBarFiltersAndVisuals();
    if (d3.brushSelection(brushGroup.node())) {
        brushGroup.call(brushInstance.move, null);
    } else {
        updateScatterPlotVisuals();
        updateStatsCharts(getFilteredDataForStatsUpdate());
    }
}

function displayAutocompleteSuggestions(inputValue) {
    const autocompleteList = d3.select("#genre-autocomplete-list");
    autocompleteList.html("").style("display", "none");
    if (!inputValue || inputValue.length < 1) return;
    const filteredGenres = allUniqueGenres.filter(
        genre => genre.toLowerCase().startsWith(inputValue.toLowerCase())
    );
    if (filteredGenres.length === 0) return;
    autocompleteList.style("display", "block");
    filteredGenres.forEach(genre => {
        autocompleteList.append("div")
            .text(genre)
            .on("click", function() {
                d3.select("#genre-input").property("value", genre);
                autocompleteList.html("").style("display", "none");
                addGenreFilterTag(genre);
            });
    });
}

function getBaseCircleOpacity(d) {
    const isGenerallyVisible = (activeEmotions.size === 0 || activeEmotions.has(d.emotion)) &&
        (activeGenreTags.size === 0 || Array.from(activeGenreTags).some(tag => d.genreArray.includes(tag)));

    if (!isGenerallyVisible) return VERY_LOW_OPACITY_FOR_FILTERED_OUT;

    let matchesCumulativeBarFilters = true;
    if (cumulativeBarFilters.length > 0) {
        matchesCumulativeBarFilters = cumulativeBarFilters.every(filter => {
            if (filter.chartType === 'emotion') return d.emotion === filter.barData.emotion;
            if (filter.chartType === 'tempo') return d.tempo >= filter.barData.x0 && d.tempo < filter.barData.x1;
            if (filter.chartType === 'length') return d.lengthInSeconds >= filter.barData.x0 && d.lengthInSeconds < filter.barData.x1;
            if (filter.chartType === 'year') return d.releaseYear === filter.barData.year;
            return true;
        });
    }
    if (cumulativeBarFilters.length > 0 && !matchesCumulativeBarFilters) {
        return VERY_LOW_OPACITY_FOR_FILTERED_OUT;
    }

    if (isBrushActive && activeBrushSelection) {
        const [[selX0, selY0], [selX1, selY1]] = activeBrushSelection;
        const xVal = currentXScale(d.x);
        const yVal = currentYScale(d.y);
        const isInsideBrush = selX0 <= xVal && xVal <= selX1 && selY0 <= yVal && yVal <= selY1;

        if (!isInsideBrush) return VERY_LOW_OPACITY_FOR_FILTERED_OUT;
        return CIRCLE_OPACITY_HIGHLIGHTED;
    }

    if (cumulativeBarFilters.length > 0 && matchesCumulativeBarFilters) {
        return CIRCLE_OPACITY_HIGHLIGHTED;
    }

    return CIRCLE_OPACITY_DEFAULT;
}

function updateScatterPlotVisuals() {
    if (!circlesSelection) return;

    circlesSelection.each(function(d) {
        const circle = d3.select(this);
        const baseOpacityConsideringFilters = getBaseCircleOpacity(d);

        let finalOpacity = baseOpacityConsideringFilters;
        let isHighlightedBySearch = false;

        if (currentSearchTerm) {
            const matchesSearchTerm = d.title && d.title.toLowerCase().includes(currentSearchTerm);

            if (baseOpacityConsideringFilters > VERY_LOW_OPACITY_FOR_FILTERED_OUT) {
                if (matchesSearchTerm) {
                    isHighlightedBySearch = true;
                    finalOpacity = baseOpacityConsideringFilters;
                } else {
                    finalOpacity = CIRCLE_OPACITY_DIMMED;
                }
            } else {
                finalOpacity = VERY_LOW_OPACITY_FOR_FILTERED_OUT;
            }
        }

        circle.attr('opacity', finalOpacity);
        circle.attr('r', isHighlightedBySearch ? CIRCLE_RADIUS * 1.8 : CIRCLE_RADIUS);

        if (isHighlightedBySearch) {
            circle.attr('stroke', '#DC143C') 
                .attr('stroke-width', 2.5);
        } else {
            circle.attr('stroke', null)
                .attr('stroke-width', null);
        }
    }).order();

    const searchStatusEl = d3.select("#song-search-status");
    if (currentSearchTerm) {
        const foundAndVisibleSongs = allRawData.filter(d =>
            d.title && d.title.toLowerCase().includes(currentSearchTerm) &&
            getBaseCircleOpacity(d) > VERY_LOW_OPACITY_FOR_FILTERED_OUT
        );

        if (foundAndVisibleSongs.length > 0) {
            circlesSelection.filter(d => foundAndVisibleSongs.includes(d)).raise();
            searchStatusEl
                .text(`Found ${foundAndVisibleSongs.length} song(s)`)
                .style("color", "green");
        } else {
            searchStatusEl
                .text(`'No song found for '${currentSearchTerm}'`)
                .style("color", "#d9534f");
        }
    } else {
        searchStatusEl.text("");
    }
}

function resetSelectionAndZoom() {
    clearCumulativeBarFiltersAndVisuals();
    isBrushActive = false;
    activeBrushSelection = null;

    if (brushGroup && brushInstance && d3.brushSelection(brushGroup.node())) {
        brushGroup.call(brushInstance.move, null);
    } else {
        clearAllStatsCharts();
    }
    activeEmotions.clear();
    updateActiveButtonStates();
    activeGenreTags.clear();
    updateActiveGenreTagsDisplay();
    clearSongSearch();

    if (gScatter && zoomBehavior) {
        gScatter.transition().duration(ZOOM_TRANSITION_DURATION)
            .call(zoomBehavior.transform, d3.zoomIdentity);
    } else {
        updateScatterPlotVisuals();
        updateStatsCharts(getFilteredDataForStatsUpdate());
    }
}

function updateActiveButtonStates() {
    d3.select('#emotion-filters').selectAll('button').each(function() {
        const btn = d3.select(this);
        const emotion = btn.attr('data-emotion');
        if (emotion === 'all') {
            btn.classed('active', activeEmotions.size === 0);
        } else {
            btn.classed('active', activeEmotions.has(emotion));
        }
    });
}

function brushed({ selection, sourceEvent }) {
    if (!circlesSelection) return;

    if (sourceEvent && sourceEvent.type === "start") {
        isBrushActive = true;
        activeBrushSelection = selection;
        clearCumulativeBarFiltersAndVisuals();
        updateScatterPlotVisuals();
        return;
    }

    if (!selection) {
        isBrushActive = false;
        activeBrushSelection = null;
        updateScatterPlotVisuals();
        updateStatsCharts(getFilteredDataForStatsUpdate());
        return;
    }

    isBrushActive = true;
    activeBrushSelection = selection;

    updateScatterPlotVisuals();
    updateStatsCharts(getFilteredDataForStatsUpdate());
}

function zoomed(event) {
    if (!originalXScale || !originalYScale || !xAxisG || !yAxisG || !xAxisGenerator || !yAxisGenerator || !circlesSelection) return;
    const { transform } = event;
    currentXScale = transform.rescaleX(originalXScale);
    currentYScale = transform.rescaleY(originalYScale);
    xAxisG.call(xAxisGenerator.scale(currentXScale));
    yAxisG.call(yAxisGenerator.scale(currentYScale));
    circlesSelection
        .attr('cx', d => currentXScale(d.x))
        .attr('cy', d => currentYScale(d.y));

    clearCumulativeBarFiltersAndVisuals();

    if (d3.brushSelection(brushGroup.node())) {
        isBrushActive = true;
        activeBrushSelection = d3.brushSelection(brushGroup.node());
        // 브러시 줌 겹쳤을 때
        brushed({ selection: activeBrushSelection, sourceEvent: { type: 'zoom' } });
    } else {
        isBrushActive = false;
        activeBrushSelection = null;
        updateScatterPlotVisuals();
        updateStatsCharts(getFilteredDataForStatsUpdate());
    }
}

brushInstance = d3.brush()
    .extent([[0, 0], [scatterInnerWidth, scatterInnerHeight]])
    .on('start brush end', brushed);

scatterPlotSvg.on('dblclick', (event) => {
    if (event.target === scatterPlotSvg.node() ||
        event.target === gScatter.node() ||
        event.target.classList.contains('overlay')
    ) {
        resetSelectionAndZoom();
    }
});

function handleSongSearch() {
    const searchTerm = d3.select("#song-search-input").property("value").trim().toLowerCase();
    currentSearchTerm = searchTerm;
    updateScatterPlotVisuals();
}

function clearSongSearch() {
    d3.select("#song-search-input").property("value", "");
    currentSearchTerm = "";
    d3.select("#song-search-status").text("").style("color", null);
    updateScatterPlotVisuals();
}

const createMockData = () => {
    const mockData = [];
    const emotionsForMock = ["anger", "sadness", "joy", "fear", "love", "surprise"];
    const genres = ["rock", "pop", "electronic", "classical", "jazz", "hip hop", "folk", "metal", "blues", "reggae", "punk", "indie", "alternative"];
    for (let i = 0; i < 200; i++) {
        let numGenres = Math.floor(Math.random() * 3) + 1;
        let songGenres = [];
        for (let j = 0; j < numGenres; j++) {
            songGenres.push(genres[(i + j * 2) % genres.length]);
        }
        mockData.push({
            title: `Song ${i + 1}`,
            artist: `Artist ${ (i % 10) + 1 }`,
            x: Math.random() * 100 - 50,
            y: Math.random() * 100 - 50,
            tempo: Math.random() * 100 + 80,
            genre: songGenres.join(','),
            emotion: emotionsForMock[i % emotionsForMock.length],
            length: `${Math.floor(Math.random() * 3 + 1)}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}`,
            release_date: Math.random() > 0.2 ? (2000 + Math.floor(Math.random() * 24)).toString() : null
        });
    }
    return Promise.resolve(mockData);
};

d3.json('tsne_data.json')
    .catch(error => {
        console.warn("Failed to load 'src/data/tsne_data.json'. Using mock data instead.", error);
        return createMockData();
    })
    .then(data => {
        if (!data || data.length === 0) {
            console.error("Data is empty. Cannot render chart.");
            gScatter.append("text")
                .attr("x", scatterInnerWidth / 2)
                .attr("y", scatterInnerHeight / 2)
                .attr("text-anchor", "middle")
                .text("데이터를 불러오지 못했습니다.");
            clearAllStatsCharts();
            return;
        }
        allRawData = data;
        const tempAllGenres = new Set();
        allRawData.forEach(d => {
            d.x = +d.x;
            d.y = +d.y;
            d.tempo = +d.tempo;
            d.lengthInSeconds = parseLengthToSeconds(d.length);
            d.releaseYear = d.release_date ? parseInt(String(d.release_date).substring(0, 4), 10) : null;
            if (d.releaseYear && isNaN(d.releaseYear)) d.releaseYear = null;
            d.genreArray = d.genre ? d.genre.split(',').map(g => g.trim().toLowerCase()) : [];
            d.genreArray.forEach(g => tempAllGenres.add(g));
        });
        allUniqueGenres = Array.from(tempAllGenres).sort();

        originalXScale = d3.scaleLinear()
            .domain(d3.extent(allRawData, d => d.x))
            .nice()
            .range([0, scatterInnerWidth]);
        originalYScale = d3.scaleLinear()
            .domain(d3.extent(allRawData, d => d.y))
            .nice()
            .range([scatterInnerHeight, 0]);
        currentXScale = originalXScale.copy();
        currentYScale = originalYScale.copy();
        xAxisGenerator = d3.axisBottom(currentXScale).ticks(Math.max(scatterInnerWidth / 100, 2));
        yAxisGenerator = d3.axisLeft(currentYScale).ticks(Math.max(scatterInnerHeight / 70, 2));
        xAxisG = gScatter.append('g')
            .attr('class', 'x-axis')
            .attr('transform', `translate(0,${scatterInnerHeight})`)
            .call(xAxisGenerator);
        yAxisG = gScatter.append('g')
            .attr('class', 'y-axis')
            .call(yAxisGenerator);
        brushGroup = contentGroup.append('g')
            .attr('class', 'brush')
            .call(brushInstance);

        // Emotion 필터 버튼
        const emotionFilterContainer = d3.select('#emotion-filters');
        emotionFilterContainer.append('button')
            .attr('data-emotion', 'all')
            .text('모두 (All)')
            .on('click', function() {
                activeEmotions.clear();
                updateActiveButtonStates();
                handleFilterChange();
            });
        EMOTIONS_LIST.forEach(emotion => {
            emotionFilterContainer.append('button')
                .attr('data-emotion', emotion)
                .text(emotion.charAt(0).toUpperCase() + emotion.slice(1))
                .on('click', function() {
                    const clickedEmotion = d3.select(this).attr('data-emotion');
                    if (activeEmotions.has(clickedEmotion)) {
                        activeEmotions.delete(clickedEmotion);
                    } else {
                        activeEmotions.add(clickedEmotion);
                    }
                    updateActiveButtonStates();
                    handleFilterChange();
                });
        });
        updateActiveButtonStates();

        // Genre 입력
        d3.select("#add-genre-btn").on("click", () => {
            addGenreFilterTag(d3.select("#genre-input").property("value"));
        });
        updateActiveGenreTagsDisplay();

        const genreInputEl = d3.select("#genre-input");
        genreInputEl.on("input", function() {
            displayAutocompleteSuggestions(this.value);
        });
        genreInputEl.on("focus", function() {
            if (this.value) displayAutocompleteSuggestions(this.value);
        });
        genreInputEl.on("blur", function() {
            setTimeout(() => {
                d3.select("#genre-autocomplete-list").html("").style("display", "none");
            }, 150);
        });
        genreInputEl.on("keydown", function(event) {
            if (event.key === "Escape") {
                d3.select("#genre-autocomplete-list").html("").style("display", "none");
            }
        });

        // 노래 검색 
        d3.select("#song-search-btn").on("click", handleSongSearch);
        d3.select("#song-search-input").on("keypress", function(event) {
            if (event.key === "Enter") {
                event.preventDefault();
                handleSongSearch();
            }
        });
        d3.select("#clear-search-btn").on("click", clearSongSearch);

        // 점 그리기
        const emotionsDomain = Array.from(new Set(allRawData.map(d => d.emotion)));
        const colorScale = d3.scaleOrdinal(d3.schemeCategory10)
            .domain(emotionsDomain.length > 0 ? emotionsDomain : EMOTIONS_LIST);

        circlesSelection = contentGroup.selectAll('circle')
            .data(allRawData, d => d.title + d.artist)
            .join('circle')
            .attr('cx', d => currentXScale(d.x))
            .attr('cy', d => currentYScale(d.y))
            .attr('r', CIRCLE_RADIUS)
            .attr('fill', d => colorScale(d.emotion))
            .style('cursor', 'pointer')
            .on('mouseover', function(event, d) {
                const currentBaseOpacity = getBaseCircleOpacity(d);
                const isPotentiallyVisibleDueToSearch = currentSearchTerm &&
                    d.title && d.title.toLowerCase().includes(currentSearchTerm);
                const actualOpacity = parseFloat(d3.select(this).attr('opacity'));

                if (!(
                    (isPotentiallyVisibleDueToSearch && actualOpacity > VERY_LOW_OPACITY_FOR_FILTERED_OUT) ||
                    (!currentSearchTerm && currentBaseOpacity > VERY_LOW_OPACITY_FOR_FILTERED_OUT && currentBaseOpacity >= CIRCLE_OPACITY_DIMMED) ||
                    (currentSearchTerm && !isPotentiallyVisibleDueToSearch && actualOpacity >= CIRCLE_OPACITY_DIMMED)
                )) {
                    d3.select('#tooltip').style('opacity', 0);
                    return;
                }

                const isHighlightedBySearch = currentSearchTerm &&
                    d.title && d.title.toLowerCase().includes(currentSearchTerm) &&
                    actualOpacity > CIRCLE_OPACITY_DIMMED * 0.9;

                if (!isHighlightedBySearch) {
                    d3.select(this).attr('stroke', 'black').attr('stroke-width', 1.5);
                }
                d3.select(this).raise();

                d3.select('#tooltip')
                    .style('opacity', 1)
                    .html(
                        `<strong>${d.title}</strong><br/>
                         ${d.artist}<br/>
                         Emotion: ${d.emotion || 'N/A'}<br/>
                         Tempo: ${d.tempo ? d.tempo.toFixed(1) : 'N/A'}<br/>
                         Genre: ${d.genre || 'N/A'}`
                    )
                    .style('left', (event.pageX + TOOLTIP_OFFSET_X) + 'px')
                    .style('top', (event.pageY + TOOLTIP_OFFSET_Y) + 'px');
            })
            .on('mousemove', function(event, d) {
                const actualOpacity = parseFloat(d3.select(this).attr('opacity'));
                const isHighlightedBySearch = currentSearchTerm &&
                    d.title && d.title.toLowerCase().includes(currentSearchTerm) &&
                    actualOpacity > CIRCLE_OPACITY_DIMMED * 0.9;
                if (!(
                    (isHighlightedBySearch && actualOpacity > VERY_LOW_OPACITY_FOR_FILTERED_OUT) ||
                    (!currentSearchTerm && getBaseCircleOpacity(d) > VERY_LOW_OPACITY_FOR_FILTERED_OUT && getBaseCircleOpacity(d) >= CIRCLE_OPACITY_DIMMED) ||
                    (currentSearchTerm && !isHighlightedBySearch && actualOpacity >= CIRCLE_OPACITY_DIMMED)
                )) {
                    return;
                }
                d3.select('#tooltip')
                    .style('left', (event.pageX + TOOLTIP_OFFSET_X) + 'px')
                    .style('top', (event.pageY + TOOLTIP_OFFSET_Y) + 'px');
            })
            .on('mouseout', function(event, d) {
                const actualOpacity = parseFloat(d3.select(this).attr('opacity'));
                const isHighlightedBySearch = currentSearchTerm &&
                    d.title && d.title.toLowerCase().includes(currentSearchTerm) &&
                    actualOpacity > CIRCLE_OPACITY_DIMMED * 0.9;
                if (!isHighlightedBySearch) {
                    d3.select(this).attr('stroke', null).attr('stroke-width', null);
                }
                d3.select('#tooltip').style('opacity', 0);
            });

        updateScatterPlotVisuals();
        clearAllStatsCharts();

        zoomBehavior = d3.zoom()
            .scaleExtent(ZOOM_SCALE_EXTENT)
            .extent([[0, 0], [scatterInnerWidth, scatterInnerHeight]])
            .translateExtent([[0, 0], [scatterInnerWidth, scatterInnerHeight]])
            .filter(event => {
                if (event.type === 'wheel') return true;
                if (event.type === 'mousedown' || event.type === 'touchstart') {
                    return event.ctrlKey || event.metaKey;
                }
                return false;
            })
            .on('zoom', zoomed);

        gScatter.call(zoomBehavior).on("dblclick.zoom", null);
    })
    .catch(error => {
        console.error('Error processing data or rendering chart:', error);
        gScatter.append("text")
            .attr("x", scatterInnerWidth / 2)
            .attr("y", scatterInnerHeight / 2)
            .attr("text-anchor", "middle")
            .text("Error in loading or processing data.");
        clearAllStatsCharts();
    });
