/**
 * FasalX demo seed.
 *
 * Produces the exact pre-demo world locked in CLAUDE.md. Nothing here is
 * random at runtime: the price curve uses a fixed-seed PRNG so `db:reset &&
 * db:seed` is byte-identical every time. Dates are anchored to "today" so the
 * demo always looks current.
 *
 * What this seeds: users, profiles, listings, one open requirement, and 24
 * months of price history. It deliberately seeds NO orders, contracts,
 * shipments, QC or settlements — those are created by clicking through the
 * 10-scene demo, which is the whole point of the demo.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { Grade, KycStatus, PrismaClient, RequirementStatus, Role } from "@prisma/client";

const prisma = new PrismaClient();

// ---------------------------------------------------------------- constants

/** Karnal, Haryana. The buyer sits here and it is the delivery destination. */
const KARNAL = { lat: 29.6857, lng: 76.9905 } as const;

const CROP = "wheat";
const DISTRICT = "Karnal";
const STATE = "Haryana";

/** Scene 2: the price the farmer sees today. */
const CURRENT_PRICE = 2380;

/** Months of daily price history to generate. */
const HISTORY_MONTHS = 24;

/** Locked match weights from the build plan. Session 8 owns the real engine;
 *  these are used here only to self-check that the seeded world still
 *  aggregates to exactly 500Q. */
const WEIGHTS = { price: 0.3, distance: 0.25, quantity: 0.2, quality: 0.15, reliability: 0.1 };

const CSV_PATH = path.join(__dirname, "..", "services", "ai", "data", "wheat_karnal.csv");

// ---------------------------------------------------------------- helpers

/** Great-circle distance in km. No PostGIS — CLAUDE.md. */
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Deterministic PRNG (mulberry32) so reseeds are identical. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Today's calendar date in India, as UTC midnight (which is how Postgres
 * `date` columns are stored). Using plain UTC midnight would date the whole
 * demo a day behind for anyone running it in IST after 05:30 — the farmer in
 * Karnal would open the app and see yesterday's price as "today".
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istToday(): Date {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - start) / 86_400_000) + 1;
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

// ---------------------------------------------------------------- the world

type Reason = "hero" | "winner" | "too-expensive" | "wrong-grade" | "below-min-lot" | "too-far";

interface FarmerSpec {
  name: string;
  phone: string;
  village: string;
  district: string;
  lat: number;
  lng: number;
  farmSizeAcres: number;
  rating: number;
  completedOrders: number;
  listing: { quantity: number; grade: Grade; price: number; availableInDays: number };
  /** Why this farmer wins or loses the 500Q match. Documentation, not data. */
  reason: Reason;
}

/**
 * Twelve farmers around Karnal, all members of the FPO. Real Haryana towns
 * with real coordinates, spread from 0 km to 191 km so distance-based ranking
 * is visible in the UI.
 *
 * Four of them — Sukhbir 150 + Jaswant 150 + Balwinder 120 + Manjeet 80 —
 * sum to exactly 500Q and are the intended winners. The other eight are
 * deliberately worse fits, each for a different, single, legible reason so the
 * matching engine visibly rejects supply for a stated cause.
 */
