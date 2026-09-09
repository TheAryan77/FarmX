"""Pickup route optimisation for aggregated orders.

An aggregated order means collecting from several farms and delivering to one
buyer, which is a capacitated vehicle routing problem: visit every farm, do
not exceed a truck's capacity, minimise distance travelled.

CLAUDE.md: this service is stateless. It receives pickup points and returns a
plan. No database, no persistence.

Honesty notes, because logistics savings are easy to overstate:
  - distances here are great-circle, then multiplied by a road-circuity factor
    to approximate the road network. Both figures are returned so nobody has to
    guess which one a cost came from.
  - the ₹/km rates are named constants, documented as illustrative pilot
    figures rather than quoted freight rates.
  - the naive baseline is a real alternative plan (visit farms in listed order
    with the same vehicles), costed the same way, so the stated saving is a
    comparison and not a claim.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from ortools.constraint_solver import pywrapcp, routing_enums_pb2

EARTH_RADIUS_KM = 6371.0

#: Straight-line distance understates road distance. 1.35 is a mid-range
#: circuity factor for Indian district road networks; it is an approximation,
#: labelled as such everywhere it surfaces, not a routed distance.
ROAD_CIRCUITY_FACTOR = 1.35

@dataclass(frozen=True)
class VehicleClass:
    """A vehicle option: capacity in quintals, rate in whole rupees per km."""

    key: str
    label: str
    capacity_quintals: float
    rupees_per_km: int


#: Illustrative pilot freight rates for Haryana district haulage. Named
#: constants rather than magic numbers so the cost model can be argued with.


VEHICLE_CLASSES: tuple[VehicleClass, ...] = (
    VehicleClass("tractor_trolley", "Tractor trolley", 60, 28),
    VehicleClass("lcv", "Light commercial vehicle", 100, 38),
    VehicleClass("truck_6w", "6-wheel truck", 200, 52),
    VehicleClass("multi_axle", "Multi-axle truck", 400, 70),
)

#: More vehicles than this for one order is not a plan anyone would run.
MAX_VEHICLES = 8

#: OR-Tools works in integers; metres give ample precision for road distances.
METRES_PER_KM = 1000


def haversine_km(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    """Great-circle distance in km. Matches the API's own haversine."""
    d_lat = math.radians(b_lat - a_lat)
    d_lng = math.radians(b_lng - a_lng)
    h = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(a_lat)) * math.cos(math.radians(b_lat)) * math.sin(d_lng / 2) ** 2
    )
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(h))


def road_km(straight_km: float) -> float:
    return straight_km * ROAD_CIRCUITY_FACTOR


def _matrix(points: list[dict]) -> list[list[int]]:
    """Symmetric distance matrix in metres of estimated road distance."""
    size = len(points)
    matrix = [[0] * size for _ in range(size)]
    for i in range(size):
        for j in range(i + 1, size):
            km = road_km(
                haversine_km(points[i]["lat"], points[i]["lng"], points[j]["lat"], points[j]["lng"])
            )
            metres = int(round(km * METRES_PER_KM))
            matrix[i][j] = metres
            matrix[j][i] = metres
    return matrix


def _solve_cvrp(
    matrix: list[list[int]],
    demands: list[float],
    vehicle_count: int,
    capacity: float,
) -> list[list[int]] | None:
    """Returns one ordered node list per used vehicle, or None if infeasible.

    Node 0 is the destination and acts as the depot: vehicles leave it empty,
    collect from the farms, and return loaded.
    """
    manager = pywrapcp.RoutingIndexManager(len(matrix), vehicle_count, 0)
    routing = pywrapcp.RoutingModel(manager)

    def distance(from_index: int, to_index: int) -> int:
        return matrix[manager.IndexToNode(from_index)][manager.IndexToNode(to_index)]

    transit = routing.RegisterTransitCallback(distance)
    routing.SetArcCostEvaluatorOfAllVehicles(transit)

    # Quintals are decimal; the solver needs integers, so demands and capacity
    # are both scaled by 100 and stay consistent with each other.
    scaled_demands = [int(round(d * 100)) for d in demands]
    scaled_capacity = int(round(capacity * 100))

    def demand(from_index: int) -> int:
        return scaled_demands[manager.IndexToNode(from_index)]

    demand_callback = routing.RegisterUnaryTransitCallback(demand)
    routing.AddDimensionWithVehicleCapacity(
        demand_callback,
        0,  # no slack
        [scaled_capacity] * vehicle_count,
        True,  # start cumulative at zero
        "Load",
    )

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    params.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    params.time_limit.FromSeconds(3)

    solution = routing.SolveWithParameters(params)
    if solution is None:
        return None

    routes: list[list[int]] = []
    for vehicle in range(vehicle_count):
        index = routing.Start(vehicle)
        nodes: list[int] = []
        while not routing.IsEnd(index):
            nodes.append(manager.IndexToNode(index))
            index = solution.Value(routing.NextVar(index))
        nodes.append(manager.IndexToNode(index))
        # A vehicle that only goes depot → depot was not needed.
        if len(nodes) > 2:
            routes.append(nodes)
    return routes


