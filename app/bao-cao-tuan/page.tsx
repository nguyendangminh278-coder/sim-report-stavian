"use client";

import Link from "next/link";
import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import { buildWorkweekBuckets, parseSimWorkbook } from "../lib/excel-report";
import "./weekly-report.css";

type ParsedWorkbook = Awaited<ReturnType<typeof parseSimWorkbook>>;

type ReferenceTrader = {
  trader: string;
  accountResponsibility?: string | null;
  ote?: number | null;
  funding?: number | null;
  maxRisk?: number | null;
  kpiRemaining?: number | null;
  note?: string | null;
  periodValues?: Record<string, number | null> | null;
  monthlyPnl?: number | null;
  totalWithOte?: number | null;
  lots?: number | null;
  winrate?: number | null;
  losingLots?: number | null;
  avgLoss?: number | null;
  lossPercent?: number | null;
  inMonthlySummary?: boolean;
};

type Period = {
  key: string;
  label: string;
  startDate?: Date;
  endDate?: Date;
};

type TraderSummary = {
  name: string;
  reference?: ReferenceTrader;
  weeklyPnl: number[];
  pnl: number;
  ote: number | null;
  totalWithOte: number;
  lots: number;
  profitableLots: number;
  winrate: number | null;
  losingLots: number;
  lossValue: number;
  averageLoss: number | null;
  lossToFunding: number | null;
};

type AggregateSummary = {
  weeklyPnl: number[];
  pnl: number;
  ote: number | null;
  totalWithOte: number;
  lots: number;
  profitableLots: number;
  winrate: number | null;
  funding: number | null;
  maxRisk: number | null;
  losingLots: number;
  lossValue: number;
  averageLoss: number | null;
  lossToFunding: number | null;
};

const EXCEL_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");
}

function toLocalDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const result = new Date(excelEpoch + value * 86_400_000);
    return new Date(result.getUTCFullYear(), result.getUTCMonth(), result.getUTCDate(), 12);
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  const vietnamese = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (vietnamese) {
    const year = Number(vietnamese[3]) + (vietnamese[3].length === 2 ? 2000 : 0);
    const result = new Date(year, Number(vietnamese[2]) - 1, Number(vietnamese[1]), 12);
    return Number.isNaN(result.getTime()) ? null : result;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12);
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function periodLabel(start: Date, end: Date): string {
  if (
    start.getDate() === end.getDate() &&
    start.getMonth() === end.getMonth() &&
    start.getFullYear() === end.getFullYear()
  ) {
    return `${twoDigits(start.getDate())}.${twoDigits(start.getMonth() + 1)}`;
  }
  return `${twoDigits(start.getDate())}.${twoDigits(start.getMonth() + 1)} - ${twoDigits(
    end.getDate(),
  )}.${twoDigits(end.getMonth() + 1)}`;
}

function weekKeyForDate(date: Date): string {
  const day = date.getDay();
  const distanceToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + distanceToMonday);
  return `${monday.getFullYear()}-${twoDigits(monday.getMonth() + 1)}-${twoDigits(
    monday.getDate(),
  )}`;
}

function refPeriodLabel(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && "label" in value) {
    const label = (value as { label?: unknown }).label;
    return typeof label === "string" ? label.trim() : "";
  }
  return "";
}

function getPeriods(data: ParsedWorkbook): Period[] {
  const built = buildWorkweekBuckets(data.trades);
  const periodMap = new Map<string, Period>();
  for (const bucket of built) {
    periodMap.set(bucket.label, {
      key: bucket.key,
      label: bucket.label,
      startDate: toLocalDate(bucket.startDate) ?? undefined,
      endDate: toLocalDate(bucket.endDate) ?? undefined,
    });
  }

  const tradeDates = data.trades
    .map((trade) => toLocalDate(trade.reportDate))
    .filter((date): date is Date => Boolean(date));
  if (tradeDates.length) {
    const first = tradeDates.slice().sort((a, b) => a.getTime() - b.getTime())[0];
    const year = first.getFullYear();
    const month = first.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    for (let day = 1; day <= lastDay; day += 1) {
      const monday = new Date(year, month, day, 12);
      if (monday.getDay() !== 1) continue;
      const friday = new Date(year, month, Math.min(day + 4, lastDay), 12);
      const label = periodLabel(monday, friday);
      if (!periodMap.has(label)) {
        periodMap.set(label, {
          key: weekKeyForDate(monday),
          label,
          startDate: monday,
          endDate: friday,
        });
      }
    }
  }

  const referenceLabels = (data.weeklyReference?.periods ?? [])
    .map(refPeriodLabel)
    .filter(Boolean);
  const ordered: Period[] = [];
  for (const label of referenceLabels) {
    const existing = periodMap.get(label);
    ordered.push(existing ?? { key: label, label });
    periodMap.delete(label);
  }
  ordered.push(
    ...Array.from(periodMap.values()).sort((a, b) => {
      if (a.startDate && b.startDate) return a.startDate.getTime() - b.startDate.getTime();
      return a.label.localeCompare(b.label, "vi");
    }),
  );
  return ordered;
}

