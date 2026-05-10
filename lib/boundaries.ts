"use client";

import { feature, mesh } from "topojson-client";
import { geoAlbersUsa, geoPath } from "d3-geo";
import type {
  Topology,
  GeometryCollection,
} from "topojson-specification";
import type { Feature, FeatureCollection } from "geojson";

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
  const statesFc = feature(
    t,
    t.objects.states,
  ) as FeatureCollection<GeoJSON.Geometry, StateProps>;
  const stateMeshGeo = mesh(t, t.objects.states, (a, b) => a !== b);

  // Auto-fit the projection so every state (including AK + HI insets) lives
  // inside [PAD, VIEW_W - PAD] × [PAD, VIEW_H - PAD] — eliminates the
  // edge-clipping you'd get from a hardcoded scale/translate.
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

  const states: StateFeature[] = statesFc.features.map(
    (f: Feature<GeoJSON.Geometry, StateProps>) => ({
      fips: f.properties.STATEFP,
      abbr: f.properties.STUSPS,
      name: f.properties.NAME,
      path: compact(pathFn(f) ?? ""),
      centroid: pathFn.centroid(f) as [number, number],
    }),
  );

  return {
    width: VIEW_W,
    height: VIEW_H,
    districts,
    states,
    stateMeshPath: compact(pathFn(stateMeshGeo) ?? ""),
  };
}