def _legs(matrix: list[list[int]], nodes: list[int]) -> tuple[list[int], int]:
    """Per-leg metres along a node sequence, and the total."""
    legs = [matrix[nodes[i]][nodes[i + 1]] for i in range(len(nodes) - 1)]
    return legs, sum(legs)


def _plan_for_class(
    points: list[dict],
    matrix: list[list[int]],
    demands: list[float],
    vehicle: VehicleClass,
) -> dict | None:
    """Cheapest plan using this vehicle class, or None if it cannot be done."""
    total_demand = sum(demands)
    minimum = math.ceil(total_demand / vehicle.capacity_quintals) if vehicle.capacity_quintals else 0
    if minimum == 0 or minimum > MAX_VEHICLES:
        return None

    # Try the minimum fleet, then one more: an extra vehicle sometimes shortens
    # total distance enough to pay for itself.
    best: dict | None = None
    for count in (minimum, minimum + 1):
        if count > MAX_VEHICLES:
            continue
        routes = _solve_cvrp(matrix, demands, count, vehicle.capacity_quintals)
        if not routes:
            continue

        total_metres = 0
        trucks = []
        for number, nodes in enumerate(routes, start=1):
            legs, metres = _legs(matrix, nodes)
            total_metres += metres
            load = sum(demands[node] for node in nodes)
            trucks.append(
                {
                    "vehicleNumber": number,
                    "nodes": nodes,
                    "legMetres": legs,
                    "roadKm": round(metres / METRES_PER_KM, 2),
                    "loadQuintals": round(load, 2),
                }
            )

        road_distance_km = total_metres / METRES_PER_KM
        cost = int(round(road_distance_km * vehicle.rupees_per_km))
        candidate = {
            "vehicleClass": vehicle.key,
            "vehicleLabel": vehicle.label,
            "capacityQuintals": vehicle.capacity_quintals,
            "rupeesPerKm": vehicle.rupees_per_km,
            "vehiclesUsed": len(trucks),
            "trucks": trucks,
            "roadKm": round(road_distance_km, 2),
            "straightLineKm": round(road_distance_km / ROAD_CIRCUITY_FACTOR, 2),
            "costRupees": cost,
        }
        if best is None or candidate["costRupees"] < best["costRupees"]:
            best = candidate

    return best


def _naive_plan(
    points: list[dict],
    matrix: list[list[int]],
    demands: list[float],
    vehicle: VehicleClass,
) -> dict:
    """The plan nobody optimised: visit the farms in the order they were given.

    Filled greedily in listed order until a truck is full, which is what a
    dispatcher without a solver would actually do. Costed with the same vehicle
    class so the comparison is like for like.
    """
    order = list(range(1, len(points)))
    trucks: list[list[int]] = []
    current: list[int] = []
    load = 0.0

    for node in order:
        if load + demands[node] > vehicle.capacity_quintals and current:
            trucks.append(current)
            current = []
            load = 0.0
        current.append(node)
        load += demands[node]
    if current:
        trucks.append(current)

    total_metres = 0
    described = []
    for number, farms in enumerate(trucks, start=1):
        nodes = [0, *farms, 0]
        legs, metres = _legs(matrix, nodes)
        total_metres += metres
        described.append(
            {
                "vehicleNumber": number,
                "nodes": nodes,
                "legMetres": legs,
                "roadKm": round(metres / METRES_PER_KM, 2),
                "loadQuintals": round(sum(demands[n] for n in farms), 2),
            }
        )

    road_distance_km = total_metres / METRES_PER_KM
    return {
        "vehicleClass": vehicle.key,
        "vehicleLabel": vehicle.label,
        "vehiclesUsed": len(described),
        "trucks": described,
        "roadKm": round(road_distance_km, 2),
        "costRupees": int(round(road_distance_km * vehicle.rupees_per_km)),
    }


def _separate_trips_plan(
    points: list[dict],
    matrix: list[list[int]],
    demands: list[float],
) -> dict:
    """What happens with no aggregation: one round trip per farm.

    This is the baseline FasalX actually replaces. Without a platform
    coordinating the collection, each farmer's lot is fetched on its own trip,
    each in the smallest vehicle that can carry it — so the comparison is
    against real practice rather than against a strawman.
    """
    total_metres = 0
    total_cost = 0
    trips = []

    for node in range(1, len(points)):
        load = demands[node]
        vehicle = next(
            (v for v in VEHICLE_CLASSES if v.capacity_quintals >= load),
            VEHICLE_CLASSES[-1],
        )
        metres = matrix[0][node] * 2  # out and back
        km = metres / METRES_PER_KM
        cost = int(round(km * vehicle.rupees_per_km))
        total_metres += metres
        total_cost += cost
        trips.append(
            {
                "id": points[node]["id"],
                "loadQuintals": round(load, 2),
                "vehicleLabel": vehicle.label,
                "roadKm": round(km, 2),
                "costRupees": cost,
            }
        )

    return {
        "trips": trips,
        "vehiclesUsed": len(trips),
        "roadKm": round(total_metres / METRES_PER_KM, 2),
        "costRupees": total_cost,
    }


