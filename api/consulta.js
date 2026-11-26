
const SPREADSHEET_ID = "12xySs3rAxCTSAtBBbJMzceCUhXlTktz6rdJoJa6HfSM";

// Nomes exatos das abas da planilha oficial.
const NOVEMBER_SHEET = "November Leaderboard";
const BONUS_SHEET = "10-Day Bonus (Nov 25 - Dec 4)";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];

    if (c === '"') {
      if (quoted && next === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some(v => String(v).trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += c;
    }
  }

  row.push(cell);
  if (row.some(v => String(v).trim() !== "")) rows.push(row);

  return rows;
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findHeaderIndex(headers, candidates) {
  const normalized = headers.map(normalize);
  return normalized.findIndex(h =>
    candidates.some(c => h === normalize(c))
  );
}

function parseHours(value) {
  if (value === null || value === undefined || String(value).trim() === "") return 0;

  const s = String(value).trim().toLowerCase().replace(/,/g, ".");

  const clock = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (clock) {
    return Number(clock[1]) +
      Number(clock[2]) / 60 +
      Number(clock[3] || 0) / 3600;
  }

  const hm = s.match(/^(\d+(?:\.\d+)?)\s*h(?:oras?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:utos?)?)?)?$/);
  if (hm) return Number(hm[1]) + Number(hm[2] || 0) / 60;

  const minutesOnly = s.match(/^(\d+(?:\.\d+)?)\s*m(?:in(?:utos?)?)?$/);
  if (minutesOnly) return Number(minutesOnly[1]) / 60;

  const numeric = s.match(/^(\d+(?:\.\d+)?)\s*h?$/);
  if (numeric) return Number(numeric[1]);

  return 0;
}

function formatSheetHours(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "Indisponível";
  if (/h(?:oras?)?$/i.test(raw)) return raw;
  return `${raw.replace(/\s+/g, "")}h`;
}

function formatMinutes(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return Math.round(parseHours(raw) * 60);
}

