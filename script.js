let map = null;
let routeLayer = null;
let startMarker = null;
let destinationMarker = null;
let locationWatchId = null;
let liveMarker = null;
let accuracyCircle = null;

let routeHistory = JSON.parse(
    localStorage.getItem("routeHistory") || "[]"
);

document.addEventListener("DOMContentLoaded", function() {

    map = L.map("map", {
        zoomControl: true
    }).setView([25.5, 92.0], 6);

    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap contributors"
        }
    ).addTo(map);

    displayAIRoutes();

    setTimeout(function() {
        map.invalidateSize();
    }, 300);

});

async function findRoute() {

    const startInput = document.getElementById("start");
    const destinationInput = document.getElementById("destination");
    const result = document.getElementById("routeResult");

    if (!startInput || !destinationInput || !result) {
        return;
    }

    const start = startInput.value.trim();
    const destination = destinationInput.value.trim();

    if (!start || !destination) {

        result.innerHTML = `
            <strong>⚠️ Missing Location</strong>
            <br><br>
            Please enter both starting location and destination.
        `;

        return;
    }

    if (
        start.toLowerCase() ===
        destination.toLowerCase()
    ) {

        result.innerHTML = `
            <strong>⚠️ Invalid Route</strong>
            <br><br>
            Starting location and destination cannot be the same.
        `;

        return;
    }

    result.innerHTML = `
        <div class="route-analysis">
            <h3>🤖 AI is finding available routes...</h3>
            <p>
                ${escapeHTML(start)}
                →
                ${escapeHTML(destination)}
            </p>
        </div>
    `;

    try {

        const startLocation =
            await getCoordinates(start);

        const destinationLocation =
            await getCoordinates(destination);

        if (!startLocation) {

            result.innerHTML = `
                <strong>❌ Starting Location Not Found</strong>
                <br><br>
                Could not find:
                ${escapeHTML(start)}
                <br><br>
                Try entering a city name such as Salem, Chennai, Guwahati or Shillong.
            `;

            return;
        }

        if (!destinationLocation) {

            result.innerHTML = `
                <strong>❌ Destination Not Found</strong>
                <br><br>
                Could not find:
                ${escapeHTML(destination)}
                <br><br>
                Try entering a valid city or place name.
            `;

            return;
        }

        const routingURL =
            "https://router.project-osrm.org/route/v1/driving/" +
            startLocation.lon +
            "," +
            startLocation.lat +
            ";" +
            destinationLocation.lon +
            "," +
            destinationLocation.lat +
            "?overview=full&geometries=geojson&alternatives=true";

        const response =
            await fetch(routingURL);

        if (!response.ok) {
            throw new Error(
                "Routing server unavailable"
            );
        }

        const routeData =
            await response.json();

        if (
            routeData.code !== "Ok" ||
            !routeData.routes ||
            routeData.routes.length === 0
        ) {

            throw new Error(
                "No driving route found"
            );
        }

        const routes =
            routeData.routes;

        clearRouteMap();

        routeLayer =
            L.featureGroup().addTo(map);

        const routeResults = [];

        routes.forEach(function(route, index) {

            const distanceKm =
                route.distance / 1000;

            const timeMinutes =
                Math.round(
                    route.duration / 60
                );

            const risk =
                calculateRisk(distanceKm);

            routeResults.push({
                route: route,
                number: index + 1,
                distance: distanceKm,
                time: timeMinutes,
                eta: formatTime(timeMinutes),
                risk: risk
            });

        });

        routeResults.sort(function(a, b) {
            return a.time - b.time;
        });

        routeResults.forEach(function(item, index) {

            let routeColor = "#facc15";

            let routeWeight = 6;

            if (index === 0) {
                routeColor = "#22c55e";
                routeWeight = 8;
            }

            if (item.risk.level === "High") {
                routeColor = "#ef4444";
            }

            const routeLine =
                L.geoJSON(
                    item.route.geometry,
                    {
                        style: {
                            color: routeColor,
                            weight: routeWeight,
                            opacity: 0.9
                        }
                    }
                );

            routeLine.bindPopup(
                "Route " +
                item.number +
                "<br>Distance: " +
                item.distance.toFixed(1) +
                " km<br>ETA: " +
                item.eta +
                "<br>Risk: " +
                item.risk.level
            );

            routeLine.addTo(routeLayer);

        });

        startMarker =
            L.marker([
                startLocation.lat,
                startLocation.lon
            ])
                .addTo(map)
                .bindPopup(
                    "📍 Starting Location<br>" +
                    escapeHTML(start)
                );

        destinationMarker =
            L.marker([
                destinationLocation.lat,
                destinationLocation.lon
            ])
                .addTo(map)
                .bindPopup(
                    "🏁 Destination<br>" +
                    escapeHTML(destination)
                );

        startMarker.openPopup();

        routeLayer.addLayer(startMarker);
        routeLayer.addLayer(destinationMarker);

        if (
            routeLayer &&
            typeof routeLayer.getBounds === "function"
        ) {

            const bounds =
                routeLayer.getBounds();

            if (bounds.isValid()) {

                map.fitBounds(
                    bounds,
                    {
                        padding: [40, 40]
                    }
                );

            }

        }

        const bestRoute =
            routeResults[0];

        addRouteToAI(
            start,
            destination,
            bestRoute.distance.toFixed(1),
            bestRoute.eta,
            bestRoute.risk
        );

        updateRiskAnalysis(
            bestRoute.risk
        );

        displayRouteResults(
            start,
            destination,
            routeResults
        );

    } catch (error) {

        console.error(
            "Route error:",
            error
        );

        result.innerHTML = `
            <div class="route-analysis">
                <strong>❌ Route Calculation Failed</strong>
                <br><br>
                ${escapeHTML(error.message)}
                <br><br>
                Please check your internet connection and try again.
            </div>
        `;

    }

}