function findPeriodIndex(periods: Period[], value: unknown): number {
  const date = toLocalDate(value);
  if (!date) return -1;
  const key = weekKeyForDate(date);
  const byKey = periods.findIndex((period) => period.key === key);
  if (byKey >= 0) return byKey;
  const day = date.getTime();
  return periods.findIndex(
    (period) =>
      period.startDate &&
      period.endDate &&
      day >= period.startDate.getTime() &&
      day <= period.endDate.getTime(),
  );
}

function formatUsd(value: number | null, zeroAsDash = false): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (zeroAsDash && Math.abs(value) < 0.0000001) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDecimal(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function valueClass(value: number | null, neutralZero = true): string {
  if (value === null || !Number.isFinite(value)) return "wr-cell-neutral";
  if (value > 0) return "wr-cell-positive";
  if (value < 0) return "wr-cell-negative";
  return neutralZero ? "wr-cell-zero" : "wr-cell-neutral";
}

function getReferenceTraders(data: ParsedWorkbook): ReferenceTrader[] {
  const source = data.weeklyReference?.traders ?? [];
  return source.map((item) => ({
    trader: String(item.trader ?? "").trim(),
    accountResponsibility: item.accountResponsibility ?? null,
    ote: numeric(item.ote),
    funding: numeric(item.funding),
    maxRisk: numeric(item.maxRisk),
    kpiRemaining: numeric(item.kpiRemaining),
    note: item.note ?? null,
    periodValues: item.periodValues ?? null,
    monthlyPnl: numeric(item.monthlyPnl),
    totalWithOte: numeric(item.totalWithOte),
    lots: numeric(item.lots),
    winrate: numeric(item.winrate),
    losingLots: numeric(item.losingLots),
    avgLoss: numeric(item.avgLoss),
    lossPercent: numeric(item.lossPercent),
    inMonthlySummary: item.inMonthlySummary,
  }));
}

function buildSummaries(data: ParsedWorkbook, periods: Period[]): TraderSummary[] {
  const referenceTraders = getReferenceTraders(data);
  const referenceMap = new Map(
    referenceTraders.map((reference) => [normalizeName(reference.trader), reference]),
  );
  const orderedNames: string[] = [];
  const seen = new Set<string>();

  for (const reference of referenceTraders) {
    const key = normalizeName(reference.trader);
    if (reference.trader && !seen.has(key)) {
      seen.add(key);
      orderedNames.push(reference.trader);
    }
  }
  for (const trade of data.trades) {
    const name = String(trade.trader ?? "").trim();
    const key = normalizeName(name);
    if (name && !seen.has(key)) {
      seen.add(key);
      orderedNames.push(name);
    }
  }

  return orderedNames.map((name) => {
    const nameKey = normalizeName(name);
    const trades = data.trades.filter(
      (trade) => normalizeName(String(trade.trader ?? "")) === nameKey,
    );
    const weeklyPnl = Array(periods.length).fill(0) as number[];
    for (const trade of trades) {
      const index = findPeriodIndex(periods, trade.reportDate);
      const pnl = numeric(trade.pnlAfterFee) ?? 0;
      if (index >= 0) weeklyPnl[index] += pnl;
    }
    let pnl = trades.reduce((sum, trade) => sum + (numeric(trade.pnlAfterFee) ?? 0), 0);
    let lots = trades.reduce((sum, trade) => sum + Math.abs(numeric(trade.lots) ?? 0), 0);
    let profitableLots = trades.reduce(
      (sum, trade) =>
        sum + ((numeric(trade.pnlAfterFee) ?? 0) > 0 ? Math.abs(numeric(trade.lots) ?? 0) : 0),
      0,
    );
    const losingTrades = trades.filter((trade) => (numeric(trade.pnlAfterFee) ?? 0) < 0);
    let losingLots = losingTrades.reduce(
      (sum, trade) => sum + Math.abs(numeric(trade.lots) ?? 0),
      0,
    );
    let lossValue = -losingTrades.reduce(
      (sum, trade) => sum + (numeric(trade.pnlAfterFee) ?? 0),
      0,
    );
    const reference = referenceMap.get(nameKey);
    if (reference?.periodValues) {
      periods.forEach((period, index) => {
        const cached = numeric(reference.periodValues?.[period.label]);
        if (cached !== null) weeklyPnl[index] = cached;
      });
    }
    pnl = reference?.monthlyPnl ?? pnl;
    lots = reference?.lots ?? lots;
    const calculatedWinrate = lots > 0 ? profitableLots / lots : null;
    const winrate = reference?.winrate ?? calculatedWinrate;
    if (winrate !== null) profitableLots = winrate * lots;
    losingLots = reference?.losingLots ?? losingLots;
    const ote = reference?.ote ?? null;
    const funding = reference?.funding ?? null;
    let averageLoss = losingLots > 0 ? lossValue / losingLots : null;
    averageLoss = reference?.avgLoss ?? averageLoss;
    if (averageLoss !== null) lossValue = averageLoss * losingLots;
    return {
      name,
      reference,
      weeklyPnl,
      pnl,
      ote,
      totalWithOte: reference?.totalWithOte ?? pnl + (ote ?? 0),
      lots,
      profitableLots,
      winrate,
      losingLots,
      lossValue,
      averageLoss,
      lossToFunding:
        reference?.lossPercent ??
        (averageLoss !== null && funding && funding > 0 ? averageLoss / funding : null),
    };
  });
}

function aggregateSummaries(rows: TraderSummary[], periodCount: number): AggregateSummary {
  const weeklyPnl = Array(periodCount).fill(0) as number[];
  for (const row of rows) {
    row.weeklyPnl.forEach((value, index) => {
      weeklyPnl[index] += value;
    });
  }
  const pnl = rows.reduce((sum, row) => sum + row.pnl, 0);
  const hasOte = rows.some((row) => row.ote !== null);
  const ote = hasOte ? rows.reduce((sum, row) => sum + (row.ote ?? 0), 0) : null;
  const lots = rows.reduce((sum, row) => sum + row.lots, 0);
  const profitableLots = rows.reduce((sum, row) => sum + row.profitableLots, 0);
  const losingLots = rows.reduce((sum, row) => sum + row.losingLots, 0);
  const lossValue = rows.reduce((sum, row) => sum + row.lossValue, 0);
  const fundingValues = rows
    .map((row) => row.reference?.funding ?? null)
    .filter((value): value is number => value !== null);
  const riskValues = rows
    .map((row) => row.reference?.maxRisk ?? null)
    .filter((value): value is number => value !== null);
  const funding = fundingValues.length
    ? fundingValues.reduce((sum, value) => sum + value, 0)
    : null;
  const maxRisk = riskValues.length ? riskValues.reduce((sum, value) => sum + value, 0) : null;
  const averageLoss = losingLots > 0 ? lossValue / losingLots : null;
  return {
    weeklyPnl,
    pnl,
    ote,
    totalWithOte: pnl + (ote ?? 0),
    lots,
    profitableLots,
    winrate: lots > 0 ? profitableLots / lots : null,
    funding,
    maxRisk,
    losingLots,
    lossValue,
    averageLoss,
    lossToFunding: averageLoss !== null && funding && funding > 0 ? averageLoss / funding : null,
  };
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function excelFillFor(value: number | null) {
  if (value === null) return undefined;
  if (value > 0) return { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFC6EFCE" } };
  if (value < 0) return { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFFC7CE" } };
  return { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFD9EDE4" } };
}

export default function WeeklyReportPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [fileName, setFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "done" | "error">("idle");
  const [isExporting, setIsExporting] = useState(false);

  const periods = useMemo(() => (parsed ? getPeriods(parsed) : []), [parsed]);
  const summaries = useMemo(
    () => (parsed ? buildSummaries(parsed, periods) : []),
    [parsed, periods],
  );
  const monthlySummaries = useMemo(
    () => summaries.filter((summary) =>
      Boolean(summary.reference?.inMonthlySummary || summary.reference?.accountResponsibility)),
    [summaries],
  );
  const weeklyAggregate = useMemo(
    () => aggregateSummaries(summaries, periods.length), [summaries, periods.length],
  );
  const aggregate = useMemo(
    () => aggregateSummaries(monthlySummaries, periods.length), [monthlySummaries, periods.length],
  );

  async function loadFile(file?: File) {
    if (!file) return;
    if (!/\.(xlsx|xlsm)$/i.test(file.name)) {
      setError("Vui lòng chọn file Excel .xlsx hoặc .xlsm.");
      return;
    }
    setIsLoading(true);
    setError("");
    setCopyState("idle");
    try {
      const result = await parseSimWorkbook(await file.arrayBuffer());
      setParsed(result);
      setFileName(file.name);
      if (!result.trades.length) {
        setError("Không tìm thấy lệnh hạch toán trong file. Hãy kiểm tra sheet tổng hợp hoặc các sheet ngày.");
      }
    } catch (cause) {
      console.error(cause);
      setParsed(null);
      setFileName("");
      setError("Không thể đọc file Excel này. File có thể đang bị khóa, hỏng hoặc sai cấu trúc.");
    } finally {
      setIsLoading(false);
    }
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    void loadFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    void loadFile(event.dataTransfer.files?.[0]);
  }

  function buildTsv(): string {
    const topHeader = [
      "Người thực hiện",
      ...periods.map((period) => period.label),
      "Tổng",
      "KPI còn thiếu",
      "NOTE",
    ];
    const topRows = summaries.map((row) => [
      row.name,
      ...row.weeklyPnl,
      row.pnl,
      row.reference?.kpiRemaining ?? "",
      row.reference?.note ?? "",
    ]);
    const topTotal = ["Tổng", ...weeklyAggregate.weeklyPnl, weeklyAggregate.pnl, "", ""];
    const detailHeader = [
      "Thành viên",
      "Tài khoản phụ trách OTE",
      `P&L sau phí ${parsed?.monthLabel ?? ""} (USD)`,
      "OTE tham chiếu (USD)",
      "Tổng gồm OTE (USD)",
      "Số lệnh quy đổi (lot)",
      "Winrate tháng",
      "Tiền cấp (USD)",
      "Rủi ro tối đa tháng (USD)",
      "Số lệnh lỗ quy đổi",
      "Cắt lỗ TB/lệnh lỗ (USD)",
      "% cắt lỗ TB/lệnh lỗ",
    ];
    const detailRows = monthlySummaries.map((row) => [
      row.name,
      row.reference?.accountResponsibility ?? "",
      row.pnl,
      row.ote ?? "",
      row.totalWithOte,
      row.lots,
      row.winrate ?? "",
      row.reference?.funding ?? "",
      row.reference?.maxRisk ?? "",
      row.losingLots,
      row.averageLoss ?? "",
      row.lossToFunding ?? "",
    ]);
    const detailTotal = [
      "TỔNG",
      "P&L toàn phòng",
      aggregate.pnl,
      aggregate.ote ?? "",
      aggregate.totalWithOte,
      aggregate.lots,
      aggregate.winrate ?? "",
      aggregate.funding ?? "",
      aggregate.maxRisk ?? "",
      aggregate.losingLots,
      aggregate.averageLoss ?? "",
      aggregate.lossToFunding ?? "",
    ];
    return [
      ["Tổng hợp lãi/lỗ sau phí theo người thực hiện"],
      topHeader,
      ...topRows,
      topTotal,
      [],
      ["TỔNG KẾT THÁNG"],
      detailHeader,
      ...detailRows,
      detailTotal,
    ]
      .map((row) => row.map((value) => String(value).replace(/[\t\r\n]+/g, " ")).join("\t"))
      .join("\n");
  }

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(buildTsv());
      setCopyState("done");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("error");
    }
  }

  async function exportExcel() {
    if (!parsed || !summaries.length) return;
    setIsExporting(true);
    try {
      const { Workbook } = await import("exceljs");
      const workbook = new Workbook();
      workbook.creator = "SIM Report";
      workbook.created = new Date();
      const sheetName = safeFileName(`Báo Cáo Tuần - ${parsed.monthLabel || "Tổng hợp"}`).slice(0, 31);
      const sheet = workbook.addWorksheet(sheetName, {
        views: [{ state: "frozen", ySplit: 2, xSplit: 1 }],
      });
      const columnCount = Math.max(periods.length + 4, 12);
      sheet.mergeCells(1, 1, 1, columnCount);
      const title = sheet.getCell(1, 1);
      title.value = "Tổng hợp lãi/lỗ sau phí theo người thực hiện";
      title.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 13 };
      title.alignment = { horizontal: "center", vertical: "middle" };
      title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF066A51" } };
      sheet.getRow(1).height = 23;

      const topHeaders = [
        "Người thực hiện",
        ...periods.map((period) => period.label),
        "Tổng",
        "KPI còn thiếu",
        "NOTE",
      ];
      const topHeaderRow = sheet.addRow(topHeaders);
      topHeaderRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF08765B" } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      });
      for (const summary of summaries) {
        const row = sheet.addRow([
          summary.name,
          ...summary.weeklyPnl,
          summary.pnl,
          summary.reference?.kpiRemaining ?? null,
          summary.reference?.note ?? "",
        ]);
        for (let index = 2; index <= periods.length + 3; index += 1) {
          const cell = row.getCell(index);
          const value = numeric(cell.value);
          cell.numFmt = "$#,##0.00;[Red]-$#,##0.00";
          const fill = excelFillFor(value);
          if (fill) cell.fill = fill;
        }
        const noteCell = row.getCell(periods.length + 4);
        noteCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
        noteCell.alignment = { wrapText: true, vertical: "middle" };
      }
      const topTotalRow = sheet.addRow([
        "Tổng",
        ...weeklyAggregate.weeklyPnl,
        weeklyAggregate.pnl,
        null,
        "",
      ]);
      topTotalRow.font = { bold: true };
      for (let index = 2; index <= periods.length + 2; index += 1) {
        const cell = topTotalRow.getCell(index);
        cell.numFmt = "$#,##0.00;[Red]-$#,##0.00";
        const fill = excelFillFor(numeric(cell.value));
        if (fill) cell.fill = fill;
      }

      sheet.addRow([]);
      const detailTitleRow = sheet.addRow(["TỔNG KẾT THÁNG"]);
      sheet.mergeCells(detailTitleRow.number, 1, detailTitleRow.number, 12);
      detailTitleRow.getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 13 };
      detailTitleRow.getCell(1).alignment = { horizontal: "center" };
      detailTitleRow.getCell(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF066A51" },
      };
      const detailHeaders = [
        "Thành viên",
        "Tài khoản phụ trách OTE",
        `P&L sau phí ${parsed.monthLabel || "tháng"} (USD)`,
        "OTE tham chiếu (USD)",
        "Tổng gồm OTE (USD)",
        "Số lệnh quy đổi (lot)",
        "Winrate tháng",
        "Tiền cấp (USD)",
        "Rủi ro tối đa tháng (USD)",
        "Số lệnh lỗ quy đổi",
        "Cắt lỗ TB/lệnh lỗ (USD)",
        "% cắt lỗ TB/lệnh lỗ",
      ];
      const detailHeaderRow = sheet.addRow(detailHeaders);
      detailHeaderRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF08765B" } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      });
      const firstDetailDataRow = detailHeaderRow.number + 1;
      for (const summary of monthlySummaries) {
        const row = sheet.addRow([
          summary.name,
          summary.reference?.accountResponsibility ?? "",
          summary.pnl,
          summary.ote,
          summary.totalWithOte,
          summary.lots,
          summary.winrate,
          summary.reference?.funding ?? null,
          summary.reference?.maxRisk ?? null,
          summary.losingLots,
          summary.averageLoss,
          summary.lossToFunding,
        ]);
        [3, 4, 5].forEach((index) => {
          const cell = row.getCell(index);
          cell.numFmt = "$#,##0.00;[Red]-$#,##0.00";
          const fill = excelFillFor(numeric(cell.value));
          if (fill) cell.fill = fill;
        });
        row.getCell(6).numFmt = "0.00";
        row.getCell(7).numFmt = "0%";
        row.getCell(8).numFmt = "$#,##0.00";
        row.getCell(9).numFmt = "$#,##0.00";
        row.getCell(10).numFmt = "0.00";
        row.getCell(11).numFmt = "$#,##0.00";
        row.getCell(12).numFmt = "0.00%";
      }
      const totalRow = sheet.addRow([
        "TỔNG",
        "P&L toàn phòng",
        aggregate.pnl,
        aggregate.ote,
        aggregate.totalWithOte,
        aggregate.lots,
        aggregate.winrate,
        aggregate.funding,
        aggregate.maxRisk,
        aggregate.losingLots,
        aggregate.averageLoss,
        aggregate.lossToFunding,
      ]);
      totalRow.font = { bold: true, color: { argb: "FF004D3B" } };
      totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC6EFCE" } };
      [3, 4, 5, 8, 9, 11].forEach((index) => {
        totalRow.getCell(index).numFmt = "$#,##0.00;[Red]-$#,##0.00";
      });
      totalRow.getCell(6).numFmt = "0.00";
      totalRow.getCell(7).numFmt = "0.00%";
      totalRow.getCell(10).numFmt = "0.00";
      totalRow.getCell(12).numFmt = "0.00%";

      const bandTitleRow = sheet.addRow([
        `TỔNG P&L ${String(parsed.monthLabel || "").toLocaleUpperCase("vi")}`,
        "",
        "OTE THAM CHIẾU",
        "",
        "TỔNG GỒM OTE",
        "",
        "",
        "WINRATE CHUNG",
        "",
        "",
        "CẮT LỖ TB/LỆNH",
        "",
      ]);
      const bandValueRow = sheet.addRow([
        aggregate.pnl,
        "",
        aggregate.ote,
        "",
        aggregate.totalWithOte,
        "",
        "",
        aggregate.winrate,
        "",
        "",
        aggregate.averageLoss,
        "",
      ]);
      const bandGroups: Array<[number, number]> = [
        [1, 2],
        [3, 4],
        [5, 7],
        [8, 10],
        [11, 12],
      ];
      for (const [start, end] of bandGroups) {
        sheet.mergeCells(bandTitleRow.number, start, bandTitleRow.number, end);
        sheet.mergeCells(bandValueRow.number, start, bandValueRow.number, end);
        const headerCell = bandTitleRow.getCell(start);
        headerCell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        headerCell.alignment = { horizontal: "center" };
        headerCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF08765B" } };
        const valueCell = bandValueRow.getCell(start);
        valueCell.font = { bold: true, size: 15, color: { argb: "FF9C0006" } };
        valueCell.alignment = { horizontal: "center", vertical: "middle" };
        valueCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: start === 8 ? "FFD9EDE4" : "FFFFC7CE" },
        };
      }
      bandValueRow.getCell(1).numFmt = "$#,##0.00;[Red]-$#,##0.00";
      bandValueRow.getCell(3).numFmt = "$#,##0.00;[Red]-$#,##0.00";
      bandValueRow.getCell(5).numFmt = "$#,##0.00;[Red]-$#,##0.00";
      bandValueRow.getCell(8).numFmt = "0.0%";
      bandValueRow.getCell(11).numFmt = "$#,##0.00";
      bandValueRow.height = 34;

      for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
        sheet.getRow(rowNumber).eachCell({ includeEmpty: true }, (cell) => {
          cell.border = {
            top: { style: "thin", color: { argb: "FF9AAFA8" } },
            left: { style: "thin", color: { argb: "FF9AAFA8" } },
            bottom: { style: "thin", color: { argb: "FF9AAFA8" } },
            right: { style: "thin", color: { argb: "FF9AAFA8" } },
          };
        });
      }
      sheet.getColumn(1).width = 20;
      sheet.getColumn(2).width = 30;
      for (let index = 3; index <= 12; index += 1) sheet.getColumn(index).width = 19;
      sheet.getColumn(periods.length + 4).width = 34;
      detailHeaderRow.height = 48;
      const lastDetailDataRow = firstDetailDataRow + monthlySummaries.length - 1;
      if (lastDetailDataRow >= firstDetailDataRow) {
        sheet.autoFilter = {
          from: { row: detailHeaderRow.number, column: 1 },
          to: { row: lastDetailDataRow, column: 12 },
        };
      }

      const output = await workbook.xlsx.writeBuffer();
      downloadBlob(
        new Blob([output], { type: EXCEL_MIME }),
        `${safeFileName(`Bao cao tuan - ${parsed.monthLabel || "SIM"}`)}.xlsx`,
      );
    } catch (cause) {
      console.error(cause);
      setError("Không thể tạo file Excel. Vui lòng thử lại.");
    } finally {
      setIsExporting(false);
    }
  }

  const hasData = Boolean(parsed && summaries.length);

  return (
    <main className="wr-page">
      <header className="wr-topbar">
        <Link className="wr-brand" href="/" aria-label="SIM Report - về trang đọc ảnh">
          <span className="wr-brand-mark">SIM</span>
          <span>
            <strong>SIM Report</strong>
            <small>Phòng Phái sinh Stavian</small>
          </span>
        </Link>
        <nav className="wr-nav" aria-label="Các công cụ báo cáo">
          <Link href="/">Đọc ảnh</Link>
          <Link href="/tong-hop-lenh">Tổng hợp lệnh</Link>
          <Link className="is-active" href="/bao-cao-tuan" aria-current="page">
            Báo cáo tuần
          </Link>
        </nav>
      </header>

      <section className="wr-hero">
        <div>
          <span className="wr-eyebrow">BÁO CÁO QUẢN TRỊ</span>
          <h1>Báo cáo tuần &amp; tổng kết tháng</h1>
          <p>
            Tải file báo cáo Excel để tổng hợp P&amp;L theo từng tuần, hiệu suất từng thành viên
            và các chỉ số quản trị trong một bảng chuẩn hóa.
          </p>
        </div>
        <div className="wr-privacy">
          <span aria-hidden="true">●</span>
          Xử lý trực tiếp trên trình duyệt
        </div>
      </section>

      <section className="wr-workspace" aria-label="Nhập file Excel">
        <div
          className={`wr-dropzone${isDragging ? " is-dragging" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xlsm"
            onChange={onInputChange}
            hidden
          />
          <div className="wr-upload-icon" aria-hidden="true">
            ↑
          </div>
          <div className="wr-upload-copy">
            <strong>{isLoading ? "Đang đọc dữ liệu…" : "Thả file Excel vào đây"}</strong>
            <span>.xlsx hoặc .xlsm · giữ nguyên file gốc</span>
          </div>
          <button type="button" onClick={() => inputRef.current?.click()} disabled={isLoading}>
            {isLoading ? "Đang xử lý" : "Chọn file"}
          </button>
        </div>

        {fileName && parsed ? (
          <div className="wr-filebar">
            <div>
              <span className="wr-filetype">XLSX</span>
              <span>
                <strong>{fileName}</strong>
                <small>
                  {parsed.trades.length.toLocaleString("vi-VN")} lệnh · {summaries.length} người ·{" "}
                  {periods.length} tuần
                </small>
              </span>
            </div>
            <span className="wr-source-badge">
              {parsed.sourceMode === "summary-sheet" ? "Sheet tổng hợp" : "Các sheet ngày"}
            </span>
          </div>
        ) : null}

        {error ? <div className="wr-alert wr-alert-error">{error}</div> : null}
        {parsed?.warnings?.length ? (
          <details className="wr-alert wr-alert-warning">
            <summary>{parsed.warnings.length} lưu ý khi đọc file</summary>
            <ul>
              {parsed.warnings.map((warning, index) => (
                <li key={`${warning}-${index}`}>{warning}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      {hasData ? (
        <section className="wr-report" aria-live="polite">
          <div className="wr-report-toolbar">
            <div>
              <span className="wr-eyebrow">KẾT QUẢ TỰ ĐỘNG</span>
              <h2>{parsed?.monthLabel ? `Báo cáo ${parsed.monthLabel}` : "Báo cáo tuần"}</h2>
            </div>
            <div className="wr-actions">
              <button className="wr-button-secondary" type="button" onClick={() => void copyReport()}>
                {copyState === "done"
                  ? "Đã sao chép"
                  : copyState === "error"
                    ? "Không thể sao chép"
                    : "Sao chép bảng"}
              </button>
              <button
                className="wr-button-primary"
                type="button"
                onClick={() => void exportExcel()}
                disabled={isExporting}
              >
                {isExporting ? "Đang tạo file…" : "Tải Excel"}
              </button>
            </div>
          </div>

          <div className="wr-sheet-card">
            <div className="wr-sheet-scroll">
              <table className="wr-table wr-weekly-table">
                <caption>Tổng hợp lãi/lỗ sau phí theo người thực hiện</caption>
                <thead>
                  <tr className="wr-super-header">
                    <th colSpan={periods.length + 3}>Tổng hợp lãi/lỗ sau phí theo người thực hiện</th>
                    <th>Kiểm tra lệch</th>
                  </tr>
                  <tr>
                    <th>Người thực hiện</th>
                    {periods.map((period) => (
                      <th key={period.key}>{period.label}</th>
                    ))}
                    <th>Tổng</th>
                    <th>KPI còn thiếu</th>
                    <th>NOTE</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map((row) => (
                    <tr key={row.name}>
                      <th scope="row">{row.name}</th>
                      {row.weeklyPnl.map((value, index) => (
                        <td className={valueClass(value)} key={`${row.name}-${periods[index]?.key}`}>
                          {formatUsd(value)}
                        </td>
                      ))}
                      <td className={valueClass(row.pnl)}>{formatUsd(row.pnl)}</td>
                      <td className={valueClass(row.reference?.kpiRemaining ?? null)}>
                        {formatUsd(row.reference?.kpiRemaining ?? null)}
                      </td>
                      <td className="wr-note-cell">{row.reference?.note || ""}</td>
                    </tr>
                  ))}
                  <tr className="wr-total-row">
                    <th scope="row">Tổng</th>
                    {weeklyAggregate.weeklyPnl.map((value, index) => (
                      <td className={valueClass(value)} key={`total-${periods[index]?.key}`}>
                        {formatUsd(value)}
                      </td>
                    ))}
                    <td className={valueClass(weeklyAggregate.pnl)}>{formatUsd(weeklyAggregate.pnl)}</td>
                    <td>—</td>
                    <td className="wr-note-cell" />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="wr-sheet-card wr-monthly-card">
            <div className="wr-sheet-scroll">
              <table className="wr-table wr-monthly-table">
                <caption>TỔNG KẾT THÁNG</caption>
                <thead>
                  <tr className="wr-super-header">
                    <th colSpan={12}>TỔNG KẾT THÁNG</th>
                  </tr>
                  <tr>
                    <th>Thành viên</th>
                    <th>Tài khoản phụ trách OTE</th>
                    <th>P&amp;L sau phí {parsed?.monthLabel} (USD)</th>
                    <th>OTE tham chiếu (USD)</th>
                    <th>Tổng gồm OTE (USD)</th>
                    <th>Số lệnh quy đổi (lot)</th>
                    <th>Winrate tháng</th>
                    <th>Tiền cấp (USD)</th>
                    <th>Rủi ro tối đa tháng (USD)</th>
                    <th>Số lệnh lỗ quy đổi</th>
                    <th>Cắt lỗ TB/lệnh lỗ (USD)</th>
                    <th>% cắt lỗ TB/lệnh lỗ</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlySummaries.map((row) => (
                    <tr key={`monthly-${row.name}`}>
                      <th scope="row">{row.name}</th>
                      <td className="wr-text-cell">{row.reference?.accountResponsibility || "—"}</td>
                      <td className={valueClass(row.pnl)}>{formatUsd(row.pnl)}</td>
                      <td className={valueClass(row.ote)}>{formatUsd(row.ote)}</td>
                      <td className={valueClass(row.totalWithOte)}>{formatUsd(row.totalWithOte)}</td>
                      <td>{formatDecimal(row.lots, 2)}</td>
                      <td className="wr-cell-rate">{formatPercent(row.winrate)}</td>
                      <td>{formatUsd(row.reference?.funding ?? null)}</td>
                      <td>{formatUsd(row.reference?.maxRisk ?? null)}</td>
                      <td className={row.losingLots > 0 ? "wr-cell-loss-count" : ""}>
                        {formatDecimal(row.losingLots, 2)}
                      </td>
                      <td>{formatUsd(row.averageLoss)}</td>
                      <td>{formatPercent(row.lossToFunding)}</td>
                    </tr>
                  ))}
                  <tr className="wr-total-row wr-grand-total">
                    <th scope="row">TỔNG</th>
                    <td>P&amp;L toàn phòng</td>
                    <td className={valueClass(aggregate.pnl)}>{formatUsd(aggregate.pnl)}</td>
                    <td className={valueClass(aggregate.ote)}>{formatUsd(aggregate.ote)}</td>
                    <td className={valueClass(aggregate.totalWithOte)}>
                      {formatUsd(aggregate.totalWithOte)}
                    </td>
                    <td>{formatDecimal(aggregate.lots, 2)}</td>
                    <td>{formatPercent(aggregate.winrate, 2)}</td>
                    <td>{formatUsd(aggregate.funding)}</td>
                    <td>{formatUsd(aggregate.maxRisk)}</td>
                    <td>{formatDecimal(aggregate.losingLots, 2)}</td>
                    <td>{formatUsd(aggregate.averageLoss)}</td>
                    <td>{formatPercent(aggregate.lossToFunding, 2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="wr-kpi-band" aria-label="Chỉ số tổng hợp">
              <div className="wr-kpi-negative">
                <span>TỔNG P&amp;L {parsed?.monthLabel?.toLocaleUpperCase("vi")}</span>
                <strong>{formatUsd(aggregate.pnl)}</strong>
              </div>
              <div className="wr-kpi-negative">
                <span>OTE THAM CHIẾU</span>
                <strong>{formatUsd(aggregate.ote)}</strong>
              </div>
              <div className="wr-kpi-negative">
                <span>TỔNG GỒM OTE</span>
                <strong>{formatUsd(aggregate.totalWithOte)}</strong>
              </div>
              <div className="wr-kpi-positive">
                <span>WINRATE CHUNG</span>
                <strong>{formatPercent(aggregate.winrate, 1)}</strong>
              </div>
              <div className="wr-kpi-negative">
                <span>CẮT LỖ TB/LỆNH</span>
                <strong>{formatUsd(aggregate.averageLoss)}</strong>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="wr-empty-state">
          <div aria-hidden="true">▦</div>
          <h2>Bảng báo cáo sẽ xuất hiện tại đây</h2>
          <p>
            Dữ liệu P&amp;L được tính lại từ các lệnh hạch toán. OTE, tiền cấp, mức rủi ro,
            KPI và ghi chú chỉ hiển thị khi có trong sheet báo cáo tuần của file tải lên.
          </p>
        </section>
      )}
    </main>
  );
}

