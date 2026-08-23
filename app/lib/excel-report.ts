/*
 * Browser-side parser for the SIM trading workbooks.
 *
 * The parser deliberately prefers the workbook's consolidated trade sheet. That
 * sheet carries the original sheet/row references and cached formula results,
 * which cannot be reconstructed as faithfully from a formatted daily sheet.
 * Daily-sheet parsing is retained as a conservative fallback for workbooks that
 * have not been consolidated yet.
 */

export interface TradeRecord {
  reportDate: string;
  bank: string;
  account: string;
  sourceSheet: string;
  sourceRow: number | string;
  sourceStt: string | number;
  trader: string;
  openDate: string;
  closeDate: string;
  expiryDate: string;
  contractCode: string;
  commodity: string;
  position: string;
  openPrice: number | null;
  closePrice: number | null;
  lots: number | null;
  tonnes: number | null;
  feeRate: number | null;
  totalFee: number | null;
  carryPrice: number | null;
  pnlBeforeFee: number | null;
  pnlAfterFee: number | null;
}

export interface WeeklyTraderReference {
  trader: string;
  accountResponsibility: string;
  ote: number | null;
  funding: number | null;
  maxRisk: number | null;
  kpiRemaining: number | null;
  note: string;
  /** Cached values from the workbook's weekly columns, keyed by their visible label. */
  periodValues?: Record<string, number | null>;
  monthlyPnl?: number | null;
  totalWithOte?: number | null;
  lots?: number | null;
  winrate?: number | null;
  losingLots?: number | null;
  avgLoss?: number | null;
  lossPercent?: number | null;
  /** True only when this person is present in the lower monthly summary block. */
  inMonthlySummary?: boolean;
}

export interface WeeklyReference {
  sheetName: string;
  monthLabel: string;
  periods: string[];
  traders: WeeklyTraderReference[];
  /** Keys are normalizeText(trader), so spelling/case differences are harmless. */
  byTrader: Record<string, WeeklyTraderReference>;
}

export interface ParsedSimWorkbook {
  trades: TradeRecord[];
  monthLabel: string;
  weeklyReference: WeeklyReference;
  sourceMode: "summary-sheet" | "daily-sheets";
  warnings: string[];
}

export interface WorkweekBucket {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
  trades: TradeRecord[];
}

type ExcelWorksheet = import("exceljs").Worksheet;
type ExcelCell = import("exceljs").Cell;

type TradeField = keyof TradeRecord;

const EMPTY_WEEKLY_REFERENCE: WeeklyReference = {
  sheetName: "",
  monthLabel: "",
  periods: [],
  traders: [],
  byTrader: {},
};

const TRADE_HEADERS: Array<{ key: TradeField; aliases: string[] }> = [
  { key: "reportDate", aliases: ["ngay bao cao"] },
  { key: "bank", aliases: ["ngan hang"] },
  { key: "account", aliases: ["tai khoan"] },
  { key: "sourceSheet", aliases: ["sheet goc"] },
  { key: "sourceRow", aliases: ["dong goc"] },
  { key: "sourceStt", aliases: ["stt goc", "stt"] },
  { key: "trader", aliases: ["nguoi thuc hien"] },
  { key: "openDate", aliases: ["ngay mo lenh"] },
  { key: "closeDate", aliases: ["ngay tat toan", "ngay dong lenh"] },
  { key: "expiryDate", aliases: ["ngay dao han"] },
  { key: "contractCode", aliases: ["ma hop dong", "ma"] },
  { key: "commodity", aliases: ["mat hang", "san pham"] },
  { key: "position", aliases: ["vi the"] },
  { key: "openPrice", aliases: ["gia mo"] },
  { key: "closePrice", aliases: ["gia dong", "gia tat toan"] },
  {
    key: "lots",
    aliases: ["khoi luong quy doi lot", "khoi luong lot", "khoi luong quy doi"],
  },
  {
    key: "tonnes",
    aliases: ["khoi luong quy doi tan", "khoi luong tan"],
  },
  {
    key: "feeRate",
    aliases: ["phi giao dich usd mt", "phi usd mt", "phi giao dich"],
  },
  { key: "totalFee", aliases: ["tong phi lenh", "tong phi"] },
  { key: "carryPrice", aliases: ["gia carry usd mt", "gia carry"] },
  {
    key: "pnlBeforeFee",
    aliases: ["loi nhuan chua phi giao dich", "loi nhuan chua phi"],
  },
  {
    key: "pnlAfterFee",
    aliases: ["loi nhuan sau phi giao dich", "loi nhuan sau phi"],
  },
];