async function getCoordinates(place) {

    const url =
        "https://nominatim.openstreetmap.org/search" +
        "?format=json" +
        "&limit=1" +
        "&countrycodes=in" +
        "&q=" +
        encodeURIComponent(place);

    const response =
        await fetch(url, {
            headers: {
                "Accept": "application/json"
            }
        });

    if (!response.ok) {
        throw new Error(
            "Location search failed"
        );
    }

    const data =
        await response.json();

    if (
        !data ||
        data.length === 0
    ) {
        return null;
    }

    const latitude =
        parseFloat(data[0].lat);

    const longitude =
        parseFloat(data[0].lon);

    if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
    ) {
        return null;
    }

    return {
        lat: latitude,
        lon: longitude
    };

}

function displayRouteResults(
    start,
    destination,
    routeResults
) {

    const result =
        document.getElementById(
            "routeResult"
        );

    if (!result) {
        return;
    }

    const bestRoute =
        routeResults[0];

    result.innerHTML = `
        <div class="route-analysis">

            <h3>🤖 AI Route Recommendations</h3>

            <p>
                🚚 <strong>Route:</strong>
                ${escapeHTML(start)}
                →
                ${escapeHTML(destination)}
            </p>

            <p>
                🔎 <strong>
                    ${routeResults.length}
                </strong>
                available route
                ${routeResults.length !== 1 ? "s" : ""}
                found
            </p>

            <hr>

            ${routeResults.map(function(item, index) {

                let status;

                if (index === 0) {
                    status = "Recommended";
                } else if (
                    item.risk.level === "High"
                ) {
                    status = "Avoid";
                } else {
                    status = "Alternative";
                }

                return `
                    <div class="ai-route-option">

                        <h4>
                            ${
                                index === 0
                                    ? "⭐"
                                    : "🛣️"
                            }
                            Route ${index + 1}
                            ${
                                index === 0
                                    ? " — AI Recommended"
                                    : ""
                            }
                        </h4>

                        <p>
                            📏 Distance:
                            <strong>
                                ${item.distance.toFixed(1)}
                                km
                            </strong>
                        </p>

                        <p>
                            ⏱️ ETA:
                            <strong>
                                ${item.eta}
                            </strong>
                        </p>

                        <p>
                            ${item.risk.icon}
                            <strong>Risk:</strong>
                            ${item.risk.level}
                            (${item.risk.percent}%)
                        </p>

                        <p>
                            <strong>Status:</strong>
                            ${status}
                        </p>

                    </div>
                `;

            }).join("")}

            <hr>

            <p>
                🤖 <strong>AI Recommendation:</strong>
                Route ${bestRoute.number} is currently
                the best available route based on
                travel time and calculated risk.
            </p>

        </div>
    `;

}