const FARMERS: FarmerSpec[] = [
  {
    name: "Ramesh Kumar",
    phone: "9876543210",
    village: "Karnal",
    district: "Karnal",
    lat: 29.6857,
    lng: 76.9905,
    farmSizeAcres: 4.5,
    rating: 4.6,
    completedOrders: 12,
    listing: { quantity: 50, grade: Grade.A, price: 2400, availableInDays: 3 },
    reason: "hero",
  },
  {
    name: "Sukhbir Singh",
    phone: "9876500002",
    village: "Nilokheri",
    district: "Karnal",
    lat: 29.8333,
    lng: 76.9333,
    farmSizeAcres: 12.0,
    rating: 4.8,
    completedOrders: 23,
    listing: { quantity: 150, grade: Grade.A, price: 2395, availableInDays: 2 },
    reason: "winner",
  },
  {
    name: "Jaswant Rai",
    phone: "9876500003",
    village: "Taraori",
    district: "Karnal",
    lat: 29.7947,
    lng: 76.9333,
    farmSizeAcres: 14.0,
    rating: 4.7,
    completedOrders: 18,
    listing: { quantity: 150, grade: Grade.A, price: 2405, availableInDays: 2 },
    reason: "winner",
  },
  {
    name: "Balwinder Kaur",
    phone: "9876500004",
    village: "Gharaunda",
    district: "Karnal",
    lat: 29.5372,
    lng: 76.9702,
    farmSizeAcres: 10.5,
    rating: 4.6,
    completedOrders: 15,
    listing: { quantity: 120, grade: Grade.A, price: 2415, availableInDays: 3 },
    reason: "winner",
  },
  {
    name: "Manjeet Singh",
    phone: "9876500005",
    village: "Nissing",
    district: "Karnal",
    lat: 29.6167,
    lng: 76.7833,
    farmSizeAcres: 7.5,
    rating: 4.5,
    completedOrders: 11,
    listing: { quantity: 80, grade: Grade.A, price: 2425, availableInDays: 4 },
    reason: "winner",
  },
  {
    name: "Satpal Sharma",
    phone: "9876500006",
    village: "Kurukshetra",
    district: "Kurukshetra",
    lat: 29.9695,
    lng: 76.8783,
    farmSizeAcres: 9.0,
    rating: 4.3,
    completedOrders: 8,
    // Grade A and close, but holding out well above the buyer's target.
    listing: { quantity: 110, grade: Grade.A, price: 2610, availableInDays: 2 },
    reason: "too-expensive",
  },
  {
    name: "Rajbir Singh",
    phone: "9876500007",
    village: "Kaithal",
    district: "Kaithal",
    lat: 29.8015,
    lng: 76.3998,
    farmSizeAcres: 11.0,
    rating: 4.1,
    completedOrders: 6,
    listing: { quantity: 130, grade: Grade.A, price: 2560, availableInDays: 5 },
    reason: "too-expensive",
  },
  {
    name: "Kuldeep Yadav",
    phone: "9876500008",
    village: "Indri",
    district: "Karnal",
    lat: 29.8833,
    lng: 77.0667,
    farmSizeAcres: 13.0,
    rating: 4.4,
    completedOrders: 9,
    // Cheapest big lot on the board — and rejected purely on grade.
    listing: { quantity: 140, grade: Grade.B, price: 2310, availableInDays: 2 },
    reason: "wrong-grade",
  },
  {
    name: "Om Prakash",
    phone: "9876500009",
    village: "Kunjpura",
    district: "Karnal",
    lat: 29.7167,
    lng: 77.1,
    farmSizeAcres: 5.0,
    rating: 4.0,
    completedOrders: 5,
    listing: { quantity: 95, grade: Grade.C, price: 2240, availableInDays: 3 },
    reason: "wrong-grade",
  },
  {
    name: "Naresh Chand",
    phone: "9876500010",
    village: "Panipat",
    district: "Panipat",
    lat: 29.3909,
    lng: 76.9635,
    farmSizeAcres: 6.0,
    rating: 4.2,
    completedOrders: 7,
    listing: { quantity: 60, grade: Grade.A, price: 2430, availableInDays: 4 },
    reason: "below-min-lot",
  },
  {
    name: "Hoshiar Singh",
    phone: "9876500011",
    village: "Rewari",
    district: "Rewari",
    lat: 28.199,
    lng: 76.6183,
    farmSizeAcres: 16.0,
    rating: 4.5,
    completedOrders: 14,
    // Big and cheap, but 169 km out — the haul destroys the economics.
    listing: { quantity: 160, grade: Grade.A, price: 2390, availableInDays: 2 },
    reason: "too-far",
  },
  {
    name: "Dharam Pal",
    phone: "9876500012",
    village: "Sirsa",
    district: "Sirsa",
    lat: 29.5347,
    lng: 75.018,
    farmSizeAcres: 18.0,
    rating: 4.4,
    completedOrders: 10,
    listing: { quantity: 155, grade: Grade.A, price: 2370, availableInDays: 3 },
    reason: "too-far",
  },
];

// ---------------------------------------------------------------- price history

interface PriceRow {
  date: Date;
  modal: number;
  min: number;
  max: number;
  arrivals: number;
}

/**
 * Tolerant Agmarknet CSV reader. Column names differ between data.gov.in
 * exports, so headers are matched fuzzily rather than by exact position.
 * Returns null if the file is absent or unusable — the caller falls back to
 * the generated curve and says so.
 */