const DAILY_REQUIRED_HEADERS = [
  "nguoi thuc hien",
  "ngay mo lenh",
  "ngay tat toan",
  "ma hop dong",
  "vi the",
];

/** Accent-insensitive, punctuation-insensitive text used for matching labels. */
export function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return "";

  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Format an ISO/date-like value for Vietnamese spreadsheet display. */
export function formatDateVN(
  value: string | Date | number | null | undefined,
): string {
  const iso = toIsoDate(value);
  if (!iso) return value === null || value === undefined ? "" : String(value);
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

/** Format a number without adding a currency symbol. */
export function formatNumber(
  value: number | null | undefined,
  maximumFractionDigits = 2,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value);
}

/** Parse a SIM workbook entirely in memory. No file content leaves the browser. */
export async function parseSimWorkbook(input: ArrayBuffer): Promise<ParsedSimWorkbook> {
  const imported = await import("exceljs");
  const ExcelJS = (imported.default || imported) as typeof import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(input as never);

  const warnings: string[] = [];
  const summarySheet = workbook.worksheets.find((sheet) => {
    const normalizedName = normalizeText(sheet.name);
    return normalizedName.includes("tong hop lenh") || normalizedName.includes("tong hop hach toan");
  });

  let trades: TradeRecord[] = [];
  let sourceMode: ParsedSimWorkbook["sourceMode"] = "daily-sheets";

  if (summarySheet) {
    const parsed = parseSummarySheet(summarySheet);
    if (parsed.trades.length > 0) {
      trades = parsed.trades;
      sourceMode = "summary-sheet";
      warnings.push(...parsed.warnings);
    } else {
      warnings.push(
        `Không đọc được bảng 22 cột trong sheet “${summarySheet.name}”; đã thử đọc các sheet ngày.`,
      );
    }
  }

  if (trades.length === 0) {
    const fallback = parseDailySheets(workbook.worksheets);
    trades = fallback.trades;
    warnings.push(...fallback.warnings);
    sourceMode = "daily-sheets";
  }

  if (trades.length === 0) {
    warnings.push("Không tìm thấy dòng hạch toán hợp lệ trong workbook.");
  }

  const weeklySheet = workbook.worksheets.find((sheet) =>
    normalizeText(sheet.name).includes("bao cao tuan"),
  );
  const monthLabel =
    inferMonthLabel(summarySheet?.name || weeklySheet?.name || "", trades) || "Tháng";
  const weeklyReference = weeklySheet
    ? parseWeeklyReference(weeklySheet, monthLabel)
    : { ...EMPTY_WEEKLY_REFERENCE, monthLabel };

  if (!weeklySheet) {
    warnings.push(
      "Workbook không có sheet Báo Cáo Tuần; OTE, tiền cấp, rủi ro, KPI và ghi chú sẽ để trống.",
    );
  }

  return {
    trades,
    monthLabel,
    weeklyReference,
    sourceMode,
    warnings: uniqueStrings(warnings),
  };
}