function clearRouteMap() {

    if (routeLayer) {

        map.removeLayer(
            routeLayer
        );

        routeLayer = null;

    }

    if (startMarker) {

        map.removeLayer(
            startMarker
        );

        startMarker = null;

    }

    if (destinationMarker) {

        map.removeLayer(
            destinationMarker
        );

        destinationMarker = null;

    }

}

function formatTime(minutes) {

    const hours =
        Math.floor(minutes / 60);

    const remainingMinutes =
        minutes % 60;

    if (hours === 0) {

        return (
            remainingMinutes +
            " minutes"
        );

    }

    if (remainingMinutes === 0) {

        return (
            hours +
            " hour" +
            (hours !== 1 ? "s" : "")
        );

    }

    return (
        hours +
        " hour" +
        (hours !== 1 ? "s" : "") +
        " " +
        remainingMinutes +
        " minute" +
        (remainingMinutes !== 1 ? "s" : "")
    );

}

function calculateRisk(distanceKm) {

    if (distanceKm > 500) {

        return {
            level: "High",
            icon: "🔴",
            percent: 78,
            status: "Avoid",
            message:
                "Long-distance route. Monitor weather, road and terrain conditions."
        };

    }

    if (distanceKm > 250) {

        return {
            level: "Moderate",
            icon: "🟡",
            percent: 46,
            status: "Alternative",
            message:
                "Moderate-distance route. Monitor road and weather conditions."
        };

    }

    return {
        level: "Low",
        icon: "🟢",
        percent: 24,
        status: "Recommended",
        message:
            "Short-distance route. Continue monitoring live road conditions."
    };

}

function addRouteToAI(
    start,
    destination,
    distance,
    eta,
    risk
) {

    const route = {
        start: start,
        destination: destination,
        distance: distance,
        eta: eta,
        risk: risk.percent,
        status: risk.status
    };

    routeHistory =
        routeHistory.filter(function(item) {

            return !(
                item.start.toLowerCase() ===
                start.toLowerCase() &&
                item.destination.toLowerCase() ===
                destination.toLowerCase()
            );

        });

    routeHistory.unshift(route);

    routeHistory =
        routeHistory.slice(0, 5);

    localStorage.setItem(
        "routeHistory",
        JSON.stringify(routeHistory)
    );

    displayAIRoutes();

}

function displayAIRoutes() {

    const table =
        document.getElementById(
            "aiRoutesTable"
        );

    if (!table) {
        return;
    }

    table.innerHTML = "";

    routeHistory.forEach(
        function(route, index) {

            const row =
                document.createElement(
                    "div"
                );

            row.className =
                "route-row";

            row.innerHTML = `
                <span>
                    ${escapeHTML(route.start)}
                    →
                    ${escapeHTML(route.destination)}
                    ${
                        index === 0
                            ? " ⭐ Current"
                            : ""
                    }
                </span>

                <span>
                    ${escapeHTML(route.distance)}
                    km
                </span>

                <span>
                    ${escapeHTML(route.eta)}
                </span>

                <strong>
                    ${route.risk}%
                </strong>

                <strong>
                    ${escapeHTML(route.status)}
                </strong>
            `;

            table.appendChild(row);

        }
    );

}