async function readSheet(sheetName) {
  const url = new URL(
    `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq`
  );

  url.searchParams.set("tqx", "out:csv");
  url.searchParams.set("sheet", sheetName);
  url.searchParams.set("_", String(Date.now()));

  const response = await fetch(url, {
    headers: {
      "Accept": "text/csv",
      "Cache-Control": "no-cache"
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    throw new Error(`A planilha respondeu com HTTP ${response.status}.`);
  }

  const csv = await response.text();

  if (!csv || csv.trim().length < 10 ||
      csv.includes("google.visualization.Query.setResponse")) {
    throw new Error("A resposta da planilha não veio em formato CSV.");
  }

  return parseCsv(csv);
}

// Ranking do Day Bônus: posição normal (1, 2, 3...) na ordem da aba, sem somar nada.
function findBonusRank(rows, email) {
  let emailCol = 1;
  let start = 0;

  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const col = rows[i].findIndex(h => normalize(h) === "email");
    if (col >= 0) {
      emailCol = col;
      start = i + 1;
      break;
    }
  }

  const list = rows.slice(start)
    .map(row => String(row[emailCol] ?? "").trim().toLowerCase())
    .filter(e => EMAIL_RE.test(e));

  const idx = list.indexOf(email);

  return {
    status: idx >= 0 ? "ok" : "not_found",
    rank: idx >= 0 ? idx + 1 : null,
    total: list.length
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }

  const email = String(req.body?.email || "").trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Digite um e-mail válido." });
  }

  try {
    // A aba de novembro é obrigatória; o Day Bônus não pode derrubar a consulta.
    const [rows, bonusRows] = await Promise.all([
      readSheet(NOVEMBER_SHEET),
      readSheet(BONUS_SHEET).catch(err => {
        console.error("Falha ao ler o Day Bônus:", err.message);
        return null;
      })
    ]);

    let headerRowIndex = -1;
    let acceptedCol = -1;
    let pendingCol = -1;
    let rejectedCol = -1;
    let statusCol = -1;
    let totalHoursCol = -1;

    // O e-mail está fixamente na coluna B (índice 1).
    const emailCol = 1;

    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const headers = rows[i];

      const a = findHeaderIndex(headers, ["Accepted Hrs", "Accepted Hours", "Horas aceitas", "Horas aprovadas"]);
      const p = findHeaderIndex(headers, ["Pending Hrs", "Pending Hours", "Horas pendentes", "Horas em análise"]);
      const r = findHeaderIndex(headers, ["Rejected Hrs", "Rejected Hours", "Horas rejeitadas"]);
      const s = findHeaderIndex(headers, ["Account Status", "Status da conta", "Status"]);
      const t = findHeaderIndex(headers, ["Total Hrs"]);

      if (
        normalize(headers[emailCol]) === "email" &&
        a >= 0 && p >= 0 && r >= 0 && s >= 0 && t === 3
      ) {
        headerRowIndex = i;
        acceptedCol = a;
        pendingCol = p;
        rejectedCol = r;
        statusCol = s;
        totalHoursCol = t;
        break;
      }
    }

    if (headerRowIndex < 0) {
      throw new Error("Não localizei os cabeçalhos esperados. Confira se Email está na coluna B e Total Hrs na coluna D.");
    }

    const validRows = rows.slice(headerRowIndex + 1)
      .filter(row => {
        const rowEmail = String(row[emailCol] ?? "").trim().toLowerCase();
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rowEmail);
      });

    const records = validRows.map((row, index) => ({
      email: String(row[emailCol] ?? "").trim().toLowerCase(),

      acceptedDisplay: formatSheetHours(row[acceptedCol]),
      pendingDisplay: formatSheetHours(row[pendingCol]),
      rejectedDisplay: formatSheetHours(row[rejectedCol]),

      totalHoursRaw: String(row[totalHoursCol] ?? "").trim(),
      totalHoursDisplay: String(row[totalHoursCol] ?? "").trim() || "Indisponível",

      approvedMinutes: formatMinutes(row[acceptedCol]),
      pendingMinutes: formatMinutes(row[pendingCol]),
      rejectedMinutes: formatMinutes(row[rejectedCol]),

      status: normalize(row[statusCol]),

      // Primeiro registro válido = 6.
      sheetPosition: index + 6
    }));

    const target = records.find(record => record.email === email);

    if (!target) {
      return res.status(404).json({
        error: "E-mail não encontrado na planilha oficial. Confira o endereço e tente novamente."
      });
    }

    const inactiveStatuses = [
      "inactive", "inativa", "inativo",
      "disabled", "deactivated",
      "desativada", "desativado"
    ];

    const accountStatus = ["active", "ativa", "ativo"].includes(target.status)
      ? "active"
      : inactiveStatuses.includes(target.status)
        ? "inactive"
        : "unknown";

    const bonus = bonusRows
      ? findBonusRank(bonusRows, email)
      : { status: "unavailable", rank: null, total: 0 };

    return res.status(200).json({
      email,
      period: "Dados atuais",
      approved: target.acceptedDisplay,
      pending: target.pendingDisplay,
      rejected: target.rejectedDisplay,
      totalHours: target.totalHoursDisplay,
      totalMinutes: formatMinutes(target.totalHoursRaw),
      approvedMinutes: target.approvedMinutes,
      pendingMinutes: target.pendingMinutes,
      rejectedMinutes: target.rejectedMinutes,
      accountStatus,
      rank: target.sheetPosition,
      bonusRank: bonus.rank,
      bonusTotal: bonus.total,
      bonusStatus: bonus.status,
      accountActive: accountStatus === "active",
      fetchedAt: new Date().toISOString(),
      source: "Planilha oficial"
    });

  } catch (error) {
    console.error("Falha na consulta à planilha:", error.message);

    return res.status(503).json({
      error: "Não foi possível ler a planilha oficial agora. Tente novamente mais tarde."
    });
  }
};
