"use client";

import { feature, merge, mesh } from "topojson-client";
import { geoAlbersUsa, geoPath } from "d3-geo";
import type {
  Topology,
  GeometryCollection,
  Polygon as TopoPolygon,
  MultiPolygon as TopoMultiPolygon,
} from "topojson-specification";
import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
} from "geojson";

export type DistrictFeature = {
  geoid: string;
  statefips: string;
  cd: string;
  name: string;
  path: string;
  /** Projected centroid in the same SVG coord space as `path`. */
  centroid: [number, number];
};

export type StateFeature = {
  fips: string;
  abbr: string;
  name: string;
  path: string;
  centroid: [number, number];
};

export type Boundaries = {
  width: number;
  height: number;
  districts: DistrictFeature[];
  states: StateFeature[];
  stateMeshPath: string;
};

type DistrictProps = {
  STATEFP: string;
  CD119FP: string;
  GEOID: string;
  NAMELSAD: string;
};

type StateProps = {
  STATEFP: string;
  STUSPS: string;
  NAME: string;
};

const compact = (s: string) =>
  s.replace(/(-?\d+\.\d)\d+/g, "$1").replace(/\.0(?=[,\sLMZ]|$)/g, "");

export function projectBoundaries(topo: Topology): Boundaries {
  const t = topo as Topology<{
    districts: GeometryCollection<DistrictProps>;
    states: GeometryCollection<StateProps>;
  }>;

  // viewBox dimensions — must match the consumer's <svg viewBox>.
  const VIEW_W = 975;
  const VIEW_H = 610;
  // padding so AK/HI insets and Maine/Florida don't kiss the edge.
  const PAD = 10;

  const districtsFc = feature(
    t,
    t.objects.districts,
  ) as FeatureCollection<GeoJSON.Geometry, DistrictProps>;

  // The bundled `states` layer was simplified independently from
  // `districts`, so its arcs drift a pixel or two off the district arcs
  // and the state-border overlay reads as misaligned in the House view.
  // We use this layer only to pick up state metadata (abbr/name keyed by
  // STATEFP); the actual geometry we draw is derived from district arcs
  // via merge/mesh, which guarantees the borders snap together exactly.
  const statesMeta = feature(
    t,
    t.objects.states,
  ) as FeatureCollection<GeoJSON.Geometry, StateProps>;
  const stateMetaByFips = new Map<string, { abbr: string; name: string }>();
  for (const f of statesMeta.features) {
    stateMetaByFips.set(f.properties.STATEFP, {
      abbr: f.properties.STUSPS,
      name: f.properties.NAME,
    });
  }

  // Build state polygons by merging the district topology objects belonging
  // to each STATEFP. Same arcs as the districts → pixel-identical edges.
  type DistrictGeom = TopoPolygon<DistrictProps> | TopoMultiPolygon<DistrictProps>;
  const districtGeoms = (
    t.objects.districts as GeometryCollection<DistrictProps>
  ).geometries as DistrictGeom[];
  const districtsByState = new Map<string, DistrictGeom[]>();
  for (const g of districtGeoms) {
    const fips = g.properties!.STATEFP;
    const bucket = districtsByState.get(fips);
    if (bucket) bucket.push(g);
    else districtsByState.set(fips, [g]);
  }
  const stateFeatures: Feature<MultiPolygon, StateProps>[] = Array.from(
    districtsByState,
    ([fips, geoms]) => {
      const meta = stateMetaByFips.get(fips);
      return {
        type: "Feature",
        properties: {
          STATEFP: fips,
          STUSPS: meta?.abbr ?? "",
          NAME: meta?.name ?? "",
        },
        geometry: merge(t, geoms) as MultiPolygon,
      };
    },
  );
  const statesFc: FeatureCollection<MultiPolygon, StateProps> = {
    type: "FeatureCollection",
    features: stateFeatures,
  };

  // The state-mesh overlay (drawn dark for state borders in the House view)
  // is the subset of district arcs whose two neighbors are in different
  // states — plus the outer boundary, which is included when `b` is null.
  const stateMeshGeo = mesh(
    t,
    t.objects.districts,
    (a, b) => {
      const sa = (a as DistrictGeom).properties?.STATEFP;
      const sb = b ? (b as DistrictGeom).properties?.STATEFP : undefined;
      return !b || sa !== sb;
    },
  );

  // Auto-fit projection against the merged state polygons (same extent as
  // before, but now exactly matches what we draw).
  const projection = geoAlbersUsa();
  projection.fitExtent(
    [
      [PAD, PAD],
      [VIEW_W - PAD, VIEW_H - PAD],
    ],
    statesFc,
  );
  const pathFn = geoPath(projection);

  const districts: DistrictFeature[] = districtsFc.features.map(
    (f: Feature<GeoJSON.Geometry, DistrictProps>) => ({
      geoid: f.properties.GEOID,
      statefips: f.properties.STATEFP,
      cd: f.properties.CD119FP,
      name: f.properties.NAMELSAD,
      path: compact(pathFn(f) ?? ""),
      centroid: pathFn.centroid(f) as [number, number],
    }),
  );

  const states: StateFeature[] = stateFeatures.map((f) => ({
    fips: f.properties.STATEFP,
    abbr: f.properties.STUSPS,
    name: f.properties.NAME,
    path: compact(pathFn(f) ?? ""),
    centroid: pathFn.centroid(f) as [number, number],
  }));

  return {
    width: VIEW_W,
    height: VIEW_H,
    districts,
    states,
    stateMeshPath: compact(pathFn(stateMeshGeo) ?? ""),
  };
}
