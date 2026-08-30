"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// Fix for the default marker icon issue
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
});

const Map = ({ latitude, longitude, locale = "it" }) => {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const map = L.map(container).setView([latitude, longitude], 16);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    L.marker([latitude, longitude])
      .addTo(map)
      .bindPopup(locale === "en" ? "Find us here." : "Ci trovi qui.");

    return () => map.remove();
  }, [latitude, locale, longitude]);

  return (
    <div
      ref={containerRef}
      style={{
        height: "100%",
        width: "100%",
        marginTop: "2rem",
        paddingBottom: "15rem",
        zIndex: 5,
        position: "relative",
      }}
    />
  );
};

export default Map;