def optimise_route(destination: dict, pickups: list[dict]) -> dict:
    """Cheapest collection plan across the vehicle classes, with the baseline.

    `destination` and each pickup need `lat`, `lng`; pickups also need
    `quantityQuintals` and carry an opaque `id` through to the result.
    """
    if not pickups:
        raise ValueError("No pickup points supplied")

    points = [{"lat": destination["lat"], "lng": destination["lng"], "id": None}, *pickups]
    demands = [0.0, *[float(p["quantityQuintals"]) for p in pickups]]
    matrix = _matrix(points)

    considered = []
    best: dict | None = None
    for vehicle in VEHICLE_CLASSES:
        plan = _plan_for_class(points, matrix, demands, vehicle)
        if plan is None:
            continue
        considered.append(
            {
                "vehicleClass": plan["vehicleClass"],
                "vehicleLabel": plan["vehicleLabel"],
                "vehiclesUsed": plan["vehiclesUsed"],
                "roadKm": plan["roadKm"],
                "costRupees": plan["costRupees"],
            }
        )
        if best is None or plan["costRupees"] < best["costRupees"]:
            best = plan

    if best is None:
        raise ValueError(
            f"{sum(demands)}Q cannot be carried by any configured vehicle class "
            f"within {MAX_VEHICLES} vehicles"
        )

    chosen = next(v for v in VEHICLE_CLASSES if v.key == best["vehicleClass"])
    naive = _naive_plan(points, matrix, demands, chosen)
    separate = _separate_trips_plan(points, matrix, demands)

    # Two baselines, because they answer different questions and only one of
    # them is the honest headline.
    #
    # `naive` is the same fleet visiting farms in listed order. On a small,
    # tightly clustered order it often ties with the optimum — there is simply
    # little to reorder — and reporting that tie is more useful than hiding it.
    #
    # `separate` is one round trip per farm, which is what happens with no
    # aggregation at all. That is the saving FasalX genuinely creates.
    saving = separate["costRupees"] - best["costRupees"]
    sequencing_saving = naive["costRupees"] - best["costRupees"]

    # Stops in visit order across all trucks, carrying the caller's ids back.
    stops = []
    sequence = 0
    for truck in best["trucks"]:
        for position, node in enumerate(truck["nodes"]):
            if node == 0:
                continue
            sequence += 1
            stops.append(
                {
                    "sequence": sequence,
                    "vehicleNumber": truck["vehicleNumber"],
                    "id": points[node]["id"],
                    "lat": points[node]["lat"],
                    "lng": points[node]["lng"],
                    "quantityQuintals": round(demands[node], 2),
                    # Distance travelled to reach this stop from the previous one.
                    "legRoadKm": round(truck["legMetres"][position - 1] / METRES_PER_KM, 2),
                }
            )

    return {
        "destination": {"lat": destination["lat"], "lng": destination["lng"]},
        "stops": stops,
        "trucks": [
            {
                "vehicleNumber": truck["vehicleNumber"],
                "loadQuintals": truck["loadQuintals"],
                "roadKm": truck["roadKm"],
                "stopIds": [points[node]["id"] for node in truck["nodes"] if node != 0],
            }
            for truck in best["trucks"]
        ],
        "vehicleClass": best["vehicleClass"],
        "vehicleLabel": best["vehicleLabel"],
        "vehiclesUsed": best["vehiclesUsed"],
        "capacityQuintals": best["capacityQuintals"],
        "rupeesPerKm": best["rupeesPerKm"],
        "totalQuintals": round(sum(demands), 2),
        "straightLineKm": best["straightLineKm"],
        "roadKm": best["roadKm"],
        "costRupees": best["costRupees"],
        "naiveSequential": {
            "vehiclesUsed": naive["vehiclesUsed"],
            "roadKm": naive["roadKm"],
            "costRupees": naive["costRupees"],
        },
        "separateTrips": {
            "vehiclesUsed": separate["vehiclesUsed"],
            "roadKm": separate["roadKm"],
            "costRupees": separate["costRupees"],
            "trips": separate["trips"],
        },
        "savingRupees": saving,
        "savingPercent": round(saving / separate["costRupees"] * 100, 1)
        if separate["costRupees"]
        else 0.0,
        "sequencingSavingRupees": sequencing_saving,
        "alternativesConsidered": considered,
        "assumptions": {
            "roadCircuityFactor": ROAD_CIRCUITY_FACTOR,
            "note": (
                "Distances are great-circle multiplied by a road-circuity factor, "
                "not routed road distances. ₹/km rates are illustrative pilot "
                "figures, not quoted freight rates."
            ),
            "baseline": (
                "Saving is measured against one round trip per farm, which is "
                "what collection costs without aggregation. The sequencing "
                "saving compares the same fleet visiting farms in listed order "
                "and is often zero on a small, clustered order."
            ),
        },
    }