function updateRiskAnalysis(risk) {

    const riskScore =
        document.querySelector(
            ".risk-score strong"
        );

    const riskTitle =
        document.querySelector(
            ".risk-score h3"
        );

    const riskLevel =
        document.querySelector(
            ".risk-score p"
        );

    if (riskScore) {

        riskScore.textContent =
            risk.percent + "%";

    }

    if (riskTitle) {

        riskTitle.textContent =
            "Current Route Risk";

    }

    if (riskLevel) {

        riskLevel.textContent =
            risk.level + " Risk";

    }

    if (riskScore) {

        if (risk.level === "High") {
            riskScore.style.color =
                "#ef4444";
        } else if (
            risk.level === "Moderate"
        ) {
            riskScore.style.color =
                "#eab308";
        } else {
            riskScore.style.color =
                "#16a34a";
        }

    }

}

function startLiveLocation() {

    const status =
        document.getElementById(
            "locationStatus"
        );

    if (!status) {
        return;
    }

    if (!navigator.geolocation) {

        status.innerHTML =
            "❌ Geolocation is not supported.";

        return;

    }

    if (locationWatchId !== null) {

        status.innerHTML =
            "🟢 Live Location is already active.";

        return;

    }

    status.innerHTML =
        "📡 Getting live location...";

    locationWatchId =
        navigator.geolocation.watchPosition(

            function(position) {

                const latitude =
                    position.coords.latitude;

                const longitude =
                    position.coords.longitude;

                const accuracy =
                    position.coords.accuracy;

                if (!liveMarker) {

                    liveMarker =
                        L.marker([
                            latitude,
                            longitude
                        ])
                            .addTo(map)
                            .bindPopup(
                                "📍 Your Live Location"
                            );

                } else {

                    liveMarker.setLatLng([
                        latitude,
                        longitude
                    ]);

                }

                if (!accuracyCircle) {

                    accuracyCircle =
                        L.circle(
                            [
                                latitude,
                                longitude
                            ],
                            {
                                radius: accuracy
                            }
                        ).addTo(map);

                } else {

                    accuracyCircle.setLatLng([
                        latitude,
                        longitude
                    ]);

                    accuracyCircle.setRadius(
                        accuracy
                    );

                }

                map.setView(
                    [
                        latitude,
                        longitude
                    ],
                    16
                );

                status.innerHTML = `
                    🟢 <strong>
                        Live Location Active
                    </strong>
                    <br><br>
                    📍 Latitude:
                    ${latitude.toFixed(6)}
                    <br>
                    📍 Longitude:
                    ${longitude.toFixed(6)}
                    <br>
                    🎯 Accuracy:
                    ${Math.round(accuracy)} m
                `;

                const latElement =
                    document.getElementById(
                        "latitude"
                    );

                const lonElement =
                    document.getElementById(
                        "longitude"
                    );

                const accuracyElement =
                    document.getElementById(
                        "accuracy"
                    );

                if (latElement) {

                    latElement.textContent =
                        latitude.toFixed(6);

                }

                if (lonElement) {

                    lonElement.textContent =
                        longitude.toFixed(6);

                }

                if (accuracyElement) {

                    accuracyElement.textContent =
                        Math.round(accuracy) +
                        " m";

                }

            },

            function(error) {

                console.error(
                    "GPS Error:",
                    error
                );

                if (
                    error.code ===
                    error.PERMISSION_DENIED
                ) {

                    status.innerHTML =
                        "❌ Location permission denied. Please allow location access.";

                } else if (
                    error.code ===
                    error.POSITION_UNAVAILABLE
                ) {

                    status.innerHTML =
                        "❌ Location information unavailable.";

                } else if (
                    error.code ===
                    error.TIMEOUT
                ) {

                    status.innerHTML =
                        "❌ GPS request timed out. Try again.";

                } else {

                    status.innerHTML =
                        "❌ Unable to get live location.";

                }

            },

            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 15000
            }

        );

}

