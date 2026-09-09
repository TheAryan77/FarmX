"use client";

import { useMemo } from "react";
import type { Shipment } from "@fasalx/types";
import { MapContainer, CircleMarker, Polyline, Popup, TileLayer, Tooltip } from "react-leaflet";

import "leaflet/dist/leaflet.css";

/**
 * The pickup route on a map.
 *
 * Leaflet with OpenStreetMap tiles rather than Mapbox: no API key means
 * nothing to expire or rate-limit on demo day, which for a map that exists to
 * make a route legible is the right trade.
 *
 * The lines are straight between stops, not road geometry — drawing a road
 * polyline would need a routing provider, and the distances behind the cost
 * are great-circle × a circuity factor anyway. The card next to this map says
 * so, rather than letting the picture imply more precision than there is.
 *
 * Markers are CircleMarkers, not the default Leaflet pin, because the default
 * pin loads its icon from a bundler-relative URL that breaks under Next.
 */

/** One colour per truck, so a multi-vehicle plan is readable. */
const TRUCK_COLOURS = ["#2f6f3e", "#b4791f", "#2a5d8f", "#8f2a6b", "#5d5d2a"];

export function RouteMap({ shipment }: { shipment: Shipment }) {
  // Derived inside the memos as well as here, so `shipment` is genuinely the
  // only dependency rather than one that merely looks sufficient.
  const destination: [number, number] = [shipment.destinationLat, shipment.destinationLng];

  const routes = useMemo(() => {
    const depot: [number, number] = [shipment.destinationLat, shipment.destinationLng];
    return shipment.vehicles.map((vehicle) => {
      const stops = vehicle.stopSequences
        .map((sequence) => shipment.stops.find((stop) => stop.sequence === sequence))
        .filter((stop): stop is Shipment["stops"][number] => stop !== undefined);

      // Depot → each farm in visit order → back to the depot loaded.
      const path: [number, number][] = [
        depot,
        ...stops.map((stop) => [stop.lat, stop.lng] as [number, number]),
        depot,
      ];
      return { vehicle, stops, path };
    });
  }, [shipment]);

  const bounds = useMemo(() => {
    const points: [number, number][] = [
      [shipment.destinationLat, shipment.destinationLng],
      ...shipment.stops.map((stop) => [stop.lat, stop.lng] as [number, number]),
    ];
    const lats = points.map(([lat]) => lat);
    const lngs = points.map(([, lng]) => lng);
    return [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ] as [[number, number], [number, number]];
  }, [shipment]);

  return (
    <div className="h-96 w-full overflow-hidden rounded-md border">
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [36, 36] }}
        scrollWheelZoom={false}
        className="h-full w-full"
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
          maxZoom={18}
        />

        {routes.map(({ vehicle, path }, index) => (
          <Polyline
            key={vehicle.vehicleNumber}
            positions={path}
            pathOptions={{
              color: TRUCK_COLOURS[index % TRUCK_COLOURS.length],
              weight: 3,
              opacity: 0.75,
              dashArray: "6 6",
            }}
          />
        ))}

        {routes.map(({ vehicle, stops }, index) =>
          stops.map((stop) => (
            <CircleMarker
              key={stop.id}
              center={[stop.lat, stop.lng]}
              radius={13}
              pathOptions={{
                color: "#ffffff",
                weight: 2,
                fillColor: TRUCK_COLOURS[index % TRUCK_COLOURS.length],
                fillOpacity: 1,
              }}
            >
              <Tooltip permanent direction="center" className="fasalx-stop-label">
                {stop.sequence}
              </Tooltip>
              <Popup>
                <strong>{stop.farmer.name}</strong>
                <br />
                {stop.farmer.village} · {stop.quantityQuintals}Q
                <br />
                Truck {vehicle.vehicleNumber} · stop {stop.sequence}
              </Popup>
            </CircleMarker>
          )),
        )}

        <CircleMarker
          center={destination}
          radius={15}
          pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#111111", fillOpacity: 1 }}
        >
          <Tooltip permanent direction="center" className="fasalx-stop-label">
            ★
          </Tooltip>
          <Popup>
            <strong>{shipment.destinationLabel}</strong>
            <br />
            Delivery destination
          </Popup>
        </CircleMarker>
      </MapContainer>
    </div>
  );
}
