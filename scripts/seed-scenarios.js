const path = require("node:path");
const { runImmediateTransaction } = require("../backend/db/transaction");
const { openSqliteDatabase } = require("../backend/db/sqlite");

const PASSWORD = "demo123";
const DEFAULT_DB_PATH = path.join(__dirname, "..", "data", "greenlab-demo.sqlite");
const DEFAULT_BASE_CANDIDATES = [
  process.env.BASE_URL,
  "http://127.0.0.1:3011",
  "http://127.0.0.1:3010",
  "http://127.0.0.1:3012"
].filter(Boolean);

const CUSTOMER_NAMES = [
  "Alex Carter",
  "Maya Lin",
  "Noah Bennett",
  "Iris Collins",
  "Liam Foster",
  "Eva Martin",
  "Owen Parker",
  "Nora Hayes",
  "Ethan Reed",
  "Sara Kim",
  "Leo Turner",
  "Mila Brooks",
  "Ava Cooper",
  "Ryan Bell",
  "Ella Scott",
  "Mason Hill",
  "Ruby Ward",
  "Jack Perry"
];

function parseArgs(argv) {
  const result = {
    preset: "sorting-sorted",
    unsorted: 6,
    sorted: 6,
    dbPath: process.env.GREENLAB_DB_PATH
      ? path.resolve(process.cwd(), process.env.GREENLAB_DB_PATH)
      : DEFAULT_DB_PATH
  };

  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [rawKey, rawValue = ""] = arg.slice(2).split("=");
    const key = String(rawKey || "").trim();
    const value = String(rawValue || "").trim();
    if (!key) continue;

    if (key === "preset" && value) result.preset = value;
    if (key === "unsorted" && value) result.unsorted = Math.max(0, Number.parseInt(value, 10) || 0);
    if (key === "sorted" && value) result.sorted = Math.max(0, Number.parseInt(value, 10) || 0);
    if (key === "db" && value) result.dbPath = path.resolve(process.cwd(), value);
  }

  return result;
}

async function detectBaseUrl() {
  for (const baseUrl of DEFAULT_BASE_CANDIDATES) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return baseUrl;
    } catch {
      // try next candidate
    }
  }
  throw new Error("No running GreenLab server found on 3011/3010/3012. Start the app first or pass BASE_URL.");
}

async function api(baseUrl, pathname, options = {}) {
  const { token, body, method = "GET" } = options;
  const payloadBody = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(payloadBody !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: payloadBody
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const message = payload.error || response.statusText || "Request failed";
    throw new Error(`${pathname}: ${response.status} ${message}`);
  }

  return payload;
}

async function login(baseUrl, username) {
  const result = await api(baseUrl, "/api/login", {
    method: "POST",
    body: { username, password: PASSWORD }
  });
  return String(result.token || "");
}

async function resetDemo(baseUrl) {
  const managerToken = await login(baseUrl, "manager");
  await api(baseUrl, "/api/demo/reset", {
    method: "POST",
    token: managerToken,
    body: {}
  });
  await api(baseUrl, "/api/logout", {
    method: "POST",
    token: managerToken,
    body: {}
  });
}

function getNextOrderNumber(db) {
  const rows = db.prepare("SELECT public_id FROM orders").all();
  const maxNumber = rows.reduce((currentMax, row) => {
    const match = String(row.public_id || "").match(/^GL-(\d+)$/);
    if (!match) return currentMax;
    return Math.max(currentMax, Number.parseInt(match[1], 10) || 0);
  }, 2600);
  return maxNumber + 1;
}

function insertSortingOrders(db, count) {
  if (count <= 0) return [];

  const now = new Date().toISOString();
  const insertOrder = db.prepare(`
    INSERT INTO orders (
      public_id,
      cleancloud_order_id,
      customer_name,
      customer_id,
      order_weight,
      customer_phone,
      customer_email,
      service_tier,
      status,
      cleancloud_status,
      ready_to_place,
      ready_for_pickup,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sorting', 'sorting', 0, 0, ?, ?)
  `);

  const created = [];
  let nextNumber = getNextOrderNumber(db);

  try {
    runImmediateTransaction(db, () => {
      for (let index = 0; index < count; index += 1) {
        const orderNumber = nextNumber + index;
        const publicId = `GL-${orderNumber}`;
        const cleancloudOrderId = `CC-${orderNumber}`;
        const customerName = CUSTOMER_NAMES[index % CUSTOMER_NAMES.length];
        const customerId = `CUS-${orderNumber}`;
        const orderWeight = Number((2.2 + (index * 0.35)).toFixed(1));
        const customerPhone = `+62 812 ${String(orderNumber).padStart(4, "0")}`;
        const customerEmail = `customer${orderNumber}@greenlab.test`;
        const serviceTier = index % 2 === 0 ? "Standard" : "Express";

        insertOrder.run(
          publicId,
          cleancloudOrderId,
          customerName,
          customerId,
          orderWeight,
          customerPhone,
          customerEmail,
          serviceTier,
          now,
          now
        );
        created.push(publicId);
      }
    });
  } catch (error) {
    throw error;
  }

  return created;
}

function listSortingOrders(db) {
  return db.prepare(`
    SELECT id, public_id, status
    FROM orders
    WHERE status = 'sorting'
    ORDER BY id
  `).all();
}

async function convertOrdersToSorted(baseUrl, db, targetCount) {
  if (targetCount <= 0) return [];

  const sortingToken = await login(baseUrl, "sorting");
  const candidates = listSortingOrders(db).slice(0, targetCount);
  if (candidates.length < targetCount) {
    throw new Error(`Not enough sorting orders to convert. Needed ${targetCount}, got ${candidates.length}.`);
  }

  const created = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const order = candidates[index];
    const qrCode = `QR:BIN-${String(index + 1).padStart(3, "0")}`;
    await api(baseUrl, "/api/sorting/create-baskets", {
      method: "POST",
      token: sortingToken,
      body: {
        orderId: Number(order.id),
        baskets: [
          {
            type: "Mixed #1",
            itemCounts: {
              top: 2 + (index % 2),
              bottom: index % 2,
              underwear: 0,
              socksPairs: 1
            },
            qrCode
          }
        ]
      }
    });
    created.push(order.public_id);
  }

  return created;
}

function readSummary(db) {
  const byStatus = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM orders
    GROUP BY status
    ORDER BY status
  `).all();
  const sortingOrders = db.prepare(`
    SELECT public_id, status
    FROM orders
    WHERE status IN ('sorting', 'sorted')
    ORDER BY id
  `).all();

  return { byStatus, sortingOrders };
}

async function seedSortingAndSortedScenario(config) {
  const baseUrl = await detectBaseUrl();
  await resetDemo(baseUrl);

  const db = openSqliteDatabase({ dbPath: config.dbPath });
  try {
    const extraOrdersNeeded = Math.max(0, config.unsorted + config.sorted - 2);
    const inserted = insertSortingOrders(db, extraOrdersNeeded);
    const converted = await convertOrdersToSorted(baseUrl, db, config.sorted);
    const summary = readSummary(db);

    console.log(JSON.stringify({
      preset: "sorting-sorted",
      baseUrl,
      dbPath: config.dbPath,
      insertedSortingOrders: inserted,
      convertedToSorted: converted,
      finalSummary: summary
    }, null, 2));
  } finally {
    db.close();
  }
}

async function run() {
  const config = parseArgs(process.argv.slice(2));

  if (config.preset !== "sorting-sorted") {
    throw new Error(`Unsupported preset: ${config.preset}. Supported: sorting-sorted`);
  }

  await seedSortingAndSortedScenario(config);
}

run().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