function stopLiveLocation() {

    if (
        locationWatchId !== null
    ) {

        navigator.geolocation.clearWatch(
            locationWatchId
        );

        locationWatchId = null;

    }

    const status =
        document.getElementById(
            "locationStatus"
        );

    if (status) {

        status.innerHTML =
            "⏹ Live Location Stopped.";

    }

}

function openDetails(type) {

    const modal =
        document.getElementById(
            "detailsModal"
        );

    const title =
        document.getElementById(
            "modalTitle"
        );

    const body =
        document.getElementById(
            "modalBody"
        );

    if (
        !modal ||
        !title ||
        !body
    ) {
        return;
    }

    modal.style.display =
        "flex";

    if (type === "vehicles") {

        title.textContent =
            "🚚 Active Vehicles";

        body.innerHTML = `
            <div class="detail-card">
                <strong>Active Vehicles</strong>
                <span>128</span>
            </div>

            <div class="detail-card">
                <strong>Currently Moving</strong>
                <span>112</span>
            </div>

            <div class="detail-card">
                <strong>Delayed</strong>
                <span>12</span>
            </div>

            <div class="detail-card">
                <strong>Offline</strong>
                <span>4</span>
            </div>
        `;

    } else if (type === "deliveries") {

        title.textContent =
            "📦 Deliveries";

        body.innerHTML = `
            <div class="detail-card">
                <strong>Total Deliveries</strong>
                <span>342</span>
            </div>

            <div class="detail-card">
                <strong>In Transit</strong>
                <span>218</span>
            </div>

            <div class="detail-card">
                <strong>Pending</strong>
                <span>89</span>
            </div>

            <div class="detail-card">
                <strong>Delayed</strong>
                <span>35</span>
            </div>
        `;

    } else if (type === "risk") {

        title.textContent =
            "⚠️ High Risk Routes";

        body.innerHTML = `
            <div class="detail-card">
                <strong>High Risk Routes</strong>
                <span>17</span>
            </div>

            <div class="detail-card">
                <strong>Risk Monitoring</strong>
                <span>Active</span>
            </div>

            <p>
                🤖 Risk analysis considers
                distance, terrain, weather,
                traffic and road conditions.
            </p>
        `;

    } else if (type === "blockages") {

        title.textContent =
            "🚧 Road Blockages";

        body.innerHTML = `
            <div class="detail-card">
                <strong>NH-2</strong>
                <span>Blocked</span>
            </div>

            <div class="detail-card">
                <strong>NH-6</strong>
                <span>Blocked</span>
            </div>

            <div class="detail-card">
                <strong>SH-12</strong>
                <span>Partial</span>
            </div>

            <p>
                🚧 Total Road Blockages:
                <strong>8</strong>
            </p>
        `;

    }

}

function closeDetails() {

    const modal =
        document.getElementById(
            "detailsModal"
        );

    if (modal) {

        modal.style.display =
            "none";

    }

}

window.addEventListener(
    "click",
    function(event) {

        const modal =
            document.getElementById(
                "detailsModal"
            );

        if (
            modal &&
            event.target === modal
        ) {

            modal.style.display =
                "none";

        }

    }
);

function showSection(sectionId) {

    const targets = {

        dashboard:
            ".header",

        routes:
            ".route-section",

        vehicles:
            "#vehicles",

        deliveries:
            "#deliveries",

        alerts:
            "#alerts",

        analytics:
            "#analytics"

    };

    if (sectionId === "settings") {

        alert(
            "⚙️ Settings\n\nDashboard settings can be configured here."
        );

        return;

    }

    if (sectionId === "routes") {

        const target =
            document.querySelector(
                targets.routes
            );

        if (target) {

            target.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });

            setTimeout(
                function() {

                    if (map) {
                        map.invalidateSize();
                    }

                },
                500
            );

        }

        return;

    }

    const target =
        document.querySelector(
            targets[sectionId]
        );

    if (target) {

        target.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

    }

}