function readCsv(file: string): PriceRow[] | null {
  if (!existsSync(file)) return null;

  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    console.warn(`  ! ${path.basename(file)} has no data rows — using generated curve`);
    return null;
  }

  const split = (line: string) =>
    line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const header = split(lines[0]!).map((h) => h.toLowerCase());

  const find = (...patterns: RegExp[]): number =>
    patterns.reduce<number>(
      (found, re) => (found >= 0 ? found : header.findIndex((h) => re.test(h))),
      -1,
    );

  const iDate = find(/arrival.*date/, /reported.*date/, /^date$/, /date/);
  const iModal = find(/modal/, /avg|average/, /price/);
  const iMin = find(/min/);
  const iMax = find(/max/);
  const iArrivals = find(/arrival(?!.*date)/, /quantity|tonnes|qty/);

  // Agmarknet reports arrivals in TONNES. CLAUDE.md forbids mixing units, so
  // convert to quintals on the way in rather than anywhere downstream.
  const arrivalsInTonnes = iArrivals >= 0 && /tonne|tonnes|mt\b/.test(header[iArrivals] ?? "");
  const toQuintals = (v: number) => (arrivalsInTonnes ? v * 10 : v);
  const iCommodity = find(/commodity/);
  const iDistrict = find(/district/, /market/);

  if (iDate < 0 || iModal < 0) {
    console.warn(
      `  ! ${path.basename(file)}: could not find a date and price column ` +
        `(headers: ${header.join(", ")}) — using generated curve`,
    );
    return null;
  }

  const parseDate = (raw: string): Date | null => {
    const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (dmy) {
      return new Date(Date.UTC(+dmy[3]!, +dmy[2]! - 1, +dmy[1]!));
    }
    const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return new Date(Date.UTC(+iso[1]!, +iso[2]! - 1, +iso[3]!));
    const t = Date.parse(raw);
    return Number.isNaN(t) ? null : utcMidnight(new Date(t));
  };

  const num = (raw: string | undefined): number | null => {
    if (raw === undefined) return null;
    const v = Number(raw.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(v) && v > 0 ? v : null;
  };

  const byDate = new Map<number, PriceRow>();
  let skipped = 0;

  for (const line of lines.slice(1)) {
    const cells = split(line);
    if (iCommodity >= 0 && cells[iCommodity] && !/wheat|gehu|गेहूं/i.test(cells[iCommodity]!)) {
      skipped++;
      continue;
    }
    if (iDistrict >= 0 && cells[iDistrict] && !/karnal/i.test(cells[iDistrict]!)) {
      skipped++;
      continue;
    }
    const date = parseDate(cells[iDate] ?? "");
    const modal = num(cells[iModal]);
    if (!date || modal === null) {
      skipped++;
      continue;
    }
    const min = num(cells[iMin]) ?? Math.round(modal * 0.975);
    const max = num(cells[iMax]) ?? Math.round(modal * 1.025);
    byDate.set(date.getTime(), {
      date,
      modal: Math.round(modal),
      min: Math.round(min),
      max: Math.round(max),
      arrivals: toQuintals(num(cells[iArrivals]) ?? 0),
    });
  }

  const rows = [...byDate.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
  if (rows.length === 0) {
    console.warn(`  ! ${path.basename(file)}: no wheat/Karnal rows parsed — using generated curve`);
    return null;
  }
  console.log(
    `  ✓ parsed ${rows.length} rows from ${path.basename(file)} (${skipped} skipped)` +
      (arrivalsInTonnes ? ", arrivals converted tonnes → quintals" : ""),
  );
  return rows;
}

/**
 * Generate a plausible wheat price series for Karnal.
 *
 * Shape: a mild year-on-year uptrend, an annual sinusoid peaking in late
 * December (lean season) and a sharper dip through the April harvest glut,
 * with deterministic noise. A tapered correction over the final 60 days lands
 * the last value on exactly ₹2,380 without a visible discontinuity.
 */
function generateCurve(from: Date, to: Date, endPrice: number): PriceRow[] {
  const rng = makeRng(26033); // SIH problem number, for luck
  const totalDays = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  const rows: PriceRow[] = [];

  for (let i = 0; i <= totalDays; i++) {
    const date = addDays(from, i);
    const doy = dayOfYear(date);

    const trend = 1 + 0.05 * (i / 365); // ~5% a year
    const seasonal = 0.035 * Math.cos((2 * Math.PI * (doy - 350)) / 365);

    // April harvest glut: arrivals spike, prices sag.
    const harvest = Math.exp(-(((doy - 112) / 26) ** 2));
    const glut = -0.025 * harvest;

    const noise = (rng() - 0.5) * 0.012;
    const modal = 2180 * trend * (1 + seasonal + glut + noise);

    rows.push({
      date,
      modal,
      min: 0,
      max: 0,
      arrivals: 700 + 2600 * harvest + (rng() - 0.5) * 260,
    });
  }

  // Land the final day exactly on endPrice, ramped over the last 60 days.
  const last = rows[rows.length - 1]!;
  const delta = endPrice - last.modal;
  const ramp = Math.min(60, rows.length - 1);
  rows.forEach((r, i) => {
    const w = ramp === 0 ? 1 : Math.max(0, (i - (rows.length - 1 - ramp)) / ramp);
    r.modal = Math.round(r.modal + delta * w);
    r.min = Math.round(r.modal * (1 - 0.018 - rng() * 0.008));
    r.max = Math.round(r.modal * (1 + 0.018 + rng() * 0.008));
    r.arrivals = Math.round(Math.max(120, r.arrivals));
  });

  return rows;
}

// ---------------------------------------------------------------- self-check

/**
 * Indicative check that the seeded world still aggregates to exactly 500Q
 * under the locked weights. Session 8 owns the real matching engine — this
 * only guards the seed data against drift, so a bad edit fails here loudly
 * instead of quietly breaking the demo three sessions later.
 */
function verifyAggregation(requirement: {
  quantity: number;
  grade: Grade;
  maxDistanceKm: number;
  minLot: number;
}): { ok: boolean; report: string[]; selectedNames: string[] } {
  const report: string[] = [];

  const candidates = FARMERS.map((f) => ({
    name: f.name,
    km: haversineKm(KARNAL.lat, KARNAL.lng, f.lat, f.lng),
    qty: f.listing.quantity,
    grade: f.listing.grade,
    price: f.listing.price,
    rating: f.rating,
    reason: f.reason,
  }));

  const pool = candidates.filter(
    (c) =>
      c.grade === requirement.grade &&
      c.km <= requirement.maxDistanceKm &&
      c.qty >= requirement.minLot,
  );

  const span = (vals: number[]) => [Math.min(...vals), Math.max(...vals)] as const;
  const [pLo, pHi] = span(pool.map((c) => c.price));
  const [dLo, dHi] = span(pool.map((c) => c.km));
  const [qLo, qHi] = span(pool.map((c) => c.qty));
  const norm = (v: number, lo: number, hi: number, lowerIsBetter: boolean) =>
    hi === lo ? 1 : lowerIsBetter ? (hi - v) / (hi - lo) : (v - lo) / (hi - lo);

  const ranked = pool
    .map((c) => ({
      ...c,
      score:
        WEIGHTS.price * norm(c.price, pLo, pHi, true) +
        WEIGHTS.distance * norm(c.km, dLo, dHi, true) +
        WEIGHTS.quantity * norm(c.qty, qLo, qHi, false) +
        WEIGHTS.quality * 1 +
        WEIGHTS.reliability * (c.rating / 5),
    }))
    .sort((a, b) => b.score - a.score);

  let running = 0;
  const selected: { name: string; take: number; score: number }[] = [];
  for (const c of ranked) {
    if (running >= requirement.quantity) break;
    const take = Math.min(c.qty, requirement.quantity - running);
    running += take;
    selected.push({ name: c.name, take, score: c.score });
  }

  report.push(
    `eligible pool: ${pool.length} of ${candidates.length} farmers ` +
      `(grade ${requirement.grade}, ≤${requirement.maxDistanceKm} km, ≥${requirement.minLot}Q)`,
  );
  ranked.forEach((c, i) =>
    report.push(
      `  ${String(i + 1).padStart(2)}. ${c.name.padEnd(15)} ${String(c.qty).padStart(3)}Q  ` +
        `${inr(c.price)}/Q  ${c.km.toFixed(0).padStart(3)} km  score ${c.score.toFixed(4)}`,
    ),
  );
  report.push(
    `aggregation: ${selected.map((s) => `${s.take}`).join(" + ")} = ${running}Q ` +
      `from ${selected.map((s) => s.name.split(" ")[0]).join(", ")}`,
  );

  const wholeLots = selected.every((s, i) => s.take === ranked[i]!.qty);
  const ok = running === requirement.quantity && selected.length === 4 && wholeLots;
  return { ok, report, selectedNames: selected.map((s) => s.name) };
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  const today = istToday();
  const requirementSpec = {
    quantity: 500,
    grade: Grade.A,
    targetPrice: 2400,
    maxDistanceKm: 150,
    /** ABC Foods will not coordinate a pickup smaller than this for a bulk lot. */
    minLot: 75,
    deliveryInDays: 7,
  };

  console.log("\nFasalX demo seed");
  console.log("================");
  console.log(`anchor date: ${today.toISOString().slice(0, 10)} (IST)\n`);

  console.log("1/5  self-check: does the seeded world still aggregate to 500Q?");
  const check = verifyAggregation(requirementSpec);
  check.report.forEach((l) => console.log(`     ${l}`));
  if (!check.ok) {
    throw new Error(
      "Seed self-check failed: the top-ranked farmers no longer fill exactly 500Q " +
        "in whole lots. Fix the FARMERS roster before seeding.",
    );
  }
  console.log("     ✓ exactly 500Q from four whole lots\n");

  console.log("2/5  wiping existing data");
  // Reverse dependency order so this works without --force-reset.
  await prisma.settlement.deleteMany();
  await prisma.qualityCheck.deleteMany();
  await prisma.shipmentStop.deleteMany();
  await prisma.shipment.deleteMany();
  await prisma.escrow.deleteMany();
  await prisma.contractEvent.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.orderAllocation.deleteMany();
  await prisma.order.deleteMany();
  await prisma.offer.deleteMany();
  await prisma.buyerRequirement.deleteMany();
  await prisma.produceListing.deleteMany();
  await prisma.farmerProfile.deleteMany();
  await prisma.buyerProfile.deleteMany();
  await prisma.fpoProfile.deleteMany();
  await prisma.priceHistory.deleteMany();
  await prisma.user.deleteMany();

  console.log("3/5  creating FPO, buyer and 12 farmers");

  const fpo = await prisma.fpoProfile.create({
    data: {
      name: "Karnal Kisan Producer Company",
      registrationNo: "FPO/HR/KNL/2019/0142",
      district: DISTRICT,
      state: STATE,
      lat: KARNAL.lat,
      lng: KARNAL.lng,
      user: {
        create: {
          phone: "9800011122",
          name: "Karnal Kisan Producer Company",
          role: Role.FPO,
          language: "hi",
        },
      },
    },
  });

  const buyer = await prisma.buyerProfile.create({
    data: {
      companyName: "ABC Foods",
      gstin: "06AABCA1234D1Z5",
      district: DISTRICT,
      state: STATE,
      lat: KARNAL.lat,
      lng: KARNAL.lng,
      user: {
        create: {
          phone: "9812345678",
          name: "ABC Foods Procurement",
          role: Role.BUYER,
          language: "en",
        },
      },
    },
  });

  for (const spec of FARMERS) {
    await prisma.farmerProfile.create({
      data: {
        village: spec.village,
        district: spec.district,
        state: STATE,
        lat: spec.lat,
        lng: spec.lng,
        farmSizeAcres: spec.farmSizeAcres,
        rating: spec.rating,
        completedOrders: spec.completedOrders,
        kycStatus: KycStatus.VERIFIED,
        settlementUpi: `${spec.phone}@upi`,
        fpo: { connect: { id: fpo.id } },
        user: {
          create: {
            phone: spec.phone,
            name: spec.name,
            role: Role.FARMER,
            language: "hi",
          },
        },
        listings: {
          create: {
            crop: CROP,
            grade: spec.listing.grade,
            quantityQuintals: spec.listing.quantity,
            expectedPricePerQuintal: spec.listing.price,
            availableFrom: addDays(today, spec.listing.availableInDays),
            village: spec.village,
            district: spec.district,
            state: STATE,
            lat: spec.lat,
            lng: spec.lng,
          },
        },
      },
    });
  }

  console.log("4/5  creating the open 500Q requirement");
  await prisma.buyerRequirement.create({
    data: {
      buyerId: buyer.id,
      crop: CROP,
      grade: requirementSpec.grade,
      quantityQuintals: requirementSpec.quantity,
      targetPricePerQuintal: requirementSpec.targetPrice,
      maxDistanceKm: requirementSpec.maxDistanceKm,
      minLotQuintals: requirementSpec.minLot,
      deliveryBy: addDays(today, requirementSpec.deliveryInDays),
      status: RequirementStatus.OPEN,
      notes: "Grade A milling wheat. Single consolidated delivery to the Karnal mill.",
    },
  });

  console.log(`5/5  seeding ${HISTORY_MONTHS} months of daily price history`);
  const from = addDays(today, -Math.round(HISTORY_MONTHS * 30.44));
  const csv = readCsv(CSV_PATH);
  let rows: PriceRow[];
  let source: string;

  if (csv && csv.length > 0) {
    rows = csv.filter((r) => r.date >= from && r.date <= today);
    source = "agmarknet-csv";
    const lastCsv = rows[rows.length - 1];
    console.log(
      `     using real Agmarknet data: ${rows.length} rows, ` +
        `latest ${lastCsv?.date.toISOString().slice(0, 10)} at ${inr(lastCsv?.modal ?? 0)}`,
    );

    // Real data is never rewritten to hit a demo number: session 7 trains on
    // these rows and quotes their error to judges. If the real tail differs
    // from the price locked in CLAUDE.md, the demo script is what should move.
    const drift = Math.abs((lastCsv?.modal ?? 0) - CURRENT_PRICE);
    if (drift > 25) {
      console.warn(
        `     ! CLAUDE.md locks the current price at ${inr(CURRENT_PRICE)} but the CSV ends at ` +
          `${inr(lastCsv?.modal ?? 0)}. The CSV is left untouched — update the demo script's ` +
          `numbers to match the real data rather than the other way round.`,
      );
    }
  } else {
    rows = generateCurve(from, today, CURRENT_PRICE);
    source = "generated";
    console.log(`     no usable CSV — generated ${rows.length} rows ending at ${inr(CURRENT_PRICE)}`);
  }

  await prisma.priceHistory.createMany({
    data: rows.map((r) => ({
      crop: CROP,
      district: DISTRICT,
      state: STATE,
      date: r.date,
      modalPricePerQuintal: r.modal,
      minPricePerQuintal: r.min,
      maxPricePerQuintal: r.max,
      arrivalQuintals: r.arrivals,
      source,
    })),
  });

  // ---------------------------------------------------------------- summary

  const [users, farmers, listings, prices, latest] = await Promise.all([
    prisma.user.count(),
    prisma.farmerProfile.count(),
    prisma.produceListing.count(),
    prisma.priceHistory.count(),
    prisma.priceHistory.findFirst({ orderBy: { date: "desc" } }),
  ]);

  // Read the winning four back out of the database by the names the ranking
  // selected, so this summary reflects stored rows and not the in-memory spec.
  const winners = await prisma.produceListing.findMany({
    where: { farmer: { user: { name: { in: check.selectedNames } } } },
    include: { farmer: { include: { user: true } } },
    orderBy: { quantityQuintals: "desc" },
  });
  const winnerSum = winners.reduce((s, l) => s + Number(l.quantityQuintals), 0);

  console.log("\ndone");
  console.log("----");
  console.log(`users ${users} · farmers ${farmers} · listings ${listings} · price rows ${prices}`);
  console.log(`latest price: ${inr(latest?.modalPricePerQuintal ?? 0)}/Q on ${latest?.date.toISOString().slice(0, 10)}`);
  console.log(`\nthe four farmers that fill the 500Q requirement:`);
  winners.forEach((l) =>
    console.log(
      `  ${l.farmer.user.name.padEnd(15)} ${String(Number(l.quantityQuintals)).padStart(3)}Q  ` +
        `Grade ${l.grade}  ${inr(l.expectedPricePerQuintal)}/Q  ${l.village}`,
    ),
  );
  console.log(`  ${"".padEnd(15)} ${String(winnerSum).padStart(3)}Q  total`);
  console.log(`\ndemo logins  —  farmer 9876543210 (Ramesh Kumar) · buyer 9812345678 (ABC Foods)\n`);
}

main()
  .catch((e) => {
    console.error("\nseed failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
