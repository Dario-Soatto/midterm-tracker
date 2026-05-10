export type StateMeta = {
  fips: string;
  abbr: string;
  name: string;
  lean: number;
  districts: number;
};

export const STATES: StateMeta[] = [
  { fips: "01", abbr: "AL", name: "Alabama", lean: -0.6, districts: 7 },
  { fips: "02", abbr: "AK", name: "Alaska", lean: -0.4, districts: 1 },
  { fips: "04", abbr: "AZ", name: "Arizona", lean: -0.05, districts: 9 },
  { fips: "05", abbr: "AR", name: "Arkansas", lean: -0.55, districts: 4 },
  { fips: "06", abbr: "CA", name: "California", lean: 0.55, districts: 52 },
  { fips: "08", abbr: "CO", name: "Colorado", lean: 0.2, districts: 8 },
  { fips: "09", abbr: "CT", name: "Connecticut", lean: 0.4, districts: 5 },
  { fips: "10", abbr: "DE", name: "Delaware", lean: 0.4, districts: 1 },
  { fips: "11", abbr: "DC", name: "District of Columbia", lean: 0.95, districts: 0 },
  { fips: "12", abbr: "FL", name: "Florida", lean: -0.2, districts: 28 },
  { fips: "13", abbr: "GA", name: "Georgia", lean: -0.05, districts: 14 },
  { fips: "15", abbr: "HI", name: "Hawaii", lean: 0.55, districts: 2 },
  { fips: "16", abbr: "ID", name: "Idaho", lean: -0.7, districts: 2 },
  { fips: "17", abbr: "IL", name: "Illinois", lean: 0.3, districts: 17 },
  { fips: "18", abbr: "IN", name: "Indiana", lean: -0.5, districts: 9 },
  { fips: "19", abbr: "IA", name: "Iowa", lean: -0.3, districts: 4 },
  { fips: "20", abbr: "KS", name: "Kansas", lean: -0.5, districts: 4 },
  { fips: "21", abbr: "KY", name: "Kentucky", lean: -0.5, districts: 6 },
  { fips: "22", abbr: "LA", name: "Louisiana", lean: -0.5, districts: 6 },
  { fips: "23", abbr: "ME", name: "Maine", lean: 0.15, districts: 2 },
  { fips: "24", abbr: "MD", name: "Maryland", lean: 0.5, districts: 8 },
  { fips: "25", abbr: "MA", name: "Massachusetts", lean: 0.6, districts: 9 },
  { fips: "26", abbr: "MI", name: "Michigan", lean: 0.05, districts: 13 },
  { fips: "27", abbr: "MN", name: "Minnesota", lean: 0.15, districts: 8 },
  { fips: "28", abbr: "MS", name: "Mississippi", lean: -0.5, districts: 4 },
  { fips: "29", abbr: "MO", name: "Missouri", lean: -0.4, districts: 8 },
  { fips: "30", abbr: "MT", name: "Montana", lean: -0.4, districts: 2 },
  { fips: "31", abbr: "NE", name: "Nebraska", lean: -0.4, districts: 3 },
  { fips: "32", abbr: "NV", name: "Nevada", lean: 0.05, districts: 4 },
  { fips: "33", abbr: "NH", name: "New Hampshire", lean: 0.1, districts: 2 },
  { fips: "34", abbr: "NJ", name: "New Jersey", lean: 0.3, districts: 12 },
  { fips: "35", abbr: "NM", name: "New Mexico", lean: 0.2, districts: 3 },
  { fips: "36", abbr: "NY", name: "New York", lean: 0.4, districts: 26 },
  { fips: "37", abbr: "NC", name: "North Carolina", lean: -0.05, districts: 14 },
  { fips: "38", abbr: "ND", name: "North Dakota", lean: -0.6, districts: 1 },
  { fips: "39", abbr: "OH", name: "Ohio", lean: -0.2, districts: 15 },
  { fips: "40", abbr: "OK", name: "Oklahoma", lean: -0.7, districts: 5 },
  { fips: "41", abbr: "OR", name: "Oregon", lean: 0.3, districts: 6 },
  { fips: "42", abbr: "PA", name: "Pennsylvania", lean: 0.0, districts: 17 },
  { fips: "44", abbr: "RI", name: "Rhode Island", lean: 0.4, districts: 2 },
  { fips: "45", abbr: "SC", name: "South Carolina", lean: -0.4, districts: 7 },
  { fips: "46", abbr: "SD", name: "South Dakota", lean: -0.6, districts: 1 },
  { fips: "47", abbr: "TN", name: "Tennessee", lean: -0.5, districts: 9 },
  { fips: "48", abbr: "TX", name: "Texas", lean: -0.2, districts: 38 },
  { fips: "49", abbr: "UT", name: "Utah", lean: -0.5, districts: 4 },
  { fips: "50", abbr: "VT", name: "Vermont", lean: 0.5, districts: 1 },
  { fips: "51", abbr: "VA", name: "Virginia", lean: 0.15, districts: 11 },
  { fips: "53", abbr: "WA", name: "Washington", lean: 0.3, districts: 10 },
  { fips: "54", abbr: "WV", name: "West Virginia", lean: -0.6, districts: 2 },
  { fips: "55", abbr: "WI", name: "Wisconsin", lean: 0.0, districts: 8 },
  { fips: "56", abbr: "WY", name: "Wyoming", lean: -0.7, districts: 1 },
];

export const STATES_BY_FIPS: Record<string, StateMeta> = Object.fromEntries(
  STATES.map((s) => [s.fips, s]),
);

export const STATES_BY_ABBR: Record<string, StateMeta> = Object.fromEntries(
  STATES.map((s) => [s.abbr, s]),
);

/**
 * States with U.S. Senate elections in November 2026:
 *   - 33 Class 2 seats on the regular cycle
 *   - FL special (Class 3, post-Rubio)
 *   - OH special (Class 1, post-Vance)
 * = 35 contested seats; the remaining 65 are "holding".
 */
export const SENATE_2026_STATES = new Set([
  "AL", "AK", "AR", "CO", "DE", "FL", "GA", "ID", "IL", "IA",
  "KS", "KY", "LA", "ME", "MA", "MI", "MN", "MS", "MT", "NE",
  "NH", "NJ", "NM", "NC", "OH", "OK", "OR", "RI", "SC", "SD",
  "TN", "TX", "VA", "WV", "WY",
]);

/** States with gubernatorial elections in November 2026. */
export const GOVERNOR_2026_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "FL", "GA", "HI",
  "ID", "IL", "IA", "KS", "ME", "MD", "MA", "MI", "MN", "NE",
  "NV", "NH", "NM", "NY", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "VT", "WI", "WY",
]);