function logout() {

    alert(
        "🚪 Logout selected."
    );

}

function escapeHTML(text) {

    return String(text)
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );

}
function openMonitoring(type) {

    const result = document.getElementById("monitorResult");

    if (!result) {
        return;
    }

    if (type === "weather") {

        result.innerHTML = `
            <h3>🌦️ Weather Monitoring</h3>

            <div class="monitor-status">
                <span>🌡️ Temperature</span>
                <strong>24°C</strong>
            </div>

            <div class="monitor-status">
                <span>🌧️ Rain Condition</span>
                <strong class="monitor-warning">
                    Moderate
                </strong>
            </div>

            <div class="monitor-status">
                <span>☁️ Weather</span>
                <strong>Cloudy</strong>
            </div>

            <div class="monitor-status">
                <span>🤖 AI Impact</span>
                <strong class="monitor-warning">
                    Moderate Risk
                </strong>
            </div>

            <p>
                ⚠️ Rain and poor visibility may affect
                vehicle movement.
            </p>
        `;

        return;
    }

    if (type === "road") {

        result.innerHTML = `
            <h3>🚧 Road Condition Monitoring</h3>

            <div class="monitor-status">
                <span>🛣️ Road Surface</span>
                <strong class="monitor-good">
                    Good
                </strong>
            </div>

            <div class="monitor-status">
                <span>🚧 Road Blockage</span>
                <strong class="monitor-warning">
                    2 Alerts
                </strong>
            </div>

            <div class="monitor-status">
                <span>🔧 Maintenance</span>
                <strong>Normal</strong>
            </div>

            <div class="monitor-status">
                <span>🤖 AI Impact</span>
                <strong class="monitor-warning">
                    Moderate Risk
                </strong>
            </div>

            <p>
                ⚠️ Some road sections require monitoring
                before vehicle movement.
            </p>
        `;

        return;
    }

    if (type === "traffic") {

        result.innerHTML = `
            <h3>🚦 Traffic Monitoring</h3>

            <div class="monitor-status">
                <span>🚗 Traffic Level</span>
                <strong class="monitor-warning">
                    Moderate
                </strong>
            </div>

            <div class="monitor-status">
                <span>🛣️ Congestion</span>
                <strong>
                    38%
                </strong>
            </div>

            <div class="monitor-status">
                <span>⏱️ Delay</span>
                <strong>
                    18 minutes
                </strong>
            </div>

            <div class="monitor-status">
                <span>🤖 AI Impact</span>
                <strong class="monitor-warning">
                    Alternative Route
                </strong>
            </div>

            <p>
                ⚠️ Traffic congestion may increase
                travel time.
            </p>
        `;

        return;
    }

    if (type === "terrain") {

        result.innerHTML = `
            <h3>⛰️ Terrain Monitoring</h3>

            <div class="monitor-status">
                <span>🏔️ Terrain Type</span>
                <strong>
                    Hilly
                </strong>
            </div>

            <div class="monitor-status">
                <span>📐 Terrain Difficulty</span>
                <strong class="monitor-warning">
                    Moderate
                </strong>
            </div>

            <div class="monitor-status">
                <span>⛰️ Slope Risk</span>
                <strong class="monitor-warning">
                    42%
                </strong>
            </div>

            <div class="monitor-status">
                <span>🤖 AI Impact</span>
                <strong class="monitor-warning">
                    Moderate Risk
                </strong>
            </div>

            <p>
                ⚠️ Hilly terrain may affect vehicle
                speed and route accessibility.
            </p>
        `;

        return;
    }
}