/** Build every Monday-Friday block in the dominant report month, including empty weeks. */
export function buildWorkweekBuckets(trades: TradeRecord[]): WorkweekBucket[] {
  const datedTrades = trades
    .map((trade) => ({ trade, date: parseIsoDate(trade.reportDate) }))
    .filter((item): item is { trade: TradeRecord; date: Date } => item.date !== null);

  if (datedTrades.length === 0) return [];

  const monthFrequency = new Map<string, number>();
  for (const { date } of datedTrades) {
    const key = `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
    monthFrequency.set(key, (monthFrequency.get(key) || 0) + 1);
  }
  const monthKey = [...monthFrequency.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const [year, month] = monthKey.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const buckets: WorkweekBucket[] = [];

  for (let day = 1; day <= lastDay; day += 1) {
    const current = new Date(Date.UTC(year, month - 1, day));
    if (current.getUTCDay() !== 1) continue;

    const endDay = Math.min(day + 4, lastDay);
    const startDate = isoFromParts(year, month, day);
    const endDate = isoFromParts(year, month, endDay);
    const label =
      day === endDay
        ? `${pad2(day)}.${pad2(month)}`
        : `${pad2(day)}.${pad2(month)} - ${pad2(endDay)}.${pad2(month)}`;
    buckets.push({ key: startDate, label, startDate, endDate, trades: [] });
  }

  // A month can begin after Monday. Preserve its first business-day fragment too.
  const first = new Date(Date.UTC(year, month - 1, 1));
  if (first.getUTCDay() >= 2 && first.getUTCDay() <= 5) {
    const endDay = Math.min(1 + (5 - first.getUTCDay()), lastDay);
    const startDate = isoFromParts(year, month, 1);
    const endDate = isoFromParts(year, month, endDay);
    buckets.unshift({
      key: startDate,
      label:
        endDay === 1
          ? `01.${pad2(month)}`
          : `01.${pad2(month)} - ${pad2(endDay)}.${pad2(month)}`,
      startDate,
      endDate,
      trades: [],
    });
  }

  for (const item of datedTrades) {
    const iso = dateToIso(item.date);
    const bucket = buckets.find((candidate) => iso >= candidate.startDate && iso <= candidate.endDate);
    if (bucket) bucket.trades.push(item.trade);
  }

  return buckets;
}

function parseSummarySheet(sheet: ExcelWorksheet): {
  trades: TradeRecord[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const header = findTradeHeader(sheet, true);
  if (!header) return { trades: [], warnings };

  const missing = TRADE_HEADERS.filter(({ key }) => header.columns[key] === undefined).map(
    ({ aliases }) => aliases[0],
  );
  if (missing.length > 0) {
    warnings.push(`Thiếu cột trong sheet tổng hợp: ${missing.join(", ")}.`);
  }

  const trades: TradeRecord[] = [];
  let carriedTrader = "";
  for (let rowNumber = header.rowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const get = (field: TradeField): unknown => {
      const column = header.columns[field];
      return column ? resolvedCellValue(row.getCell(column)) : null;
    };

    const traderValue = asString(get("trader"));
    if (traderValue && normalizeText(traderValue) !== "tong") carriedTrader = traderValue;

    const record = recordFromValues({
      reportDate: get("reportDate"),
      bank: get("bank"),
      account: get("account"),
      sourceSheet: get("sourceSheet"),
      sourceRow: get("sourceRow"),
      sourceStt: get("sourceStt"),
      trader: traderValue || carriedTrader,
      openDate: get("openDate"),
      closeDate: get("closeDate"),
      expiryDate: get("expiryDate"),
      contractCode: get("contractCode"),
      commodity: get("commodity"),
      position: get("position"),
      openPrice: get("openPrice"),
      closePrice: get("closePrice"),
      lots: get("lots"),
      tonnes: get("tonnes"),
      feeRate: get("feeRate"),
      totalFee: get("totalFee"),
      carryPrice: get("carryPrice"),
      pnlBeforeFee: get("pnlBeforeFee"),
      pnlAfterFee: get("pnlAfterFee"),
    });

    if (isTradeRow(record)) trades.push(record);
  }

  return { trades, warnings };
}

function parseDailySheets(sheets: ExcelWorksheet[]): {
  trades: TradeRecord[];
  warnings: string[];
} {
  const trades: TradeRecord[] = [];
  const warnings: string[] = [];

  for (const sheet of sheets) {
    const normalizedName = normalizeText(sheet.name);
    if (normalizedName.includes("tong hop") || normalizedName.includes("bao cao tuan")) continue;

    const headers = findAllDailyHeaders(sheet);
    for (let headerIndex = 0; headerIndex < headers.length; headerIndex += 1) {
      const header = headers[headerIndex];
      const nextHeaderRow = headers[headerIndex + 1]?.rowNumber || sheet.rowCount + 1;
      const context = inferDailyContext(sheet, header.rowNumber);
      let blankRun = 0;
      let carriedTrader = "";

      for (
        let rowNumber = header.rowNumber + 1;
        rowNumber < nextHeaderRow && rowNumber <= sheet.rowCount;
        rowNumber += 1
      ) {
        const row = sheet.getRow(rowNumber);
        const get = (field: TradeField): unknown => {
          const column = header.columns[field];
          return column ? resolvedCellValue(row.getCell(column)) : null;
        };

        const meaningful = [
          get("sourceStt"),
          get("trader"),
          get("contractCode"),
          get("openPrice"),
          get("closePrice"),
          get("lots"),
        ].some((value) => asString(value) !== "");

        if (!meaningful) {
          blankRun += 1;
          if (blankRun >= 3) break;
          continue;
        }
        blankRun = 0;

        const traderValue = asString(get("trader"));
        if (traderValue && normalizeText(traderValue) !== "tong") carriedTrader = traderValue;
        const rawOpenDate = get("openDate");
        const rawCloseDate = get("closeDate");
        const reportDate = resolveDailyReportDate(context.reportDate, rawOpenDate, rawCloseDate);
        const position = normalizePosition(asString(get("position")));
        const lots = asNumber(get("lots"));
        const tonnes = asNumber(get("tonnes")) ?? (lots === null ? null : lots * 25);
        const account = context.account;
        const feeRate = asNumber(get("feeRate")) ?? defaultFeeRate(account || context.bank);
        const totalFee =
          asNumber(get("totalFee")) ??
          (tonnes === null || feeRate === null ? null : tonnes * feeRate * 2);
        const openPrice = asNumber(get("openPrice"));
        const closePrice = asNumber(get("closePrice"));
        const calculatedPnl = calculatePnl(position, openPrice, closePrice, tonnes);
        const pnlBeforeFee = asNumber(get("pnlBeforeFee")) ?? calculatedPnl;
        const pnlAfterFee =
          asNumber(get("pnlAfterFee")) ??
          (pnlBeforeFee === null || totalFee === null ? null : pnlBeforeFee - totalFee);

        const record: TradeRecord = {
          reportDate,
          bank: context.bank,
          account,
          sourceSheet: sheet.name,
          sourceRow: rowNumber,
          sourceStt: numberOrString(get("sourceStt")),
          trader: traderValue || carriedTrader,
          openDate: toIsoDate(rawOpenDate),
          closeDate: toIsoDate(rawCloseDate),
          expiryDate: toIsoDate(get("expiryDate")),
          contractCode: asString(get("contractCode")),
          commodity:
            asString(get("commodity")) || inferCommodity(asString(get("contractCode"))),
          position,
          openPrice,
          closePrice,
          lots,
          tonnes,
          feeRate,
          totalFee,
          carryPrice: asNumber(get("carryPrice")),
          pnlBeforeFee,
          pnlAfterFee,
        };

        if (isDailySettledTradeRow(record)) trades.push(record);
      }
    }
  }

  normalizeDailyReportDates(trades);

  if (trades.length > 0) {
    warnings.push(
      "Dữ liệu được dựng từ các sheet ngày vì không có sheet tổng hợp; hãy kiểm tra lại tài khoản và các ô gộp trước khi xuất.",
    );
  }

  return { trades, warnings };
}

function parseWeeklyReference(sheet: ExcelWorksheet, monthLabel: string): WeeklyReference {
  const byTrader: Record<string, WeeklyTraderReference> = {};
  const order: string[] = [];
  const periods: string[] = [];

  const ensureTrader = (name: string): WeeklyTraderReference => {
    const key = normalizeText(name);
    if (!byTrader[key]) {
      byTrader[key] = {
        trader: name.trim(),
        accountResponsibility: "",
        ote: null,
        funding: null,
        maxRisk: null,
        kpiRemaining: null,
        note: "",
        periodValues: {},
        monthlyPnl: null,
        totalWithOte: null,
        lots: null,
        winrate: null,
        losingLots: null,
        avgLoss: null,
        lossPercent: null,
        inMonthlySummary: false,
      };
      order.push(key);
    }
    return byTrader[key];
  };

  const topHeader = findRowContaining(sheet, ["nguoi thuc hien", "tong", "kpi con thieu"]);
  if (topHeader) {
    const columns = normalizedColumns(sheet, topHeader);
    const traderColumn = findColumn(columns, ["nguoi thuc hien"]);
    const totalColumn = findColumn(columns, ["tong"]);
    const kpiColumn = findColumn(columns, ["kpi con thieu"]);
    const noteColumn = findColumn(columns, ["note", "ghi chu"]);
    const periodColumns: Array<{ column: number; label: string }> = [];

    if (traderColumn && totalColumn) {
      for (let column = traderColumn + 1; column < totalColumn; column += 1) {
        const label = asString(resolvedCellValue(sheet.getRow(topHeader).getCell(column)));
        if (label) {
          periods.push(label);
          periodColumns.push({ column, label });
        }
      }
    }

    for (let rowNumber = topHeader + 1; rowNumber <= Math.min(sheet.rowCount, topHeader + 30); rowNumber += 1) {
      const name = traderColumn
        ? asString(resolvedCellValue(sheet.getRow(rowNumber).getCell(traderColumn)))
        : "";
      if (!name) continue;
      const normalized = normalizeText(name);
      if (
        normalized === "tong" ||
        normalized.startsWith("tong ket") ||
        normalized === "thanh vien"
      ) break;
      const reference = ensureTrader(name);
      reference.periodValues = Object.fromEntries(
        periodColumns.map(({ column, label }) => [
          label,
          asNumber(resolvedCellValue(sheet.getRow(rowNumber).getCell(column))),
        ]),
      );
      reference.monthlyPnl = totalColumn
        ? asNumber(resolvedCellValue(sheet.getRow(rowNumber).getCell(totalColumn)))
        : null;
      reference.kpiRemaining = kpiColumn
        ? asNumber(resolvedCellValue(sheet.getRow(rowNumber).getCell(kpiColumn)))
        : null;
      reference.note = noteColumn
        ? asString(resolvedCellValue(sheet.getRow(rowNumber).getCell(noteColumn)))
        : "";
    }
  }

  const monthHeader = findRowContaining(sheet, ["thanh vien", "tai khoan phu trach ote"]);
  if (monthHeader) {
    const columns = normalizedColumns(sheet, monthHeader);
    const traderColumn = findColumn(columns, ["thanh vien"]);
    const accountColumn = findColumn(columns, ["tai khoan phu trach ote"]);
    const pnlColumn = findColumnContaining(columns, ["p l sau phi"]);
    const oteColumn = findColumnContaining(columns, ["ote ngay", "ote usd"]);
    const totalWithOteColumn = findColumnContaining(columns, ["tong gom ote"]);
    const lotsColumn = findColumnContaining(columns, ["so lenh quy doi lot"]);
    const winrateColumn = findColumnContaining(columns, ["winrate thang"]);
    const fundingColumn = findColumn(columns, ["tien cap usd", "tien cap"]);
    const riskColumn = findColumn(columns, ["rui ro toi da thang usd", "rui ro toi da thang"]);
    const losingLotsColumn = findColumnContaining(columns, ["so lenh lo quy doi"]);
    const avgLossColumn = findColumn(columns, ["cat lo tb lenh lo usd"]);
    const lossPercentColumn = findColumn(columns, ["cat lo tb lenh lo"]);

    for (
      let rowNumber = monthHeader + 1;
      rowNumber <= Math.min(sheet.rowCount, monthHeader + 30);
      rowNumber += 1
    ) {
      const name = traderColumn
        ? asString(resolvedCellValue(sheet.getRow(rowNumber).getCell(traderColumn)))
        : "";
      if (!name) continue;
      const normalized = normalizeText(name);
      if (normalized === "tong" || normalized.startsWith("tong p l")) break;
      const reference = ensureTrader(name);
      reference.inMonthlySummary = true;
      reference.accountResponsibility = accountColumn
        ? asString(resolvedCellValue(sheet.getRow(rowNumber).getCell(accountColumn)))
        : "";
      reference.monthlyPnl = pnlColumn
        ? asNumber(resolvedCellValue(sheet.getRow(rowNumber).getCell(pnlColumn)))
        : reference.monthlyPnl ?? null;
      reference.ote = oteColumn
        ? asNumber(resolvedCellValue(sheet.getRow(rowNumber).getCell(oteColumn)))
        : null;
      reference.totalWithOte = totalWithOteColumn
        ? asNumber(resolvedCellValue(sheet.getRow(rowNumber).getCell(totalWithOteColumn)))
        : null;
      reference.lots = lotsColumn
        ? asNumber(resolvedCellValue(sheet.getRow(rowNumber).getCell(lotsColumn)))
        : null;
      reference.winrate = winrateColumn
        ? asNumber(resolvedCellValue(sheet.getRow(rowNumber).getCell(winrateColumn)))
        : null;
      reference.funding = fundingColumn
        ? asNumber(resolvedCellValue(sheet.getRow(rowNumber).getCell(fundingColumn)))
        : null;
      reference.maxRisk = riskColumn
        ? asNumber(resolvedCellValue(sheet.getRow(rowNumber).getCell(riskColumn)))
        : null;
      reference.losingLots = losingLotsColumn
        ? asNumber(resolvedCellValue(sheet.getRow(rowNumber).getCell(losingLotsColumn)))
        : null;
      reference.avgLoss = avgLossColumn
        ? asNumber(resolvedCellValue(sheet.getRow(rowNumber).getCell(avgLossColumn)))
        : null;
      reference.lossPercent = lossPercentColumn
        ? asNumber(resolvedCellValue(sheet.getRow(rowNumber).getCell(lossPercentColumn)))
        : null;
    }
  }

  return {
    sheetName: sheet.name,
    monthLabel,
    periods: uniqueStrings(periods),
    traders: order.map((key) => byTrader[key]),
    byTrader,
  };
}

function findTradeHeader(
  sheet: ExcelWorksheet,
  requireSummaryColumns: boolean,
): { rowNumber: number; columns: Partial<Record<TradeField, number>> } | null {
  const limit = Math.min(sheet.rowCount, 40);
  for (let rowNumber = 1; rowNumber <= limit; rowNumber += 1) {
    const columns = mapTradeColumns(sheet, rowNumber);
    const mappedCount = Object.keys(columns).length;
    const required = requireSummaryColumns ? 18 : DAILY_REQUIRED_HEADERS.length;
    if (mappedCount < required) continue;

    if (
      !requireSummaryColumns &&
      !DAILY_REQUIRED_HEADERS.every((label) =>
        Object.values(columns).some((column) => {
          const header = normalizeText(resolvedCellValue(sheet.getRow(rowNumber).getCell(column)));
          return header === label;
        }),
      )
    ) {
      continue;
    }
    return { rowNumber, columns };
  }
  return null;
}

function findAllDailyHeaders(
  sheet: ExcelWorksheet,
): Array<{ rowNumber: number; columns: Partial<Record<TradeField, number>> }> {
  const headers: Array<{
    rowNumber: number;
    columns: Partial<Record<TradeField, number>>;
  }> = [];

  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const columns = mapTradeColumns(sheet, rowNumber);
    const keys = new Set(Object.keys(columns));
    if (
      keys.has("trader") &&
      keys.has("openDate") &&
      keys.has("closeDate") &&
      keys.has("contractCode") &&
      keys.has("position") &&
      keys.has("lots")
    ) {
      headers.push({ rowNumber, columns });
    }
  }
  return headers;
}

function mapTradeColumns(
  sheet: ExcelWorksheet,
  rowNumber: number,
): Partial<Record<TradeField, number>> {
  const columns: Partial<Record<TradeField, number>> = {};
  const row = sheet.getRow(rowNumber);
  const maxColumn = Math.min(Math.max(sheet.columnCount, row.cellCount), 80);

  for (let column = 1; column <= maxColumn; column += 1) {
    const label = normalizeText(resolvedCellValue(row.getCell(column)));
    if (!label) continue;

    for (const header of TRADE_HEADERS) {
      if (columns[header.key] !== undefined) continue;
      if (header.aliases.some((alias) => label === alias || label.startsWith(`${alias} `))) {
        columns[header.key] = column;
        break;
      }
    }
  }
  return columns;
}

function recordFromValues(values: Record<TradeField, unknown>): TradeRecord {
  return {
    reportDate: toIsoDate(values.reportDate),
    bank: asString(values.bank),
    account: asString(values.account),
    sourceSheet: asString(values.sourceSheet),
    sourceRow: numberOrString(values.sourceRow),
    sourceStt: numberOrString(values.sourceStt),
    trader: asString(values.trader),
    openDate: toIsoDate(values.openDate),
    closeDate: toIsoDate(values.closeDate),
    expiryDate: toIsoDate(values.expiryDate),
    contractCode: asString(values.contractCode),
    commodity: asString(values.commodity),
    position: normalizePosition(asString(values.position)),
    openPrice: asNumber(values.openPrice),
    closePrice: asNumber(values.closePrice),
    lots: asNumber(values.lots),
    tonnes: asNumber(values.tonnes),
    feeRate: asNumber(values.feeRate),
    totalFee: asNumber(values.totalFee),
    carryPrice: asNumber(values.carryPrice),
    pnlBeforeFee: asNumber(values.pnlBeforeFee),
    pnlAfterFee: asNumber(values.pnlAfterFee),
  };
}

function isTradeRow(record: TradeRecord): boolean {
  const stt = normalizeText(record.sourceStt);
  if (stt === "tong" || stt.startsWith("tong ")) return false;
  return Boolean(
    record.contractCode ||
      (record.openPrice !== null && record.closePrice !== null && record.lots !== null),
  );
}

function isPositiveTradeStt(value: number | string): boolean {
  return /^[1-9]\d*$/.test(String(value).trim());
}

function isDailySettledTradeRow(record: TradeRecord): boolean {
  return Boolean(
    isPositiveTradeStt(record.sourceStt) &&
      record.openDate &&
      record.closeDate &&
      record.contractCode &&
      ["long", "short"].includes(normalizeText(record.position)) &&
      record.openPrice !== null &&
      record.closePrice !== null &&
      record.lots !== null &&
      record.lots > 0 &&
      record.pnlAfterFee !== null,
  );
}

function inferDailyContext(
  sheet: ExcelWorksheet,
  headerRow: number,
): { account: string; bank: string; reportDate: string } {
  let account = "";
  for (let rowNumber = headerRow - 1; rowNumber >= Math.max(1, headerRow - 35); rowNumber -= 1) {
    const rowText = rowTextValue(sheet, rowNumber);
    const normalized = normalizeText(rowText);
    if (!normalized) continue;

    const known = extractKnownAccount(rowText);
    if (known) {
      account = known;
      break;
    }
  }

  return {
    account,
    bank: inferBank(account),
    reportDate: parseDateFromSheetName(sheet.name),
  };
}

function extractKnownAccount(text: string): string {
  const candidates: Array<[RegExp, string]> = [
    [/PG\s*BP\s*8888?/i, "PG BP 888"],
    [/PG\s*BP\s*668/i, "PG BP 668"],
    [/PG\s*(?:BANK\s*)?SIM/i, "PG SIM"],
    [/VIETIN(?:BANK)?/i, "Vietinbank"],
    [/BIDV/i, "BIDV"],
    [/STONE\s*X/i, "STONEX"],
  ];
  for (const [pattern, value] of candidates) {
    if (pattern.test(text)) return value;
  }
  return "";
}

function inferBank(account: string): string {
  const normalized = normalizeText(account);
  if (normalized.includes("vietin")) return "VietinBank";
  if (normalized.includes("bidv")) return "BIDV";
  if (normalized.includes("pg")) return "PG Bank";
  if (normalized.includes("stone")) return "StoneX";
  return "";
}

function defaultFeeRate(account: string): number | null {
  const normalized = normalizeText(account);
  if (normalized.includes("vietin")) return 0.616;
  if (normalized.includes("bidv")) return 0.66;
  if (normalized.includes("pg")) return 0.572;
  if (normalized.includes("stone")) return 0.7936;
  return null;
}

function inferCommodity(contractCode: string): string {
  const normalized = normalizeText(contractCode).replace(/\s/g, "").toUpperCase();
  if (normalized.startsWith("AHDD") || normalized.startsWith("LALZ")) return "Nhôm";
  if (normalized.startsWith("LDKZ")) return "Đồng";
  if (normalized.startsWith("ZDSD") || normalized.startsWith("LZHZ")) return "Kẽm";
  return "";
}

function calculatePnl(
  position: string,
  openPrice: number | null,
  closePrice: number | null,
  tonnes: number | null,
): number | null {
  if (openPrice === null || closePrice === null || tonnes === null) return null;
  if (normalizeText(position) === "long") return (closePrice - openPrice) * tonnes;
  if (normalizeText(position) === "short") return (openPrice - closePrice) * tonnes;
  return null;
}

function normalizePosition(value: string): string {
  const normalized = normalizeText(value);
  if (["long", "mua", "l"].includes(normalized)) return "Long";
  if (["short", "ban", "s", "b"].includes(normalized)) return "Short";
  return value;
}

function resolvedCellValue(cell: ExcelCell): unknown {
  return unwrapExcelValue(cell.value);
}

function unwrapExcelValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value !== "object") return value;

  const object = value as Record<string, unknown>;
  if ("result" in object && object.result !== undefined && object.result !== null) {
    return unwrapExcelValue(object.result);
  }
  if (Array.isArray(object.richText)) {
    return object.richText
      .map((part) => {
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  if ("text" in object) return object.text;
  if ("hyperlink" in object && "text" in object) return object.text;
  return null;
}

function asString(value: unknown): string {
  const resolved = unwrapExcelValue(value);
  if (resolved === null || resolved === undefined) return "";
  if (resolved instanceof Date) return dateToIso(resolved);
  if (typeof resolved === "number" && !Number.isFinite(resolved)) return "";
  return String(resolved).trim();
}

function asNumber(value: unknown): number | null {
  const resolved = unwrapExcelValue(value);
  if (typeof resolved === "number") return Number.isFinite(resolved) ? resolved : null;
  if (typeof resolved !== "string") return null;
  let text = resolved.trim().replace(/\s+/g, "");
  if (!text || /^n\/?a$/i.test(text) || text === "-") return null;
  text = text.replace(/[$€£₫]/g, "");

  // 1,234.56 => 1234.56; 1234,56 => 1234.56; -7.511 (LME PL) remains -7.511.
  if (text.includes(",") && text.includes(".")) {
    if (text.lastIndexOf(".") > text.lastIndexOf(",")) text = text.replace(/,/g, "");
    else text = text.replace(/\./g, "").replace(",", ".");
  } else if (text.includes(",")) {
    const commaParts = text.split(",");
    text =
      commaParts.length === 2 && commaParts[1].length <= 2
        ? `${commaParts[0]}.${commaParts[1]}`
        : commaParts.join("");
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberOrString(value: unknown): number | string {
  const resolved = unwrapExcelValue(value);
  if (typeof resolved === "number" && Number.isFinite(resolved)) return resolved;
  return asString(resolved);
}

function toIsoDate(value: unknown): string {
  const resolved = unwrapExcelValue(value);
  if (resolved === null || resolved === undefined || resolved === "") return "";
  if (resolved instanceof Date) return dateToIso(resolved);

  if (typeof resolved === "number" && Number.isFinite(resolved)) {
    // Excel's 1900 date system (including the historical leap-year offset).
    const milliseconds = Math.round((resolved - 25569) * 86400 * 1000);
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? "" : dateToIso(date);
  }

  const text = String(resolved).trim();
  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return isoFromParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }
  const vnMatch = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (vnMatch) {
    const yearNumber = Number(vnMatch[3]);
    const year = yearNumber < 100 ? 2000 + yearNumber : yearNumber;
    return isoFromParts(year, Number(vnMatch[2]), Number(vnMatch[1]));
  }
  return text;
}

function inferReportDateFromData(openDate: unknown, closeDate: unknown): string {
  return toIsoDate(closeDate) || toIsoDate(openDate);
}

function resolveDailyReportDate(
  sheetDate: string,
  openDate: unknown,
  closeDate: unknown,
): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(sheetDate)) return sheetDate;
  const partial = sheetDate.match(/^(\d{2})-(\d{2})$/);
  const datedValue = inferReportDateFromData(openDate, closeDate);
  const year = datedValue.match(/^(\d{4})-/)?.[1];
  if (partial && year) return `${year}-${partial[1]}-${partial[2]}`;
  return datedValue;
}

function normalizeDailyReportDates(trades: TradeRecord[]): void {
  const yearFrequency = new Map<number, number>();
  for (const trade of trades) {
    for (const value of [trade.reportDate, trade.openDate, trade.closeDate, trade.expiryDate]) {
      const match = value.match(/^(\d{4})-/);
      if (!match) continue;
      const year = Number(match[1]);
      if (year >= 2000 && year <= 2100) {
        yearFrequency.set(year, (yearFrequency.get(year) || 0) + 1);
      }
    }
  }
  const dominantYear = [...yearFrequency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!dominantYear) return;

  for (const trade of trades) {
    const partial = parseDateFromSheetName(trade.sourceSheet).match(/^(\d{2})-(\d{2})$/);
    if (partial) {
      trade.reportDate = isoFromParts(dominantYear, Number(partial[1]), Number(partial[2]));
    }
  }
}

function parseDateFromSheetName(sheetName: string): string {
  const match = sheetName.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/);
  if (!match) return "";
  if (!match[3]) return `${pad2(Number(match[2]))}-${pad2(Number(match[1]))}`;
  const rawYear = Number(match[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  return isoFromParts(year, Number(match[2]), Number(match[1]));
}

function inferMonthLabel(sheetName: string, trades: TradeRecord[]): string {
  const sheetMatch = normalizeText(sheetName).match(/thang\s+(\d{1,2})/);
  if (sheetMatch) return `Tháng ${Number(sheetMatch[1])}`;

  const monthFrequency = new Map<number, number>();
  for (const trade of trades) {
    const date = parseIsoDate(trade.reportDate);
    if (!date) continue;
    const month = date.getUTCMonth() + 1;
    monthFrequency.set(month, (monthFrequency.get(month) || 0) + 1);
  }
  const month = [...monthFrequency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return month ? `Tháng ${month}` : "";
}

function parseIsoDate(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateToIso(value: Date): string {
  return isoFromParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
}

function isoFromParts(year: number, month: number, day: number): string {
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function rowTextValue(sheet: ExcelWorksheet, rowNumber: number): string {
  const row = sheet.getRow(rowNumber);
  const parts: string[] = [];
  const maxColumn = Math.min(Math.max(sheet.columnCount, row.cellCount), 80);
  for (let column = 1; column <= maxColumn; column += 1) {
    const text = asString(resolvedCellValue(row.getCell(column)));
    if (text) parts.push(text);
  }
  return parts.join(" ");
}

function normalizedColumns(sheet: ExcelWorksheet, rowNumber: number): Map<number, string> {
  const columns = new Map<number, string>();
  const row = sheet.getRow(rowNumber);
  const maxColumn = Math.min(Math.max(sheet.columnCount, row.cellCount), 80);
  for (let column = 1; column <= maxColumn; column += 1) {
    const value = normalizeText(resolvedCellValue(row.getCell(column)));
    if (value) columns.set(column, value);
  }
  return columns;
}

function findRowContaining(sheet: ExcelWorksheet, required: string[]): number | null {
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 80); rowNumber += 1) {
    const labels = [...normalizedColumns(sheet, rowNumber).values()];
    if (required.every((needle) => labels.some((label) => label === needle || label.includes(needle)))) {
      return rowNumber;
    }
  }
  return null;
}

function findColumn(columns: Map<number, string>, aliases: string[]): number | null {
  for (const [column, label] of columns) {
    if (aliases.some((alias) => label === alias)) return column;
  }
  return null;
}

function findColumnContaining(columns: Map<number, string>, aliases: string[]): number | null {
  for (const [column, label] of columns) {
    if (aliases.some((alias) => label.includes(alias))) return column;
  }
  return null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

